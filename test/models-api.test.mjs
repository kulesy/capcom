// Run with `npm test`. The routes behind the model menu, over HTTP against the real server and the fake CLI: the models it lists for a folder or a
// session, and fast mode, which is switched per session through the CLI and remembered in picks.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { as, cliCalls, listen, request, restart, signIn, start, until } from './harness.mjs';

// The fake CLI's models as the page is given them: the ones it lists by id, then the ones it names only by an alias.
const LIST = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', fast: false },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', fast: false },
  { id: 'claude-opus-5', label: 'Opus 5', fast: true },
  { id: 'claude-fable-5', label: 'Fable 5', fast: false },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', fast: true },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', fast: true },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', fast: false },
];
const ask = (s, token, json, headers) => request(s, 'POST', '/api/models', { headers: { ...as(token), ...headers }, json });
const post = (s, token, url, json) => request(s, 'POST', url, { headers: as(token), json });
const starts = s => cliCalls(s).filter(c => c.started);
const picks = s => JSON.parse(fs.readFileSync(path.join(s.state, 'picks.json'), 'utf8'));
const flags = s => cliCalls(s).filter(c => c.settings).map(c => c.settings);
const calm = { id: 'calm', title: 'Calm one', ago: 5 };

test('a folder is answered with the CLI\'s models by full id from the one probe that also gave its commands, so the next ask for either starts no CLI', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const res = await ask(s, token, { cwd: s.home });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body(), { models: LIST });
  assert.equal(starts(s).length, 1);
  assert.equal((await request(s, 'POST', '/api/commands', { headers: as(token), json: { cwd: s.home } })).status, 200);
  assert.deepEqual((await ask(s, token, { cwd: s.home })).body(), { models: LIST });
  assert.equal(starts(s).length, 1);
});

test('a session with no process is answered from a CLI started in its folder, and one with a process from the list that process gave', async () => {
  const s = await start({ claude: true, sessions: [calm] });
  const { token } = await signIn(s);
  assert.deepEqual((await ask(s, token, { id: 'calm' })).body(), { models: LIST });
  assert.equal(starts(s).length, 1);
  assert.equal(starts(s)[0].started.includes('--resume'), false);

  const viewer = listen(s, token, 'calm');
  await post(s, token, '/api/sessions/calm/send', { text: 'finish the turn' });
  await until(() => viewer.events.some(e => e.type === 'turn-end'));
  viewer.close();
  assert.equal(starts(s).length, 2);
  const res = await ask(s, token, { id: 'calm' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body(), { models: LIST });
  assert.equal(starts(s).length, 2, 'only the chat\'s own process was started');
});

test('a request with no folder or session, a folder that is not a folder, an unsafe id, a body that is not JSON or a session that is not there is refused for models too, and starts no CLI', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const cases = [
    ['nothing named', {}, 400, /Which session or folder\?/],
    ['a folder that is not there', { cwd: path.join(s.home, 'nowhere') }, 400, /That folder does not exist on this Mac\./],
    ['a folder that is not text', { cwd: 5 }, 400, /That folder does not exist on this Mac\./],
    ['an id that is not safe', { id: '../escape' }, 400, /Bad session id/],
    ['a session that is not there', { id: 'nobody' }, 404, /No session with that id on this Mac\./],
  ];
  for (const [label, json, status, error] of cases) {
    const res = await ask(s, token, json);
    assert.equal(res.status, status, label);
    assert.match(res.body().error, error, label);
  }
  const form = await request(s, 'POST', '/api/models', { headers: as(token), form: { cwd: s.home } });
  assert.equal(form.status, 400, 'a body that is not JSON');
  assert.match(form.body().error, /Send a JSON body\./);
  assert.deepEqual(cliCalls(s), []);
});

test('a GET to the models path, a POST from nobody signed in and a POST from another site are refused, and start no CLI', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  assert.equal((await request(s, 'GET', '/api/models', { headers: as(token) })).status, 404);
  assert.equal((await request(s, 'GET', `/api/models?cwd=${encodeURIComponent(s.home)}`, { headers: as(token) })).status, 404);
  assert.equal((await request(s, 'POST', '/api/models', { json: { cwd: s.home } })).status, 401);
  assert.equal((await ask(s, token, { cwd: s.home }, { origin: 'http://evil.example' })).status, 403);
  assert.deepEqual(cliCalls(s), []);
});

