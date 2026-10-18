// Shared by the tests that start the real server on a free port, each with its own home and state folders, and talk to it over HTTP.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePassword } from '../lib/auth.mjs';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PASSWORD = 'a long password for the tests';
export const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-server-test-'));
const running = [];

const freePort = () => new Promise(resolve => {
  const probe = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// Desktop's records and the CLI's transcripts for `sessions`, Capcom's layout over them, and a CLI that logs how it was started and what it was sent.
// A session is { id, title, archived, archivedAgo, group, pinned, ago, source }, with `ago` and `archivedAgo` (when Desktop archived it) in minutes.
// A source of 'desktop' (the default) has a Desktop record, 'capcom' is listed in started.json instead, and 'cli' has a transcript only, as a terminal
// session does. `groups` and `layout` are written as they are.
function furnish(home, state, { sessions = [], groups = [], layout = {}, claude = false }) {
  const desktop = path.join(home, 'Library', 'Application Support', 'Claude');
  const records = path.join(desktop, 'claude-code-sessions', 'account', 'org');
  const transcripts = path.join(home, '.claude', 'projects', '-test-folder');
  fs.mkdirSync(records, { recursive: true });
  fs.mkdirSync(transcripts, { recursive: true });
  fs.writeFileSync(path.join(desktop, 'claude_desktop_config.json'), JSON.stringify({ preferences: { epitaxyPrefs: { 'dframe-group-scopes': { scope: { groups: [] } } } } }));
  const now = Date.now();
  const started = [];
  sessions.forEach(({ id, title = '', archived = false, archivedAgo, ago = 10, source = 'desktop' }) => {
    const at = now - ago * 60_000;
    if (source === 'desktop') {
      const record = path.join(records, `local_${id}.json`);
      fs.writeFileSync(record, JSON.stringify({ sessionId: `local_${id}`, cliSessionId: id, title, cwd: home, isArchived: archived, lastActivityAt: at }));
      if (archivedAgo !== undefined) {
        const changed = (now - archivedAgo * 60_000) / 1000;
        fs.utimesSync(record, changed, changed);
      }
    }
    if (source === 'capcom') started.push({ id, cwd: home, at, title });
    const transcript = path.join(transcripts, `${id}.jsonl`);
    fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', cwd: home, message: { role: 'user', content: title || 'hello' } })}\n`);
    fs.utimesSync(transcript, at / 1000, at / 1000);
  });
  if (started.length) fs.writeFileSync(path.join(state, 'started.json'), JSON.stringify(started));
  fs.writeFileSync(path.join(state, 'layout.json'), JSON.stringify({
    seededAt: '2026-10-16T00:00:00.000Z',
    groups,
    pinned: sessions.filter(s => s.pinned).map(s => s.id),
    assignments: Object.fromEntries(sessions.filter(s => s.group && !s.pinned).map(s => [s.id, s.group])),
    ...layout,
  }, null, 2));
  if (!claude) return {};
  const log = path.join(home, 'claude.log');
  const cli = path.join(home, 'claude');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import readline from 'node:readline';",
    `const note = entry => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + '\\n');`,
    "note({ started: process.argv.slice(2) });",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    "  try { const m = JSON.parse(line); if (m.type === 'user') note({ user: m.message.content }); } catch {}",
    "}).on('close', () => process.exit(0));",
    '',
  ].join('\n'), { mode: 0o755 });
  return { cli, log };
}

export async function start(mac) {
  const home = fs.mkdtempSync(path.join(base, 'home-'));
  const state = path.join(home, 'state');
  fs.mkdirSync(state);
  writePassword(state, PASSWORD);
  const made = mac ? furnish(home, state, mac) : {};
  const port = await freePort();
  const env = { ...process.env, HOME: home, PORT: String(port), CAPCOM_STATE: state, ...(made.cli && { CAPCOM_CLAUDE: made.cli }) };
  const child = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  running.push(child);
  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`The server did not start. ${errors}`)), 15_000);
    child.stdout.on('data', chunk => { out += chunk; if (out.includes('Capcom on')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`The server exited with ${code}. ${errors}`)); });
  });
  return { port, home, state, origin: `http://localhost:${port}`, tokens: path.join(state, 'tokens.json'), layout: path.join(state, 'layout.json'), cliLog: made.log, errors: () => errors };
}

after(() => { for (const child of running) child.kill(); });

export function request(s, method, url, { headers = {}, json, form } = {}) {
  const body = json !== undefined ? JSON.stringify(json) : form !== undefined ? new URLSearchParams(form).toString() : undefined;
  const type = json !== undefined ? 'application/json' : form !== undefined ? 'application/x-www-form-urlencoded' : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, method, path: url, headers: { host: `localhost:${s.port}`, ...(type && { 'content-type': type }), ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, body: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

export const as = token => ({ cookie: `capcom=${token}`, 'user-agent': CHROME });
export const tokenIn = cookie => /^capcom=([0-9a-f]{64});/.exec(cookie)[1];

export async function signIn(s, headers) {
  const res = await request(s, 'POST', '/login', { form: { password: PASSWORD }, headers: { 'user-agent': CHROME, ...headers } });
  assert.equal(res.status, 303);
  const cookie = res.headers['set-cookie'][0];
  return { res, cookie, token: tokenIn(cookie) };
}

// What the fake CLI has logged so far: how it was started, and each message it was sent.
export const cliCalls = s => (fs.existsSync(s.cliLog) ? fs.readFileSync(s.cliLog, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);

export async function until(check, ms = 4000) {
  for (let waited = 0; !(await check()); waited += 20) {
    if (waited > ms) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
