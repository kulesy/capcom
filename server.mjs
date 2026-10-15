// Capcom. A browser chat client for every Claude Code session on this Mac, listed the way Claude Desktop
// groups them, and driven through headless `claude -p` processes.
import http from 'node:http';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cfg, ROOT } from './lib/config.mjs';
import { loadDesktop } from './lib/desktop.mjs';
import { indexTranscripts, transcriptFor, readHead, readBefore, readAfter, completeEnd } from './lib/transcripts.mjs';
import { chatFor, getChat, startChat, sweep, activeStates } from './lib/runner.mjs';
import { makeAuth } from './lib/auth.mjs';
import { makeChips } from './lib/tools.mjs';
import { esc } from './public/md.mjs';

const auth = makeAuth(cfg.stateDir);
const chips = makeChips(cfg.stateDir);
const MODES = ['manual', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'];
// The levels `claude --help` lists for --effort. Models are checked for shape only, because the CLI knows the current names.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODEL = /^[a-z][\w.-]*(\[1m\])?$/i;
const startedFile = path.join(cfg.stateDir, 'started.json');
const readStarted = () => { try { return JSON.parse(fs.readFileSync(startedFile, 'utf8')); } catch { return []; } };
// The model, effort and Chrome choice made in Capcom for each session, kept here because Desktop's own records are read only.
const picksFile = path.join(cfg.stateDir, 'picks.json');
const readPicks = () => { try { return JSON.parse(fs.readFileSync(picksFile, 'utf8')); } catch { return {}; } };
const savePick = (id, pick) => {
  const all = readPicks();
  fs.writeFileSync(picksFile, JSON.stringify({ ...all, [id]: { ...all[id], ...pick } }));
};
const viewers = new Map();

// ---- the session index ---------------------------------------------------------------------------

function buildIndex({ archived = false } = {}) {
  const desk = loadDesktop(cfg.desktopDir);
  const files = indexTranscripts(cfg.projectsDir);
  const live = activeStates();
  const started = new Map(readStarted().map(s => [s.id, s]));
  const now = Date.now();
  const stateOf = (id, mtime) => live[id] || (now - mtime < 120_000 ? 'active' : 'idle');

  const rows = new Map();
  for (const r of desk.sessions) {
    const t = files.get(r.id);
    if (!t) continue;
    rows.set(r.id, { ...r, source: 'desktop', lastActivityAt: Math.max(Date.parse(r.lastActivityAt) || r.lastActivityAt || 0, t.mtime),
      group: desk.assignments[r.localId] || null, pinned: desk.pinned.includes(r.localId), state: stateOf(r.id, t.mtime) });
  }
  const cutoff = now - cfg.otherDays * 86400_000;
  for (const t of files.values()) {
    if (rows.has(t.id) || (t.mtime < cutoff && !started.has(t.id))) continue;
    const head = readHead(t);
    rows.set(t.id, { id: t.id, title: head.title || 'Untitled session', cwd: head.cwd || started.get(t.id)?.cwd || '', branch: head.branch,
      archived: false, lastActivityAt: t.mtime, routine: head.routine, source: started.has(t.id) ? 'capcom' : 'cli', state: stateOf(t.id, t.mtime) });
  }
  // A session started moments ago may not have written its file yet; after that, no file means it is gone.
  for (const s of started.values()) {
    if (!rows.has(s.id) && now - s.at < 10 * 60_000) rows.set(s.id, { id: s.id, title: s.title || 'New session', cwd: s.cwd, branch: '', archived: false, lastActivityAt: s.at, source: 'capcom', state: stateOf(s.id, s.at) });
  }

  const visible = [...rows.values()].filter(r => archived || !r.archived);
  const byRecent = (a, b) => b.lastActivityAt - a.lastActivityAt;
  const localIndex = new Map(visible.filter(r => r.localId).map(r => [r.localId, r]));
  const pinned = desk.pinned.map(l => localIndex.get(l)).filter(Boolean);
  const pinnedIds = new Set(pinned.map(r => r.id));
  const groups = desk.groups.map(g => {
    const ordered = (desk.order[g.id] || []).map(l => localIndex.get(l)).filter(r => r && r.group === g.id && !pinnedIds.has(r.id));
    const placed = new Set(ordered.map(r => r.id));
    const rest = visible.filter(r => r.group === g.id && !placed.has(r.id) && !pinnedIds.has(r.id)).sort(byRecent);
    return { id: g.id, name: g.name, sessions: [...ordered, ...rest] };
  });
  const routines = new Map();
  for (const r of visible.filter(r => r.routine && !r.group && !pinnedIds.has(r.id)).sort(byRecent)) {
    if (!routines.has(r.routine)) routines.set(r.routine, { name: r.routine, latest: r, earlier: [] });
    else if (routines.get(r.routine).earlier.length < 12) routines.get(r.routine).earlier.push(r);
  }
  const loose = visible.filter(r => !r.group && !r.routine && !pinnedIds.has(r.id)).sort(byRecent);
  return {
    station: cfg.station,
    problem: desk.problem,
    pinned,
    groups,
    routines: [...routines.values()].sort((a, b) => byRecent(a.latest, b.latest)),
    started: loose.filter(r => r.source === 'capcom').slice(0, 60),
    ungrouped: loose.filter(r => r.source === 'desktop').slice(0, 60),
    other: loose.filter(r => r.source === 'cli').slice(0, 60),
    rows,
  };
}

function findRow(id) {
  const index = buildIndex({ archived: true });
  return index.rows.get(id) || null;
}

// ---- reading a session ---------------------------------------------------------------------------

const shown = items => items.filter(i => i.kind !== 'result').length;

function readMessages(id, q) {
  let t = transcriptFor(id);
  if (!t) { indexTranscripts(cfg.projectsDir, 0); t = transcriptFor(id); }
  if (!t) return { items: [], start: 0, end: 0, hasEarlier: false };
  const row = findRow(id);
  const cwd = row?.cwd || '';
  // A client far behind (a stale tab, or a file that was rewritten) gets a fresh tail, not the whole file.
  const after = Number(q.get('after')) || 0;
  if (q.has('after') && completeEnd(t) - after <= cfg.chunkBytes * 4 && after <= completeEnd(t)) return readAfter(t, after, cwd, cfg.outputChars);
  let end = q.has('before') ? Number(q.get('before')) : completeEnd(t);
  const reset = q.has('after');
  const first = readBefore(t, end, cfg.chunkBytes, cwd, cfg.outputChars);
  let { items, start } = first;
  end = first.end;
  for (let i = 0; i < 6 && start > 0 && shown(items) < 40; i++) {
    const more = readBefore(t, start, cfg.chunkBytes, cwd, cfg.outputChars);
    items = [...more.items, ...items];
    start = more.start;
  }
  return { items, start, end, hasEarlier: start > 0, ...(reset ? { reset: true } : {}) };
}

// Settings follow Claude Desktop: a session Desktop knows keeps the mode, model and effort it recorded, and
// anything else gets Desktop's mode for that folder, Desktop's effort, and the model in ~/.claude/settings.json.
const MODE_NAMES = { default: 'manual' };
function readUserSettings() {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.claude', 'settings.json'), 'utf8')); } catch { return {}; }
}

function desktopSettings(row) {
  const desk = loadDesktop(cfg.desktopDir);
  const user = readUserSettings();
  const mode = [row?.permissionMode, desk.folderModes[row?.cwd], user.permissions?.defaultMode]
    .map(m => MODE_NAMES[m] || m).find(m => MODES.includes(m)) || cfg.defaultMode;
  return { mode, model: row?.model || null, shownModel: row?.model || user.model || null, effort: row?.effort || desk.effort || null };
}

// What Desktop would use, with whatever model, effort and Chrome choice was made here laid over it. Chrome is on unless switched off.
function settingsFor(id, row) {
  const { model, effort, chrome } = readPicks()[id] || {};
  return { ...desktopSettings(row), ...(model && { model, shownModel: model }), ...(effort && { effort }), chrome: chrome !== false };
}

async function newSession({ cwd, text, mode, model, effort, chrome, title }) {
  const s = desktopSettings({ cwd });
  const chat = await startChat({ cwd, mode: mode || s.mode, model: model || s.model, shownModel: model || s.shownModel, effort: effort || s.effort, text, chrome: chrome !== false, claude: cfg.claude, chips });
  if (model || effort || chrome !== undefined) savePick(chat.id, { ...(model && { model }), ...(effort && { effort }), ...(chrome !== undefined && { chrome }) });
  fs.writeFileSync(startedFile, JSON.stringify([...readStarted(), { id: chat.id, cwd, at: Date.now(), title: (title || text.trim()).slice(0, 120) }]));
  if (cfg.desktopHandoff) afterTurn(chat, () => handOff(chat.id));
  return chat.id;
}

// ---- handing new sessions to Desktop -------------------------------------------------------------
// Opt-in through desktopHandoff in config.json, because a hand-off adds to Desktop's sidebar and switches its window.
// NOTE: [14 Oct 2026] EK - Desktop's own hand-off link is the only way into its sidebar, because Desktop keeps its session
// list in memory and writes over its files. It takes the title from the transcript's custom-title entry and opens the
// session in its window. Read from Desktop's code on 14 Oct 2026, so re-check this after a Desktop update.

const markStarted = (id, patch) => fs.writeFileSync(startedFile, JSON.stringify(readStarted().map(s => (s.id === id ? { ...s, ...patch } : s))));
const inDesktop = id => loadDesktop(cfg.desktopDir, 0).sessions.some(r => r.id === id);
const shortTitle = text => { const t = text.replace(/\s+/g, ' ').trim(); return t.length > 60 ? `${t.slice(0, 60).replace(/\s+\S*$/, '')}…` : t; };

function afterTurn(chat, fn) {
  const once = ev => { if (ev.type === 'turn-end' || ev.type === 'exit') { chat.listeners.delete(once); fn(); } };
  chat.listeners.add(once);
}

async function handOff(id) {
  const s = readStarted().find(x => x.id === id);
  if (!s || s.desktopAt) return;
  // Capcom's process is stopped first, so the two apps never run the session at once. The next message here starts it again.
  const chat = getChat(id);
  if (chat && chat.state !== 'idle') return afterTurn(chat, () => handOff(id));
  if (chat?.proc) { const exited = new Promise(done => chat.proc.once('exit', done)); chat.stop(); await exited; }
  if (getChat(id)?.proc) return afterTurn(getChat(id), () => handOff(id));
  const t = indexTranscripts(cfg.projectsDir, 0).get(id);
  if (!t) return;
  if (inDesktop(id)) return markStarted(id, { desktopAt: Date.now() });
  if (!fs.readFileSync(t.file, 'utf8').includes('"type":"custom-title"')) {
    fs.appendFileSync(t.file, `${JSON.stringify({ type: 'custom-title', customTitle: shortTitle(s.title || 'Capcom session'), sessionId: id })}\n`);
  }
  // Marked before the link opens, so a failed hand-off is logged once rather than retried into Desktop's window.
  markStarted(id, { desktopAt: Date.now() });
  execFile('open', ['-g', `claude://resume?session=${id}`], err => { if (err) console.error(`Hand-off of ${id} to Desktop failed: ${err.message}`); });
  setTimeout(() => { if (!inDesktop(id)) console.error(`Desktop did not add ${id} to its sidebar.`); }, 30_000).unref();
}

// ---- http ----------------------------------------------------------------------------------------

const PUBLIC = path.join(ROOT, 'public');
const page = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');
// NOTE: [15 Oct 2026] EK - Every file under public/ with one of these extensions is served before sign-in. The page templates
// (.html) and the vendor license texts are not on the list, so keep anything private out of public/.
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

function asset(pathname) {
  const type = TYPES[path.extname(pathname)];
  const file = path.join(PUBLIC, pathname);
  if (!type || !file.startsWith(PUBLIC + path.sep)) return null;
  try { return fs.statSync(file).isFile() ? { file, type } : null; } catch { return null; }
}

function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1_000_000) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// A form or script on another site cannot drive this, because every write must come from this host.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function indexPage() {
  return page('index.html').replace(/\{\{station\}\}/g, () => esc(cfg.station)).replace(/\{\{home\}\}/g, () => esc(os.homedir()));
}

