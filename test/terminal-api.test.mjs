// Run with `npm test`. The terminal's routes over HTTP against the real server, with a fake Mac under a temporary home. Commands are
// harmless (echo, printf, cat, read, cd, pwd, sleep) and run in that home. A command run with ! reaches the fake CLI, never the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { as, cliCalls, listen, request, restart, signIn, start, until } from './harness.mjs';

const WAIT = 20_000;
const url = (id, step) => `/api/sessions/${id}/terminal${step ? `/${step}` : ''}`;
const post = (s, token, id, step, json, headers) => request(s, 'POST', url(id, step), { headers: { ...as(token), origin: s.origin, ...headers }, json });
const snapshot = async (s, token, id) => (await request(s, 'GET', url(id), { headers: as(token) })).body();
const terminal = viewer => viewer.events.filter(e => e.type === 'terminal').map(e => e.data);
const ended = (viewer, id) => terminal(viewer).some(e => e.type === 'run' && e.run.id === id && !e.run.running);
const lastRun = (viewer, id) => terminal(viewer).filter(e => e.type === 'run' && e.run.id === id).at(-1).run;
const outputOf = (viewer, id) => terminal(viewer).filter(e => e.type === 'output' && e.run === id).flatMap(e => e.chunks).map(c => c.text).join('');
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const groupIds = () => execFileSync('ps', ['-ax', '-o', 'pgid=']).toString().split('\n').map(l => l.trim()).filter(Boolean);
const real = p => fs.realpathSync(p);

// A signed-in server with one session in the fake home, and a viewer on its chat.
async function open({ claude = false, sessions = [{ id: 'one', title: 'One' }] } = {}) {
  const s = await start({ claude, sessions });
  const { token } = await signIn(s);
  return { s, token, id: sessions[0].id };
}
async function run(s, token, id, command, source = 'panel') {
  const res = await post(s, token, id, 'run', { command, source });
  assert.equal(res.status, 200, res.text);
  return res.body().run;
}
const finish = (viewer, id) => until(() => ended(viewer, id), WAIT);

test('every terminal route needs a sign-in', async () => {
  const { s, id } = await open();
  const bare = { origin: s.origin };
  const get = await request(s, 'GET', url(id));
  assert.deepEqual([get.status, get.body()], [401, { error: 'Signed out.' }]);
  for (const step of ['run', 'input', 'stop', 'clear']) {
    const res = await request(s, 'POST', url(id, step), { headers: bare, json: { command: 'echo should-not-run', source: 'panel' } });
    assert.equal(res.status, 401, step);
  }
  const noOrigin = await request(s, 'POST', url(id, 'run'), { json: { command: 'echo should-not-run', source: 'panel' } });
  assert.equal(noOrigin.status, 401, 'signed out and without an Origin it is still the sign-in that answers');
});

