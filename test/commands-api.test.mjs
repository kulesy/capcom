// Run with `npm test`. The route behind the prompt box's / list, over HTTP against the real server and the fake CLI: what it answers for a
// folder, for a session with no process and for one with a process, and that a request it cannot answer starts no CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, cliCalls, listen, request, signIn, start, until } from './harness.mjs';

// The fake CLI's commands as the page is given them: `clear` and `__remote-workflow` are left out.
const LIST = [
  { name: 'review-pr', description: 'Review a pull request (user)', hint: '[number]', aliases: [] },
  { name: 'code-review', description: 'Review the diff', hint: '[level]', aliases: ['review'] },
];
const ask = (s, token, json, headers) => request(s, 'POST', '/api/commands', { headers: { ...as(token), ...headers }, json });
const starts = s => cliCalls(s).filter(c => c.started);

test('a folder is answered with the CLI\'s commands from a CLI that makes no session and no MCP server, is sent nothing but the question, and stops', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const res = await ask(s, token, { cwd: s.home });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body(), { commands: LIST });
  await until(() => cliCalls(s).some(c => c.closed));
  const calls = cliCalls(s);
  assert.deepEqual(calls.map(c => Object.keys(c)[0]), ['started', 'control', 'closed']);
  assert.equal(calls[1].control, 'initialize');
  for (const flag of ['--strict-mcp-config', '--no-session-persistence']) assert.ok(calls[0].started.includes(flag), flag);
  assert.equal(calls[0].started.includes('--resume'), false);
});

test('a folder asked for again is answered from memory, and another folder starts its own CLI', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const other = path.join(s.home, 'other');
  fs.mkdirSync(other);
  await ask(s, token, { cwd: s.home });
  assert.deepEqual((await ask(s, token, { cwd: s.home })).body(), { commands: LIST });
  assert.equal(starts(s).length, 1);
  assert.deepEqual((await ask(s, token, { cwd: other })).body(), { commands: LIST });
  assert.equal(starts(s).length, 2);
});

test('a session with no process is answered from a CLI started in its own folder, which is not a resume of the session', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 5 }] });
  const { token } = await signIn(s);
  const res = await ask(s, token, { id: 'calm' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body(), { commands: LIST });
  assert.equal(starts(s).length, 1);
  assert.equal(starts(s)[0].started.includes('--resume'), false);
  assert.equal(cliCalls(s).some(c => c.user), false, 'no message was sent');
});

test('a session with a process is answered from the list that process gave when it started, with no other CLI', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 5 }] });
  const { token } = await signIn(s);
  const viewer = listen(s, token, 'calm');
  await request(s, 'POST', '/api/sessions/calm/send', { headers: as(token), json: { text: 'finish the turn' } });
  await until(() => viewer.events.some(e => e.type === 'turn-end'));
  viewer.close();
  assert.equal(starts(s).length, 1);

  const res = await ask(s, token, { id: 'calm' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body(), { commands: LIST });
  assert.equal(starts(s).length, 1, 'only the chat\'s own process was ever started');
});

test('a request with no folder or session, a folder that is not a folder, an unsafe id, a body that is not JSON or a session that is not there is refused, and starts no CLI', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const cases = [
    ['nothing named', {}, 400, /Which session or folder\?/],
    ['a folder that is not there', { cwd: path.join(s.home, 'nowhere') }, 400, /That folder does not exist on this Mac\./],
    ['a file', { cwd: path.join(s.home, 'claude') }, 400, /That folder does not exist on this Mac\./],
    ['a folder that is not text', { cwd: 5 }, 400, /That folder does not exist on this Mac\./],
    ['an id that is not safe', { id: '../escape' }, 400, /Bad session id/],
    ['a session that is not there', { id: 'nobody' }, 404, /No session with that id on this Mac\./],
  ];
  for (const [label, json, status, error] of cases) {
    const res = await ask(s, token, json);
    assert.equal(res.status, status, label);
    assert.match(res.body().error, error, label);
  }
  const form = await request(s, 'POST', '/api/commands', { headers: as(token), form: { cwd: s.home } });
  assert.equal(form.status, 400, 'a body that is not JSON');
  assert.match(form.body().error, /Send a JSON body\./);
  assert.deepEqual(cliCalls(s), []);
});

test('a GET to the path, a POST from nobody signed in and a POST from another site are refused, and start no CLI', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  assert.equal((await request(s, 'GET', '/api/commands', { headers: as(token) })).status, 404);
  assert.equal((await request(s, 'GET', `/api/commands?cwd=${encodeURIComponent(s.home)}`, { headers: as(token) })).status, 404);
  assert.equal((await request(s, 'POST', '/api/commands', { json: { cwd: s.home } })).status, 401);
  assert.equal((await ask(s, token, { cwd: s.home }, { origin: 'http://evil.example' })).status, 403);
  assert.deepEqual(cliCalls(s), []);
});

test('a CLI that cannot list its commands answers 502 with the last line it wrote, and the next ask tries again', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const cli = path.join(s.home, 'claude');
  const working = fs.readFileSync(cli);
  fs.writeFileSync(cli, '#!/bin/sh\necho "Not signed in." >&2\nexit 1\n');
  const down = await ask(s, token, { cwd: s.home });
  assert.equal(down.status, 502);
  assert.deepEqual(down.body(), { error: 'Not signed in.' });

  fs.writeFileSync(cli, working);
  const up = await ask(s, token, { cwd: s.home });
  assert.equal(up.status, 200);
  assert.deepEqual(up.body(), { commands: LIST });
});