function loginPage(message = '') {
  return page('login.html').replace('{{message}}', message);
}

function ensureChat(id, row, { mode } = {}) {
  const s = settingsFor(id, row);
  const chat = chatFor(id, { cwd: row?.cwd, mode: MODES.includes(mode) ? mode : s.mode, model: s.model, shownModel: s.shownModel, effort: s.effort, chrome: s.chrome, claude: cfg.claude, chips });
  for (const fn of viewers.get(id) || []) chat.listeners.add(fn);
  return chat;
}

function events(req, res, id) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  const write = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const forward = ev => write(ev.type, ev.data);
  const chat = getChat(id);
  write('status', chat ? chat.status() : { state: 'idle', running: false, ...settingsFor(id, findRow(id)), live: '', pending: [] });
  if (!viewers.has(id)) viewers.set(id, new Set());
  viewers.get(id).add(forward);
  chat?.listeners.add(forward);
  // Sessions running in Desktop or a terminal only show up as a growing file, so the file is watched too.
  let size = transcriptFor(id)?.size ?? -1;
  const watch = setInterval(() => {
    const t = transcriptFor(id) || (indexTranscripts(cfg.projectsDir, 3000), transcriptFor(id));
    if (!t) return;
    let now;
    try { now = fs.statSync(t.file).size; } catch { return; }
    if (now !== size) { size = now; write('changed', {}); }
  }, 1500);
  const beat = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(watch);
    clearInterval(beat);
    viewers.get(id)?.delete(forward);
    getChat(id)?.listeners.delete(forward);
  });
}