test('a terminal POST needs this site\'s own Origin, a same-origin fetch and a JSON body, and anything else starts nothing', async () => {
  const { s, token, id } = await open();
  const body = { command: 'echo should-not-run', source: 'panel' };
  const refused = [
    ['no Origin', { origin: undefined }, 403],
    ['another site\'s Origin', { origin: 'http://evil.example' }, 403],
    ['the same host on another port', { origin: `http://localhost:${s.port + 1}` }, 403],
    ['an opaque Origin', { origin: 'null' }, 403],
    ['Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }, 403],
    ['Sec-Fetch-Site same-site', { 'sec-fetch-site': 'same-site' }, 403],
    ['Sec-Fetch-Site none', { 'sec-fetch-site': 'none' }, 403],
    ['a form content type', { 'content-type': 'application/x-www-form-urlencoded' }, 415],
    ['plain text', { 'content-type': 'text/plain' }, 415],
    ['multipart', { 'content-type': 'multipart/form-data; boundary=x' }, 415],
    ['a type that only starts like JSON', { 'content-type': 'application/jsonx' }, 415],
  ];
  for (const [label, headers, status] of refused) {
    const withOrigin = { ...as(token), origin: s.origin, ...headers };
    for (const key of Object.keys(withOrigin)) if (withOrigin[key] === undefined) delete withOrigin[key];
    const res = await request(s, 'POST', url(id, 'run'), { headers: withOrigin, json: body });
    assert.equal(res.status, status, label);
  }
  const noType = await request(s, 'POST', url(id, 'run'), { headers: { ...as(token), origin: s.origin } });
  assert.equal(noType.status, 415, 'no content type');
  assert.deepEqual((await snapshot(s, token, id)).runs, [], 'not one of them started a command');

  const fine = await post(s, token, id, 'clear', {}, { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json; charset=utf-8' });
  assert.equal(fine.status, 200);
  assert.equal((await post(s, token, id, 'clear', {}, { origin: `HTTP://LOCALHOST:${s.port}` })).status, 200, 'an Origin is compared as an origin, not as a string');
});

test('a GET or any other method on run, input, stop or clear is 405 and starts nothing', async () => {
  const { s, token, id } = await open();
  for (const step of ['run', 'input', 'stop', 'clear']) {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await request(s, method, `${url(id, step)}?command=echo%20should-not-run&source=panel`, { headers: { ...as(token), origin: s.origin } });
      assert.equal(res.status, 405, `${method} ${step}`);
      assert.equal(res.headers.allow, 'POST');
    }
  }
  const put = await request(s, 'PUT', url(id, 'run'), { headers: { ...as(token), origin: s.origin }, json: { command: 'echo should-not-run', source: 'panel' } });
  assert.equal(put.status, 405);
  assert.equal((await request(s, 'POST', url(id), { headers: { ...as(token), origin: s.origin }, json: {} })).status, 405, 'the list is a GET only');
  assert.equal((await request(s, 'POST', url(id, 'exec'), { headers: { ...as(token), origin: s.origin }, json: {} })).status, 404);
  assert.equal((await request(s, 'GET', `${url(id, 'run')}/more`, { headers: as(token) })).status, 404);
  assert.deepEqual((await snapshot(s, token, id)).runs, []);
});

test('an unknown session is a 404, and a session whose folder is gone can be read but not run in', async () => {
  const { s, token } = await open({ sessions: [{ id: 'one' }, { id: 'lost', fields: { cwd: '/nonexistent-folder-for-the-capcom-test' } }] });
  for (const step of ['run', 'input', 'stop', 'clear']) assert.equal((await post(s, token, 'nobody', step, { command: 'echo no', source: 'panel', run: 'x' })).status, 404, step);
  assert.equal((await request(s, 'GET', url('nobody'), { headers: as(token) })).status, 404);
  assert.equal((await request(s, 'GET', url('bad%20id'), { headers: as(token) })).status, 400);
  const res = await post(s, token, 'lost', 'run', { command: 'echo no', source: 'panel' });
  assert.equal(res.status, 409);
  assert.match(res.body().error, /folder/);
  const list = await request(s, 'GET', url('lost'), { headers: as(token) });
  assert.deepEqual([list.status, list.body().cwd, list.body().runs], [200, '/nonexistent-folder-for-the-capcom-test', []]);
  assert.equal((await post(s, token, 'lost', 'clear', {})).status, 200);
});

test('a body that is not an object, or a command or source that is wrong, is a 400', async () => {
  const { s, token, id } = await open();
  const headers = { ...as(token), origin: s.origin };
  const notJson = await request(s, 'POST', url(id, 'run'), { headers: { ...headers, 'content-type': 'application/json' }, form: { command: 'echo no' } });
  assert.equal(notJson.status, 400);
  for (const json of [[], 'echo no', 5]) assert.equal((await post(s, token, id, 'run', json)).status, 400, JSON.stringify(json));
  for (const body of [{}, { source: 'panel' }, { command: '', source: 'panel' }, { command: '  ', source: 'panel' }, { command: 5, source: 'panel' }, { command: ['echo'], source: 'panel' },
    { command: 'echo no' }, { command: 'echo no', source: 'tty' }, { command: 'echo no', source: ['panel'] }, { command: 'x'.repeat(100_001), source: 'panel' }]) {
    assert.equal((await post(s, token, id, 'run', body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  for (const body of [{}, { run: 5 }, { run: 'nope' }]) assert.equal((await post(s, token, id, 'stop', body)).status, 404, JSON.stringify(body));
  assert.deepEqual((await snapshot(s, token, id)).runs, []);
});

test('a run of echo streams its output over the chat\'s event stream and ends with exit 0, and the answers carry the hardening headers', async () => {
  const { s, token, id } = await open();
  const viewer = listen(s, token, id);
  await until(() => terminal(viewer).length, WAIT);
  assert.deepEqual(terminal(viewer)[0], { type: 'state', cwd: s.home, home: s.home, runs: [] });
  assert.ok(viewer.events.findIndex(e => e.type === 'terminal') > viewer.events.findIndex(e => e.type === 'status'), 'the snapshot follows the chat\'s status');

  const res = await post(s, token, id, 'run', { command: 'echo hello; echo oops >&2', source: 'panel' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.headers['x-content-type-options'], res.headers['cross-origin-resource-policy']], ['nosniff', 'same-origin']);
  const started = res.body().run;
  assert.deepEqual([started.command, started.cwd, started.source, started.running, started.exitCode], ['echo hello; echo oops >&2', s.home, 'panel', true, null]);
  await finish(viewer, started.id);
  const done = lastRun(viewer, started.id);
  assert.deepEqual([done.running, done.exitCode, done.signal, done.stopped, done.truncated, done.delivered], [false, 0, null, false, false, null]);
  assert.deepEqual(done.output, [{ stream: 'out', text: 'hello\n' }, { stream: 'err', text: 'oops\n' }]);
  assert.equal(outputOf(viewer, started.id), 'hello\noops\n');
  assert.ok(terminal(viewer).some(e => e.type === 'output' && e.run === started.id && e.chunks.some(c => c.stream === 'err')));

  const bad = await post(s, token, id, 'run', { command: '', source: 'panel' });
  assert.deepEqual([bad.headers['x-content-type-options'], bad.headers['cross-origin-resource-policy']], ['nosniff', 'same-origin']);
  assert.equal((await request(s, 'GET', url(id), { headers: as(token) })).headers['x-content-type-options'], 'nosniff');
  const list = await snapshot(s, token, id);
  assert.deepEqual([list.cwd, list.home, list.runs.map(r => r.id)], [s.home, s.home, [started.id]]);
  const late = listen(s, token, id);
  await until(() => terminal(late).length, WAIT);
  assert.deepEqual(terminal(late)[0].runs.map(r => [r.id, r.exitCode, r.output.length]), [[started.id, 0, 2]], 'a viewer who opens later is given the runs so far');
  viewer.close();
  late.close();
});

test('cd moves the panel\'s folder, and a ! run starts in the session\'s folder and does not use it', async () => {
  const { s, token, id } = await open({ claude: true });
  const viewer = listen(s, token, id);
  const first = await run(s, token, id, 'mkdir -p sub && cd sub && pwd');
  await finish(viewer, first.id);
  assert.equal(real(outputOf(viewer, first.id).trim()), real(path.join(s.home, 'sub')));
  await until(() => terminal(viewer).some(e => e.type === 'cwd'), WAIT);
  const moved = terminal(viewer).find(e => e.type === 'cwd').cwd;
  assert.equal(real(moved), real(path.join(s.home, 'sub')));
  assert.equal((await snapshot(s, token, id)).cwd, moved);

  const next = await run(s, token, id, 'pwd', 'block');
  await finish(viewer, next.id);
  assert.equal(real(next.cwd), real(path.join(s.home, 'sub')), 'a code block run follows the panel');
  assert.equal(real(outputOf(viewer, next.id).trim()), real(path.join(s.home, 'sub')));

  const bang = await run(s, token, id, 'pwd; cd /; pwd', 'bang');
  await finish(viewer, bang.id);
  assert.equal(bang.cwd, s.home);
  assert.equal(real(outputOf(viewer, bang.id).split('\n')[0]), real(s.home));
  assert.equal((await snapshot(s, token, id)).cwd, moved, 'its own cd did not reach the panel');
  viewer.close();
});

test('input reaches a command that reads standard input, and a finished or unknown run takes none', async () => {
  const { s, token, id } = await open();
  const viewer = listen(s, token, id);
  const started = await run(s, token, id, 'read name; echo "hello $name"; cat; echo done');
  const input = (json, run = started.id) => post(s, token, id, 'input', { run, ...json });
  assert.deepEqual((await input({ text: 'Eli\n' })).body(), { ok: true });
  await until(() => outputOf(viewer, started.id).includes('hello Eli\n'), WAIT);
  assert.equal((await input({ text: 'from cat\n', eof: true })).status, 200);
  await finish(viewer, started.id);
  assert.equal(outputOf(viewer, started.id), 'hello Eli\nfrom cat\ndone\n');
  assert.equal((await input({ text: 'late\n' })).status, 409);
  assert.equal((await input({ text: 'x' }, 'nope')).status, 404);
  const waiting = await run(s, token, id, 'sleep 30');
  assert.equal((await input({ text: 5 }, waiting.id)).status, 400);
  assert.equal((await input({}, waiting.id)).status, 400);
  const stop = await post(s, token, id, 'stop', { run: waiting.id });
  assert.deepEqual([stop.status, stop.body().run.stopped], [200, true]);
  await finish(viewer, waiting.id);
  viewer.close();
});

test('Stop ends the whole process group, including a background job, a subshell\'s job and the foreground command', async () => {
  const { s, token, id } = await open();
  const viewer = listen(s, token, id);
  const started = await run(s, token, id, 'sleep 30 & echo bg=$!; (sleep 30 & echo nested=$!; wait) & echo shell=$$; sleep 30');
  await until(() => ['bg', 'nested', 'shell'].every(name => new RegExp(`${name}=\\d+\\n`).test(outputOf(viewer, started.id))), WAIT);
  const out = outputOf(viewer, started.id);
  const pids = ['bg', 'nested', 'shell'].map(name => Number(new RegExp(`${name}=(\\d+)`).exec(out)[1]));
  assert.ok(pids.every(alive));
  assert.ok(groupIds().filter(g => g === String(pids[2])).length >= 4, 'the shell leads a group with its jobs and the foreground sleep in it');

  const res = await post(s, token, id, 'stop', { run: started.id });
  assert.deepEqual([res.status, res.body().run.stopped], [200, true]);
  await finish(viewer, started.id);
  await until(() => !pids.some(alive), WAIT);
  await until(() => !groupIds().includes(String(pids[2])), WAIT);
  assert.deepEqual([lastRun(viewer, started.id).stopped, lastRun(viewer, started.id).running], [true, false]);
  viewer.close();
});

test('clear drops the finished runs, keeps the running ones, and answers with the panel\'s folder', async () => {
  const { s, token, id } = await open();
  const viewer = listen(s, token, id);
  const done = await run(s, token, id, 'echo done');
  await finish(viewer, done.id);
  const running = await run(s, token, id, 'sleep 30');
  const res = await post(s, token, id, 'clear', {});
  assert.deepEqual([res.status, res.body().cwd, res.body().runs.map(r => r.id)], [200, s.home, [running.id]]);
  await until(() => terminal(viewer).some(e => e.type === 'cleared'), WAIT);
  assert.deepEqual(terminal(viewer).find(e => e.type === 'cleared').runs.map(r => r.id), [running.id]);
  assert.deepEqual((await snapshot(s, token, id)).runs.map(r => r.id), [running.id]);
  await post(s, token, id, 'stop', { run: running.id });
  await finish(viewer, running.id);
  viewer.close();
});

test('a long output is cut to its last 64 KB in a snapshot, and a flood is capped at a million characters with truncated set', async () => {
  const { s, token, id } = await open();
  const viewer = listen(s, token, id);
  const big = await run(s, token, id, 'head -c 100000 /dev/zero | tr "\\0" x');
  await finish(viewer, big.id);
  const list = await snapshot(s, token, id);
  assert.equal(list.runs[0].output.map(c => c.text).join('').length, 65_536);
  assert.equal(list.runs[0].truncated, false);
  const flood = await run(s, token, id, 'head -c 1500000 /dev/zero | tr "\\0" y');
  await finish(viewer, flood.id);
  const after = (await snapshot(s, token, id)).runs.find(r => r.id === flood.id);
  assert.equal(after.truncated, true);
  assert.equal(after.output.map(c => c.text).join('').length, 65_536);
  viewer.close();
});

test('the messages answer says the server has a terminal', async () => {
  const { s, token, id } = await open();
  const res = await request(s, 'GET', `/api/sessions/${id}/messages`, { headers: as(token) });
  assert.equal(res.body().terminal, true);
});

// ---- the ! hand-off ---------------------------------------------------------------------------

const settings = (s, json) => {
  fs.mkdirSync(path.join(s.home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(s.home, '.claude', 'settings.json'), JSON.stringify(json));
};
const said = (s, text) => cliCalls(s).some(c => c.user === text);
const sentText = (s, needle) => cliCalls(s).map(c => c.user).filter(u => typeof u === 'string' && u.includes(needle));

test('a command run with ! is sent to Claude at once in the CLI\'s own shape, escaped, with the run marked sent', async () => {
  const { s, token, id } = await open({ claude: true });
  const viewer = listen(s, token, id);
  const started = await run(s, token, id, 'echo "<hi> & bye"; echo oops >&2', 'bang');
  const expected = '<bash-input>echo "&lt;hi&gt; &amp; bye"; echo oops &gt;&amp;2</bash-input><bash-stdout>&lt;hi&gt; &amp; bye</bash-stdout><bash-stderr>oops</bash-stderr>';
  await until(() => said(s, expected), WAIT);
  await finish(viewer, started.id);
  assert.equal(lastRun(viewer, started.id).delivered, 'sent');
  assert.equal(sentText(s, 'bash-input').length, 1, 'sent once');
  viewer.close();
});

test('with respondToBashCommands false the result is held, goes in front of the next message once, and the run is marked held', async () => {
  const { s, token, id } = await open({ claude: true });
  settings(s, { respondToBashCommands: false });
  const viewer = listen(s, token, id);
  const started = await run(s, token, id, 'echo held', 'bang');
  await finish(viewer, started.id);
  assert.equal(lastRun(viewer, started.id).delivered, 'held');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(sentText(s, 'bash-input'), [], 'nothing was sent to Claude');

  const held = '<bash-input>echo held</bash-input><bash-stdout>held</bash-stdout><bash-stderr></bash-stderr>';
  const send = text => request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text } });
  assert.equal((await send('and now fix it')).status, 200);
  await until(() => said(s, `${held}\n\nand now fix it`), WAIT);
  assert.equal((await send('a second message')).status, 200);
  await until(() => said(s, 'a second message'), WAIT);
  assert.deepEqual(sentText(s, 'bash-input').length, 1, 'the held result went once');
  viewer.close();
});

test('a stopped ! run is still handed over, with what it printed before it was stopped', async () => {
  const { s, token, id } = await open({ claude: true });
  const viewer = listen(s, token, id);
  const started = await run(s, token, id, 'echo before; sleep 30', 'bang');
  await until(() => outputOf(viewer, started.id).includes('before'), WAIT);
  await post(s, token, id, 'stop', { run: started.id });
  await finish(viewer, started.id);
  await until(() => said(s, '<bash-input>echo before; sleep 30</bash-input><bash-stdout>before</bash-stdout><bash-stderr></bash-stderr>'), WAIT);
  assert.deepEqual([lastRun(viewer, started.id).stopped, lastRun(viewer, started.id).delivered], [true, 'sent']);
  viewer.close();
});

test('a panel run is never sent to Claude', async () => {
  const { s, token, id } = await open({ claude: true });
  const viewer = listen(s, token, id);
  const started = await run(s, token, id, 'echo panel');
  await finish(viewer, started.id);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(cliCalls(s).filter(c => c.user !== undefined), []);
  viewer.close();
});

// ---- ending with Capcom -----------------------------------------------------------------------

test('commands end with Capcom when it is stopped, and a restarted Capcom starts with no runs', async () => {
  const { s, token, id } = await open();
  const viewer = listen(s, token, id);
  const started = await run(s, token, id, 'echo p=$$; sleep 30 & echo q=$!; wait');
  await until(() => /q=\d+\n/.test(outputOf(viewer, started.id)), WAIT);
  const pids = [/p=(\d+)/, /q=(\d+)/].map(re => Number(re.exec(outputOf(viewer, started.id))[1]));
  assert.ok(pids.every(alive));
  viewer.close();
  const again = await restart(s);
  await until(() => !pids.some(alive), WAIT);
  const { token: next } = await signIn(again);
  assert.deepEqual((await snapshot(again, next, id)).runs, []);
});

test('a group\'s session has no terminal, and its messages say so', async () => {
  const group = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
  const s = await start({ sessions: [{ id: 'one', title: 'One' }], groups: [{ id: 'cg-work', name: 'Work', session: group }] });
  const { token } = await signIn(s);
  assert.equal((await post(s, token, group, 'run', { command: 'echo should-not-run', source: 'panel' })).status, 400);
  assert.equal((await request(s, 'GET', url(group), { headers: as(token) })).status, 400);
  assert.equal((await request(s, 'GET', `/api/sessions/${group}/messages`, { headers: as(token) })).body().terminal, false);
  assert.equal((await request(s, 'GET', '/api/sessions/one/messages', { headers: as(token) })).body().terminal, true);
});
