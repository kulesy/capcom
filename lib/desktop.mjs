// Reads, and never writes, the Claude desktop app's own records of its Code sessions, its settings and its unread marks.
// NOTE: [7 Oct 2026] EK - These are the app's internal files, not a documented API, checked on Claude Code 2.1.292.
// When a Desktop update moves them, the list falls back to the session files alone and says why.
import fs from 'node:fs';
import path from 'node:path';
import { readLocalStorage } from './leveldb.mjs';
import { label } from './notices.mjs';

const records = new Map();
let cache = null;
let loadedAt = 0;

// The page keeps its own copy of this pattern in public/ui/format.js.
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const stripCode = key => key.replace(/^code:/, '');

// remoteMcpServersConfig is where Desktop names its claude.ai connectors. Only the names are kept, by UUID. Whoever adds a
// connector chooses its name, so it is cleaned as a message sender's name is.
function connectorNames(config) {
  const names = {};
  for (const c of Array.isArray(config) ? config : []) {
    const name = typeof c?.name === 'string' ? label(c.name, 60) : '';
    if (typeof c?.uuid === 'string' && UUID.test(c.uuid) && name) names[c.uuid] = name;
  }
  return names;
}

const SORTS = ['recency', 'created', 'alpha'];
const sortOf = section => ({ by: SORTS.includes(section.sortBy) ? section.sortBy : 'recency', ascending: section.ascending === true });

// How Desktop sorts each section, from the scope that holds its groups or else the first scope that has sections. A group is a
// `manual` section named by its id, and the loose list is `sessions`. A section Desktop has none for is null.
function readSorts(ep, scopeKey) {
  const scopes = ep['dframe-code-sections'] || {};
  const sections = [scopes[scopeKey], ...Object.values(scopes)].map(s => s?.sections).find(Array.isArray) ?? [];
  const sorts = { pinned: null, routines: null, sessions: null, groups: new Map() };
  for (const section of sections) {
    if (section?.kind === 'manual' && typeof section.id === 'string' && !sorts.groups.has(section.id)) sorts.groups.set(section.id, sortOf(section));
    else if (['pinned', 'routines', 'sessions'].includes(section?.kind)) sorts[section.kind] ??= sortOf(section);
  }
  return sorts;
}

function readGroups(dir) {
  const ep = JSON.parse(fs.readFileSync(path.join(dir, 'claude_desktop_config.json'), 'utf8')).preferences?.epitaxyPrefs || {};
  const [scopeKey, scope] = Object.entries(ep['dframe-group-scopes'] || {}).find(([, s]) => Array.isArray(s?.groups)) ?? [];
  const pinned = [...new Set([...(ep['dframe-local-slice']?.pinnedOrder || []).map(stripCode), ...(ep['starred-local-code-sessions'] || [])])];
  // Desktop remembers a permission mode per folder, per account, and one effort level for new sessions.
  const folderModes = Object.assign({}, ...Object.entries(ep).filter(([k]) => k.startsWith('epitaxy-folder-permission-mode.')).map(([, v]) => v));
  const settings = { pinned, folderModes, effort: ep['ccd-effort-level'] || null, sorts: readSorts(ep, scopeKey) };
  // Only the groups come from a group scope, so a config with none still gives the rest.
  if (!scope) return { ...settings, problem: 'Desktop groups unavailable: no session groups found in the Desktop settings' };
  const order = Object.fromEntries(Object.entries(scope.order || {}).map(([id, keys]) => [id, keys.map(stripCode)]));
  const assignments = Object.fromEntries(Object.entries(scope.assignments || {}).map(([k, id]) => [stripCode(k), id]));
  return { ...settings, groups: scope.groups.map(g => ({ id: g.id, name: g.name })), order, assignments };
}

const stamp = value => (Number.isFinite(value) ? value : Number.isFinite(Date.parse(value)) ? Date.parse(value) : null);

// The Desktop id of the record this one nests under, if any.
// NOTE: [22 Oct 2026] EK - This is Desktop's own lineage rule, checked on Desktop 3.1623.0 with its user-links gate on, so side sessions,
// forks and suggested tasks all nest. If Desktop turns that gate off its forks and suggested tasks stop nesting there and still nest here.
function parentOf(r) {
  // Desktop's sidebar drops any user's fork, whatever its `spawnedFrom` names.
  if (r.lineageDetached || r.spawnedFrom?.userFork === true) return null;
  const spawned = typeof r.spawnedFrom?.sessionId === 'string' && r.spawnedFrom.sessionId !== r.sessionId ? r.spawnedFrom : null;
  const fork = typeof r.forkedFromSessionId === 'string' && r.forkedFromSessionId && r.forkedFromSessionId !== r.sessionId ? r.forkedFromSessionId : null;
  if (spawned?.sideSession && (fork === null || fork === spawned.sessionId || fork === spawned.deletedParent?.sessionId)) return spawned.sessionId;
  return fork ?? spawned?.sessionId ?? null;
}