test('a CLI that cannot list its models answers 502 with the last line it wrote, and the next ask tries again', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const cli = path.join(s.home, 'claude');
  const working = fs.readFileSync(cli);
  fs.writeFileSync(cli, '#!/bin/sh\necho "Not signed in." >&2\nexit 1\n');
  const down = await ask(s, token, { cwd: s.home });
  assert.equal(down.status, 502);
  assert.deepEqual(down.body(), { error: 'Not signed in.' });

  fs.writeFileSync(cli, working);
  assert.deepEqual((await ask(s, token, { cwd: s.home })).body(), { models: LIST });
});

test('fast mode is switched on a running chat through the CLI, told to the page and remembered for the session in picks.json', async () => {
  const s = await start({ claude: true, sessions: [calm] });
  const { token } = await signIn(s);
  const viewer = listen(s, token, 'calm');
  await post(s, token, '/api/sessions/calm/send', { text: 'finish the turn' });
  await until(() => viewer.events.some(e => e.type === 'turn-end'));
  assert.deepEqual(flags(s), []);

  const on = await post(s, token, '/api/sessions/calm/fast', { fast: true });
  assert.equal(on.status, 200);
  assert.equal(on.body().fast, true);
  assert.deepEqual(flags(s), [{ fastMode: true }]);
  assert.deepEqual(picks(s), { calm: { fast: true } });
  await until(() => viewer.events.some(e => e.type === 'fast'));

  const off = await post(s, token, '/api/sessions/calm/fast', { fast: false });
  assert.equal(off.body().fast, false);
  assert.deepEqual(flags(s), [{ fastMode: true }, { fastMode: false }]);
  assert.deepEqual(picks(s), { calm: { fast: false } });
  await until(() => viewer.events.filter(e => e.type === 'fast').length === 2);
  assert.deepEqual(viewer.events.filter(e => e.type === 'fast').map(e => e.data), [{ fast: true }, { fast: false }]);
  viewer.close();
});