async function api(req, res, u) {
  const parts = u.pathname.split('/').filter(Boolean);
  if (req.method === 'GET' && u.pathname === '/api/sessions') {
    const { rows, ...index } = buildIndex({ archived: u.searchParams.get('archived') === '1' });
    return send(res, 200, index);
  }
  if (req.method === 'GET' && u.pathname === '/api/defaults') {
    return send(res, 200, desktopSettings({ cwd: u.searchParams.get('cwd') || process.env.HOME }));
  }
  if (req.method === 'GET' && u.pathname === '/api/folders') {
    const seen = new Map();
    for (const r of [...buildIndex().rows.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt)) {
      if (r.cwd && !seen.has(r.cwd) && fs.existsSync(r.cwd)) seen.set(r.cwd, r.lastActivityAt);
    }
    const home = process.env.HOME;
    return send(res, 200, { folders: [home, ...[...seen.keys()].filter(f => f !== home)].slice(0, 25) });
  }
  if (req.method === 'POST' && u.pathname === '/api/new') {
    const { cwd, text, mode, model, effort, chrome } = JSON.parse(await readBody(req) || '{}');
    if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return send(res, 400, { error: 'That folder does not exist on this Mac.' });
    if (!text?.trim()) return send(res, 400, { error: 'Write the first message.' });
    if (model && !MODEL.test(model)) return send(res, 400, { error: 'Unknown model.' });
    if (effort && !EFFORTS.includes(effort)) return send(res, 400, { error: 'Unknown effort level.' });
    if (chrome !== undefined && typeof chrome !== 'boolean') return send(res, 400, { error: 'Chrome is on or off.' });
    const chosen = MODES.includes(mode) ? mode : desktopSettings({ cwd }).mode;
    const id = await newSession({ cwd, text, mode: chosen, model, effort, chrome });
    return send(res, 200, { id });
  }
  if (req.method === 'POST' && (u.pathname === '/api/chips/start' || u.pathname === '/api/chips/dismiss')) {
    const { sessionId, toolUseId, title, tldr, prompt, cwd, confirmCwd } = JSON.parse(await readBody(req) || '{}');
    if (!sessionId || !toolUseId) return send(res, 400, { error: 'Which chip?' });
    const known = chips.get(toolUseId);
    if (known && known.status !== 'open') return send(res, 409, { error: `That chip was already ${known.status}.`, chip: known });
    if (u.pathname.endsWith('/dismiss')) return send(res, 200, { chip: chips.put({ ...known, toolUseId, sessionId, title, status: 'dismissed' }) });
    const text = known?.prompt || prompt;
    // The folder comes from transcript text, so anywhere other than the session's own folder needs the one the card showed.
    const home = findRow(sessionId)?.cwd;
    const folder = known?.cwd || cwd || home;
    if (!text || !folder || !fs.existsSync(folder)) return send(res, 400, { error: 'This chip has no prompt or folder to start from.' });
    if (folder !== home && confirmCwd !== folder) return send(res, 400, { error: `This chip starts in ${folder}. Check the folder on the card, then press Start again.` });
    const id = await newSession({ cwd: folder, text, title: known?.title || title });
    return send(res, 200, { id, chip: chips.put({ ...known, toolUseId, sessionId, title: known?.title || title, tldr: known?.tldr || tldr, status: 'started', startedId: id }) });
  }
  if (parts[1] !== 'sessions' || !parts[2]) return send(res, 404, { error: 'Not found' });
  const id = parts[2];
  if (!/^[\w-]+$/.test(id)) return send(res, 400, { error: 'Bad session id' });
  const action = parts[3];
  if (req.method === 'GET' && action === 'messages') {
    const row = findRow(id);
    return send(res, 200, { ...readMessages(id, u.searchParams), session: row && { id, title: row.title, cwd: row.cwd, branch: row.branch, source: row.source, routine: row.routine } });
  }
  if (req.method === 'GET' && action === 'events') return events(req, res, id);
  if (req.method === 'GET' && action === 'chips') return send(res, 200, { chips: chips.forSession(id) });
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const body = JSON.parse(await readBody(req) || '{}');
  if (action === 'send') {
    if (!body.text?.trim()) return send(res, 400, { error: 'Nothing to send.' });
    const row = findRow(id);
    if (!row) return send(res, 404, { error: 'No session with that id on this Mac.' });
    const chat = ensureChat(id, row, { mode: body.mode });
    chat.send(body.text);
    return send(res, 200, chat.status());
  }
  const chat = getChat(id);
  if (action === 'mode') {
    if (!MODES.includes(body.mode)) return send(res, 400, { error: 'Unknown permission mode.' });
    const row = findRow(id);
    try {
      await ensureChat(id, row, { mode: body.mode }).setMode(body.mode);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    return send(res, 200, { mode: body.mode });
  }
  if (action === 'model' || action === 'effort') {
    const value = body[action];
    if (action === 'model' ? !MODEL.test(value || '') : !EFFORTS.includes(value)) return send(res, 400, { error: `Unknown ${action}.` });
    const row = findRow(id);
    if (!chat && !row) return send(res, 404, { error: 'No session with that id on this Mac.' });
    const target = chat || ensureChat(id, row);
    try {
      await (action === 'model' ? target.setModel(value) : target.setEffort(value));
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    savePick(id, { [action]: value });
    return send(res, 200, target.status());
  }
  if (action === 'chrome') {
    const row = findRow(id);
    if (!chat && !row) return send(res, 404, { error: 'No session with that id on this Mac.' });
    const target = chat || ensureChat(id, row, { mode: body.mode });
    if (target.state !== 'idle') return send(res, 409, { error: 'Wait for Claude to finish this turn first.' });
    target.setChrome(!!body.on);
    savePick(id, { chrome: !!body.on });
    return send(res, 200, target.status());
  }
  if (!chat) return send(res, 409, { error: 'That session is not running here.' });
  if (action === 'approve') {
    const answers = body.decision === 'answer' && body.answers && typeof body.answers === 'object' ? body.answers : undefined;
    if (body.decision === 'answer' && !answers) return send(res, 400, { error: 'No answers given.' });
    return send(res, chat.answer(body.requestId, body.decision, answers) ? 200 : 410, chat.status());
  }
  if (action === 'stop') { chat.interrupt(); return send(res, 200, chat.status()); }
  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');
    const file = asset(u.pathname);
    if (file) return send(res, 200, fs.readFileSync(file.file), file.type, { 'cache-control': 'no-cache' });
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'Cross-site request refused.' });
    if (!auth.hasPassword()) return send(res, 503, page('setup.html'), 'text/html; charset=utf-8');
    if (u.pathname === '/login' && req.method === 'POST') {
      const password = new URLSearchParams(await readBody(req)).get('password');
      const result = auth.verify(password);
      if (!result.ok) return send(res, 401, loginPage(result.locked ? 'Too many tries. Wait 15 minutes.' : 'That password did not match.'), 'text/html; charset=utf-8');
      // No Path, so behind a reverse proxy that mounts Capcom under a sub-path the cookie stays scoped to that path.
      return send(res, 303, '', 'text/plain', { location: './', 'set-cookie': `capcom=${auth.issue()}; HttpOnly; SameSite=Strict; Max-Age=2592000` });
    }
    const token = auth.check(req);
    if (!token) {
      if (u.pathname.startsWith('/api/')) return send(res, 401, { error: 'Signed out.' });
      return send(res, 200, loginPage(), 'text/html; charset=utf-8');
    }
    if (u.pathname === '/logout' && req.method === 'POST') {
      auth.revoke(token);
      return send(res, 303, '', 'text/plain', { location: './', 'set-cookie': 'capcom=; HttpOnly; SameSite=Strict; Max-Age=0' });
    }
    if (u.pathname === '/login') return send(res, 303, '', 'text/plain', { location: './' });
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);
    if (u.pathname === '/' || u.pathname === '/index.html') return send(res, 200, indexPage(), 'text/html; charset=utf-8');
    send(res, 404, 'Not found', 'text/plain');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

server.listen(cfg.port, '127.0.0.1', () => console.log(`Capcom on http://localhost:${cfg.port}`));
setInterval(() => sweep(cfg.idleMinutes), 60_000).unref();
// With the hand-off on, sessions started before it existed are handed over the first time Capcom starts with it.
if (cfg.desktopHandoff) for (const s of readStarted()) if (!s.desktopAt) handOff(s.id).catch(e => console.error(`Hand-off of ${s.id} failed: ${e.message}`));