function readRecords(dir) {
  const root = path.join(dir, 'claude-code-sessions');
  const seen = new Set();
  for (const a of fs.readdirSync(root)) {
    for (const b of fs.readdirSync(path.join(root, a), { withFileTypes: true })) {
      if (!b.isDirectory()) continue;
      const folder = path.join(root, a, b.name);
      for (const name of fs.readdirSync(folder)) {
        if (!name.startsWith('local_') || !name.endsWith('.json')) continue;
        const file = path.join(folder, name);
        seen.add(file);
        const mtime = fs.statSync(file).mtimeMs;
        const prev = records.get(file);
        if (prev && prev.mtime === mtime) continue;
        try {
          const r = JSON.parse(fs.readFileSync(file, 'utf8'));
          // The names and the link sit beside rec, not in it, because buildIndex spreads rec into the rows of the session list.
          const category = r.postTurnSummary?.status_category;
          records.set(file, { mtime, rec: r.cliSessionId ? {
            localId: r.sessionId, id: r.cliSessionId, title: r.title || '', cwd: r.cwd, branch: r.branch || '',
            archived: !!r.isArchived, changedAt: mtime, lastActivityAt: r.lastActivityAt || r.createdAt || 0, routine: r.scheduledTaskId || null,
            model: r.model || null, effort: r.effort || null, permissionMode: r.permissionMode || null,
            createdAt: stamp(r.createdAt) ?? 0, sortKey: stamp(r.lastTurnEdgeAt) ?? stamp(r.lastActivityAt) ?? stamp(r.createdAt) ?? 0,
            verdict: typeof category === 'string' ? category : null, error: typeof r.error === 'string' && r.error !== '', errorAt: stamp(r.errorAt) ?? 0,
          } : null, connectors: connectorNames(r.remoteMcpServersConfig), parent: parentOf(r) });
        } catch {
          // A record caught mid-write is read again on the next refresh.
        }
      }
    }
  }
  for (const file of records.keys()) if (!seen.has(file)) records.delete(file);
  const read = [...records.values()].filter(v => v.rec);
  // Desktop names a parent by its own id. A parent with no record, or none with a CLI session, leaves its child unlinked.
  const cliId = new Map(read.map(v => [v.rec.localId, v.rec.id]));
  const links = new Map(read.filter(v => cliId.has(v.parent)).map(v => [v.rec.id, cliId.get(v.parent)]));
  return { sessions: read.map(v => v.rec), connectors: new Map(read.map(v => [v.rec.id, v.connectors])), links };
}

// Which rows Desktop marks unread, and when it last acknowledged each that waits on the owner, from its Local Storage. A store that is
// missing or does not parse leaves both empty.
function readMarks(dir) {
  const stored = readLocalStorage(path.join(dir, 'Local Storage', 'leveldb'), 'https://claude.ai', ['epitaxy-unread-v1', 'epitaxy-awaiting-ack-v1']);
  const stateOf = key => {
    try { return JSON.parse(stored.get(key))?.state; } catch { return null; }
  };
  const ids = stateOf('epitaxy-unread-v1')?.unreadIds;
  const acks = stateOf('epitaxy-awaiting-ack-v1')?.ackedAt;
  return {
    unread: new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []),
    acked: new Map(acks && typeof acks === 'object' && !Array.isArray(acks) ? Object.entries(acks).filter(([, at]) => Number.isFinite(at)) : []),
  };
}

export function loadDesktop(dir, maxAgeMs = 4000) {
  if (cache && Date.now() - loadedAt < maxAgeMs) return cache;
  const out = {
    groups: [], order: {}, assignments: {}, pinned: [], folderModes: {}, effort: null, sorts: { pinned: null, routines: null, sessions: null, groups: new Map() },
    sessions: [], connectors: new Map(), links: new Map(), unread: new Set(), acked: new Map(), problem: null,
  };
  try { Object.assign(out, readGroups(dir)); } catch (e) { out.problem = `Desktop groups unavailable: ${e.message}`; }
  try { Object.assign(out, readRecords(dir)); } catch (e) { out.problem = `Desktop sessions unavailable: ${e.message}`; }
  Object.assign(out, readMarks(dir));
  cache = out;
  loadedAt = Date.now();
  return out;
}