test('a change Claude refuses answers 400 with the chat\'s status, which still holds the model it was on, and is not remembered', async () => {
  const s = await start({ claude: true, sessions: [calm] });
  const { token } = await signIn(s);
  const viewer = listen(s, token, 'calm');
  await post(s, token, '/api/sessions/calm/send', { text: 'finish the turn' });
  await until(() => viewer.events.some(e => e.type === 'turn-end'));
  viewer.close();
  assert.equal((await post(s, token, '/api/sessions/calm/model', { model: 'claude-haiku-5-5' })).status, 200);

  const refused = await post(s, token, '/api/sessions/calm/model', { model: 'refused-by-the-fake' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body().error, 'The fake refused that model.');
  assert.equal(refused.body().status.model, 'claude-haiku-5-5');
  assert.deepEqual(picks(s), { calm: { model: 'claude-haiku-5-5' } });
});

test('fast mode picked on a session with no process starts no CLI, shows in the status a page is given, and is asked for when the process starts', async () => {
  const s = await start({ claude: true, sessions: [calm] });
  const { token } = await signIn(s);
  const res = await post(s, token, '/api/sessions/calm/fast', { fast: true });
  assert.equal(res.status, 200);
  assert.equal(res.body().fast, true);
  assert.deepEqual(cliCalls(s), [], 'a setting started no CLI');
  assert.deepEqual(picks(s), { calm: { fast: true } });

  const viewer = listen(s, token, 'calm');
  await until(() => viewer.events.some(e => e.type === 'status'));
  assert.equal(viewer.events.find(e => e.type === 'status').data.fast, true);

  await post(s, token, '/api/sessions/calm/send', { text: 'finish the turn' });
  await until(() => viewer.events.some(e => e.type === 'turn-end'));
  viewer.close();
  const calls = cliCalls(s);
  assert.deepEqual(flags(s), [{ fastMode: true }]);
  assert.ok(calls.findIndex(c => c.control === 'initialize') < calls.findIndex(c => c.settings), 'after initialize');
  assert.equal(JSON.stringify(starts(s)).includes('fastMode'), false, 'never in the CLI\'s arguments');
});

test('the model, effort and fast mode picked on a chat survive a server restart, so its status shows them and the CLI started for it is given all three', async () => {
  const s = await start({ claude: true, sessions: [calm] });
  const { token } = await signIn(s);
  const viewer = listen(s, token, 'calm');
  await post(s, token, '/api/sessions/calm/send', { text: 'finish the turn' });
  await until(() => viewer.events.some(e => e.type === 'turn-end'));
  viewer.close();
  for (const [action, value] of [['model', 'claude-opus-5-5'], ['effort', 'low'], ['fast', true]]) {
    assert.equal((await post(s, token, `/api/sessions/calm/${action}`, { [action]: value })).status, 200, action);
  }
  assert.deepEqual(picks(s), { calm: { model: 'claude-opus-5-5', effort: 'low', fast: true } });
  const logged = cliCalls(s).length;

  const restarted = await restart(s);
  const { token: again } = await signIn(restarted);
  const reconnected = listen(restarted, again, 'calm');
  await until(() => reconnected.events.some(e => e.type === 'status'));
  const { model, shownModel, effort, fast, running } = reconnected.events.find(e => e.type === 'status').data;
  assert.deepEqual({ model, shownModel, effort, fast, running }, { model: 'claude-opus-5-5', shownModel: 'claude-opus-5-5', effort: 'low', fast: true, running: false });

  await post(restarted, again, '/api/sessions/calm/send', { text: 'finish the turn' });
  await until(() => reconnected.events.some(e => e.type === 'turn-end'));
  reconnected.close();
  // The log is the first CLI's too, which can add its close after the restart, so the new CLI's entries are picked out by kind.
  const calls = cliCalls(restarted).slice(logged);
  const spawns = calls.filter(c => c.started);
  assert.equal(spawns.length, 1, 'one CLI was started after the restart');
  const args = spawns[0].started;
  for (const [flag, value] of [['--resume', 'calm'], ['--model', 'claude-opus-5-5'], ['--effort', 'low']]) {
    assert.ok(args.some((arg, i) => arg === flag && args[i + 1] === value), `${flag} ${value}`);
  }
  assert.equal(JSON.stringify(args).includes('fastMode'), false, 'never in the CLI\'s arguments');
  assert.deepEqual(calls.filter(c => c.settings).map(c => c.settings), [{ fastMode: true }]);
  const initialized = calls.findIndex(c => c.control === 'initialize');
  assert.ok(initialized >= 0 && initialized < calls.findIndex(c => c.settings), 'after initialize');
});

test('a fast mode that is not true or false, and a session that is not there, are refused and ask nothing of Claude', async () => {
  const s = await start({ claude: true, sessions: [calm] });
  const { token } = await signIn(s);
  for (const body of [{}, { fast: 'true' }, { fast: 1 }, { fast: null }, { fast: [true] }]) {
    const res = await post(s, token, '/api/sessions/calm/fast', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(res.body(), { error: 'Unknown fast.' });
  }
  assert.equal((await post(s, token, '/api/sessions/nobody/fast', { fast: true })).status, 404);
  assert.deepEqual(cliCalls(s), []);
  assert.equal(fs.existsSync(path.join(s.state, 'picks.json')), false, 'nothing was remembered');
});

test('a new session started in fast mode asks Claude for it after initialize and remembers it, and a fast mode that is not true or false is refused before any CLI starts', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const bad = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', fast: 'yes' });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body(), { error: 'Unknown fast mode.' });
  assert.deepEqual(cliCalls(s), []);

  const made = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', model: 'claude-opus-5-5', effort: 'high', fast: true });
  assert.equal(made.status, 200);
  const { id } = made.body();
  assert.deepEqual(picks(s), { [id]: { model: 'claude-opus-5-5', effort: 'high', fast: true } });
  const calls = cliCalls(s);
  assert.deepEqual(flags(s), [{ fastMode: true }]);
  assert.ok(calls.findIndex(c => c.control === 'initialize') < calls.findIndex(c => c.settings), 'after initialize');
  assert.equal(JSON.stringify(starts(s)).includes('fastMode'), false, 'never in the CLI\'s arguments');
});

test('a new session started with fast mode off asks for nothing about it and remembers nothing', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const made = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', model: 'claude-sonnet-5-5', fast: false });
  assert.equal(made.status, 200);
  assert.deepEqual(picks(s), { [made.body().id]: { model: 'claude-sonnet-5-5' } });
  assert.deepEqual(flags(s), []);
});
