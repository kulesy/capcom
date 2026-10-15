// Reads, and never writes, the Claude desktop app's own records of its Code sessions.
// NOTE: [7 Oct 2026] EK - These are the app's internal files, not a documented API, checked on Claude Code 2.1.292.
// When a Desktop update moves them, the list falls back to the session files alone and says why.
import fs from 'node:fs';
import path from 'node:path';

const records = new Map();
let cache = null;
let loadedAt = 0;

const stripCode = key => key.replace(/^code:/, '');

function readGroups(dir) {
  const ep = JSON.parse(fs.readFileSync(path.join(dir, 'claude_desktop_config.json'), 'utf8')).preferences?.epitaxyPrefs || {};
  const scope = Object.values(ep['dframe-group-scopes'] || {}).find(s => Array.isArray(s?.groups));
  if (!scope) throw new Error('no session groups found in the Desktop settings');
  const order = Object.fromEntries(Object.entries(scope.order || {}).map(([id, keys]) => [id, keys.map(stripCode)]));
  const assignments = Object.fromEntries(Object.entries(scope.assignments || {}).map(([k, id]) => [stripCode(k), id]));
  const pinned = [...new Set([...(ep['dframe-local-slice']?.pinnedOrder || []).map(stripCode), ...(ep['starred-local-code-sessions'] || [])])];
  // Desktop remembers a permission mode per folder, per account, and one effort level for new sessions.
  const folderModes = Object.assign({}, ...Object.entries(ep).filter(([k]) => k.startsWith('epitaxy-folder-permission-mode.')).map(([, v]) => v));
  return { groups: scope.groups.map(g => ({ id: g.id, name: g.name })), order, assignments, pinned, folderModes, effort: ep['ccd-effort-level'] || null };
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
          records.set(file, { mtime, rec: r.cliSessionId ? {
            localId: r.sessionId, id: r.cliSessionId, title: r.title || '', cwd: r.cwd, branch: r.branch || '',
            archived: !!r.isArchived, changedAt: mtime, lastActivityAt: r.lastActivityAt || r.createdAt || 0, routine: r.scheduledTaskId || null,
            model: r.model || null, effort: r.effort || null, permissionMode: r.permissionMode || null,
          } : null });
        } catch {
          // A record caught mid-write is read again on the next refresh.
        }
      }
    }
  }
  for (const file of records.keys()) if (!seen.has(file)) records.delete(file);
  return [...records.values()].map(v => v.rec).filter(Boolean);
}

export function loadDesktop(dir, maxAgeMs = 4000) {
  if (cache && Date.now() - loadedAt < maxAgeMs) return cache;
  const out = { groups: [], order: {}, assignments: {}, pinned: [], folderModes: {}, effort: null, sessions: [], problem: null };
  try { Object.assign(out, readGroups(dir)); } catch (e) { out.problem = `Desktop groups unavailable: ${e.message}`; }
  try { out.sessions = readRecords(dir); } catch (e) { out.problem = `Desktop sessions unavailable: ${e.message}`; }
  cache = out;
  loadedAt = Date.now();
  return out;
}
