// Run with `npm test`. Which Claude account each session runs on, over HTTP against the real server and a fake CLI that takes its transcripts from
// CLAUDE_CONFIG_DIR as the real one does. The library parts have their own tests in accounts.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { as, cliCalls, listen, request, restart, signIn, start, until as waitFor } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
const ACCOUNTS = [{ name: 'Default', configDir: '~/.claude' }, { name: 'SSW', configDir: '~/.claude-ssw', folders: ['~/ssw'] }];
// Each test starts CLIs, which a busy machine can be slow to launch, so these wait longer than the harness does.
const until = (check, ms = 20_000) => waitFor(check, ms);

const get = async (s, token, route) => (await request(s, 'GET', route, { headers: as(token) })).body();
const post = (s, token, route, json) => request(s, 'POST', route, { headers: as(token), json: json ?? {} });
const startsOf = s => cliCalls(s).filter(c => c.started);
const flagOf = (argv, name) => argv[argv.indexOf(name) + 1];
const recordsOf = s => JSON.parse(fs.readFileSync(path.join(s.state, 'accounts.json'), 'utf8'));
const recorded = s => fs.existsSync(path.join(s.state, 'accounts.json'));

async function ready(mine) {
  const s = await start({ accounts: ACCOUNTS, claude: true, ...mine });
  const ssw = path.join(s.home, 'ssw');
  fs.mkdirSync(ssw, { recursive: true });
  return { s, ssw, sswDir: path.join(s.home, '.claude-ssw'), defaultDir: path.join(s.home, '.claude'), ...(await signIn(s)) };
}

// Every row in the list, wherever the index puts it.
function rowsOf(value, found = new Map()) {
  if (Array.isArray(value)) value.forEach(v => rowsOf(v, found));
  else if (value && typeof value === 'object') {
    if (typeof value.id === 'string' && 'cwd' in value) found.set(value.id, value);
    Object.values(value).forEach(v => rowsOf(v, found));
  }
  return found;
}

// ---- starting a session -----------------------------------------------------------------------------

test('a new session in an account\'s folder runs on that account with its config folder, writes its transcript there, and is recorded', async () => {
  const { s, token, ssw, sswDir, defaultDir } = await ready({ env: { CLAUDE_CONFIG_DIR: '/inherited', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/inherited-storage' } });
  const made = await post(s, token, '/api/new', { cwd: ssw, text: 'begin a saved session' });
  assert.equal(made.status, 200, made.text);
  const [{ configDir, secureStorage }] = startsOf(s);
  assert.equal(configDir, sswDir, 'the folder as the config gives it, not the one the server was started with');
  assert.equal(secureStorage, undefined, 'the override of the Keychain entry is not passed on');
  assert.ok(fs.existsSync(path.join(sswDir, 'projects', '-saved-folder', 'begun-by-the-fake.jsonl')));
  assert.equal(fs.existsSync(path.join(defaultDir, 'projects', '-saved-folder')), false);
  assert.deepEqual(recordsOf(s), { 'begun-by-the-fake': sswDir });
});

test('the default account runs with no config folder at all, even when the server was started with one', async () => {
  const { s, token, defaultDir } = await ready({ env: { CLAUDE_CONFIG_DIR: '/inherited', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/inherited-storage' } });
  const made = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a saved session' });
  assert.equal(made.status, 200, made.text);
  const [{ configDir, secureStorage }] = startsOf(s);
  assert.deepEqual([configDir, secureStorage], [undefined, undefined]);
  assert.ok(fs.existsSync(path.join(defaultDir, 'projects', '-saved-folder', 'begun-by-the-fake.jsonl')));
  assert.deepEqual(recordsOf(s), { 'begun-by-the-fake': defaultDir });
});

test('an account named in the request wins over the folder, in any case, and a name that is not one is refused and starts nothing', async () => {
  const { s, token, sswDir } = await ready();
  for (const account of ['Nobody', 3, '', ['SSW']]) {
    const res = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', account });
    assert.deepEqual([res.status, res.body().error], [400, 'Unknown account.'], JSON.stringify(account));
  }
  assert.deepEqual(startsOf(s), []);
  assert.equal((await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', account: 'ssw' })).status, 200);
  assert.equal(startsOf(s)[0].configDir, sswDir, 'a folder outside the account\'s own, started on it');

  const other = await ready();
  assert.equal((await post(other.s, other.token, '/api/new', { cwd: other.ssw, text: 'begin a session', account: 'Default' })).status, 200);
  assert.equal(startsOf(other.s)[0].configDir, undefined, 'a folder of the SSW account, started on the default');

  const none = await ready();
  assert.equal((await post(none.s, none.token, '/api/new', { cwd: none.ssw, text: 'begin a session', account: null })).status, 200);
  assert.equal(startsOf(none.s)[0].configDir, none.sswDir, 'no account named leaves it to the folder');
});

// ---- a folder that is another name for one already in use ------------------------------------------

const alias = (s, to, name) => fs.symlinkSync(path.join(s.home, to), path.join(s.home, name));

test('an account whose folder is a link to ~/.claude is refused on a start, a send and a probe, with how to list it, and starts nothing', async () => {
  const s = await start({ accounts: [{ name: 'Personal', configDir: '~/.claude-link', absent: true }], claude: true, sessions: [{ id: 'desk', title: 'A Desktop chat' }] });
  alias(s, '.claude', '.claude-link');
  const { token } = await signIn(s);
  const why = `The Personal account's folder ${path.join(s.home, '.claude-link')} is the same folder as ~/.claude, so it would run on a different login from Claude Desktop's. List that folder as ~/.claude in accounts.`;
  const outcomes = [
    await post(s, token, '/api/sessions/desk/send', { text: 'hello' }),
    await post(s, token, '/api/sessions/desk/mode', { mode: 'plan' }),
    await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' }),
    await post(s, token, '/api/commands', { cwd: s.home }),
    await post(s, token, '/api/models', { cwd: s.home }),
  ];
  assert.deepEqual(outcomes.map(r => [r.status, r.body().error]), outcomes.map(() => [409, why]));
  assert.deepEqual(startsOf(s), []);
  assert.equal(recorded(s), false);
});

test('two accounts whose folders are one folder are both refused with how to list it once, while the others run', async () => {
  const s = await start({ accounts: [ACCOUNTS[0], ACCOUNTS[1], { name: 'Shadow', configDir: '~/.claude-shadow', absent: true }], claude: true });
  alias(s, '.claude-ssw', '.claude-shadow');
  const { token } = await signIn(s);
  const twins = (name, other, dir, otherDir) => `The ${name} account's folder ${path.join(s.home, dir)} is the same folder as the ${other} account's, ${path.join(s.home, otherDir)}, so GhostShell cannot tell their sessions apart. List that folder once in accounts.`;
  const ssw = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', account: 'SSW' });
  assert.deepEqual([ssw.status, ssw.body().error], [409, twins('SSW', 'Shadow', '.claude-ssw', '.claude-shadow')]);
  const shadow = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', account: 'Shadow' });
  assert.deepEqual([shadow.status, shadow.body().error], [409, twins('Shadow', 'SSW', '.claude-shadow', '.claude-ssw')]);
  assert.deepEqual(startsOf(s), []);
  assert.equal((await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', account: 'Default' })).status, 200, 'an account that shares its folder with none is not held up');
});

test('a folder that differs from ~/.claude only by case is refused the same way on a disk that ignores case', async t => {
  const s = await start({ accounts: [{ name: 'Personal', configDir: '~/.Claude' }], claude: true });
  if (fs.statSync(path.join(s.home, '.claude')).ino !== fs.statSync(path.join(s.home, '.Claude')).ino) return t.skip('this disk tells case apart');
  const { token } = await signIn(s);
  const res = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' });
  assert.deepEqual([res.status, res.body().error], [409, `The Personal account's folder ${path.join(s.home, '.Claude')} is the same folder as ~/.claude, so it would run on a different login from Claude Desktop's. List that folder as ~/.claude in accounts.`]);
  assert.deepEqual(startsOf(s), []);
});

test('an account that has never been logged in is refused with how to log in, and starts nothing and makes no folder', async () => {
  const { s, token, ssw, sswDir } = await ready({ accounts: [ACCOUNTS[0], { ...ACCOUNTS[1], absent: true }] });
  const res = await post(s, token, '/api/new', { cwd: ssw, text: 'begin a session' });
  assert.equal(res.status, 409);
  assert.equal(res.body().error, `The SSW account is not logged in yet. In a terminal run CLAUDE_CONFIG_DIR=${sswDir} claude, then use /login.`);
  assert.deepEqual(startsOf(s), []);
  assert.equal(fs.existsSync(sswDir), false);
  assert.equal(fs.existsSync(path.join(s.state, 'accounts.json')), false, 'nothing is recorded for a start that did not happen');
  assert.equal((await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' })).status, 200, 'the default account is not held up by it');
});

// ---- spawning a session again -----------------------------------------------------------------------

test('a session whose transcript is under an account is resumed on it, whatever its folder, when its record agrees', async () => {
  const { s, token, sswDir } = await ready({ sessions: [{ id: 'work', account: 'SSW' }] });
  fs.writeFileSync(path.join(s.state, 'accounts.json'), JSON.stringify({ work: sswDir }));
  assert.equal((await post(s, token, '/api/sessions/work/send', { text: 'hello' })).status, 200);
  await until(() => startsOf(s).length === 1);
  const [{ started, configDir }] = startsOf(s);
  assert.equal(flagOf(started, '--resume'), 'work');
  assert.equal(configDir, sswDir);
  assert.deepEqual(recordsOf(s), { work: sswDir }, 'the record is left as it was');
});

test('a session whose record names another account than its transcript is refused naming both, and starts nothing', async () => {
  const { s, token, defaultDir, sswDir } = await ready({ sessions: [{ id: 'work', account: 'SSW' }] });
  fs.writeFileSync(path.join(s.state, 'accounts.json'), JSON.stringify({ work: defaultDir }));
  const why = 'Session work started on the Default account but its transcript is under the SSW account, so GhostShell will not pick one. Check which holds the session, then correct its entry in accounts.json or move the stray transcript away.';
  const sent = await post(s, token, '/api/sessions/work/send', { text: 'hello' });
  assert.deepEqual([sent.status, sent.body().error], [409, why]);
  const moded = await post(s, token, '/api/sessions/work/mode', { mode: 'plan' });
  assert.deepEqual([moded.status, moded.body().error], [409, why]);
  assert.deepEqual(startsOf(s), []);
  assert.deepEqual(recordsOf(s), { work: defaultDir }, 'and the record is left as it was');
  assert.ok(fs.existsSync(path.join(sswDir, 'projects', '-test-folder', 'work.jsonl')), 'the transcript is left where it is');
});

test('a session recorded on an account that cannot be read is not resumed on the account that holds a copy', { skip: process.getuid?.() === 0 && 'root reads any folder' }, async () => {
  const r = await ready({ sessions: [{ id: 'dup', account: ['Default', 'SSW'] }] });
  fs.writeFileSync(path.join(r.s.state, 'accounts.json'), JSON.stringify({ dup: r.sswDir }));
  const projects = path.join(r.sswDir, 'projects');
  fs.chmodSync(projects, 0o000);
  try {
    // The server starts again so that the account has never been read, and its copy cannot be seen.
    const s = await restart(r.s);
    const { token } = await signIn(s);
    const sent = await post(s, token, '/api/sessions/dup/send', { text: 'hello' });
    assert.deepEqual([sent.status, sent.body().error], [409, 'Session dup started on the SSW account but its transcript is under the Default account, so GhostShell will not pick one. Check which holds the session, then correct its entry in accounts.json or move the stray transcript away.']);
    assert.deepEqual(startsOf(s), []);
    assert.deepEqual(recordsOf(s), { dup: r.sswDir });
  } finally {
    fs.chmodSync(projects, 0o755);
  }
});

test('a session with a transcript and no record is recorded on the account of its transcript at its first spawn, and not before', async () => {
  const { s, token, sswDir, defaultDir } = await ready({ sessions: [{ id: 'work', account: 'SSW' }, { id: 'plain' }] });
  assert.equal(recorded(s), false);
  assert.equal((await get(s, token, '/api/sessions/work/messages')).session.account, 'SSW');
  assert.equal(recorded(s), false, 'showing it records nothing');
  assert.equal((await post(s, token, '/api/sessions/work/send', { text: 'hello' })).status, 200);
  await until(() => startsOf(s).length === 1);
  assert.deepEqual(recordsOf(s), { work: sswDir });
  assert.equal((await post(s, token, '/api/sessions/plain/send', { text: 'hello' })).status, 200);
  await until(() => startsOf(s).length === 2);
  assert.deepEqual(recordsOf(s), { work: sswDir, plain: defaultDir });
  assert.deepEqual(startsOf(s).map(c => c.configDir), [sswDir, undefined]);
});

test('a session with a transcript and no record is refused while an account cannot be read, as a copy may be there, and runs and is recorded once it can', { skip: process.getuid?.() === 0 && 'root reads any folder' }, async () => {
  const r = await ready({ sessions: [{ id: 'old' }, { id: 'work', account: 'SSW' }] });
  const projects = path.join(r.sswDir, 'projects');
  fs.chmodSync(projects, 0o000);
  try {
    const s = await restart(r.s);
    const { token } = await signIn(s);
    const sent = await post(s, token, '/api/sessions/old/send', { text: 'hello' });
    assert.deepEqual([sent.status, sent.body().error], [409, 'GhostShell cannot tell whether session old also has a transcript under the SSW account, as it cannot read its sessions.']);
    assert.equal((await post(s, token, '/api/sessions/old/mode', { mode: 'plan' })).status, 409);
    assert.deepEqual(startsOf(s), []);
    assert.equal(recorded(s), false);

    fs.chmodSync(projects, 0o755);
    await get(s, token, '/api/sessions/work/messages');
    assert.equal((await post(s, token, '/api/sessions/old/send', { text: 'hello' })).status, 200);
    await until(() => startsOf(s).length === 1);
    assert.deepEqual(recordsOf(s), { old: path.join(s.home, '.claude') });
  } finally {
    fs.chmodSync(projects, 0o755);
  }
});

test('after a restart a session with a transcript is resumed on the account it started on', async () => {
  const { s, token, ssw, sswDir } = await ready();
  assert.equal((await post(s, token, '/api/new', { cwd: ssw, text: 'begin a saved session' })).status, 200);
  const again = await restart(s);
  const second = await signIn(again);
  assert.equal((await post(again, second.token, '/api/sessions/begun-by-the-fake/send', { text: 'hello again' })).status, 200);
  await until(() => startsOf(again).length === 2);
  const resumed = startsOf(again)[1];
  assert.equal(flagOf(resumed.started, '--resume'), 'begun-by-the-fake');
  assert.equal(resumed.configDir, sswDir);
});

test('after a restart a session that has no transcript yet is started again on the account it was recorded on, not the folder\'s', async () => {
  const { s, token, sswDir } = await ready();
  assert.equal((await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', account: 'SSW' })).status, 200);
  assert.deepEqual(recordsOf(s), { 'begun-by-the-fake': sswDir });
  const again = await restart(s);
  const second = await signIn(again);
  assert.equal((await post(again, second.token, '/api/sessions/begun-by-the-fake/send', { text: 'hello again' })).status, 200);
  await until(() => startsOf(again).length === 2);
  const resumed = startsOf(again)[1];
  assert.equal(flagOf(resumed.started, '--resume'), 'begun-by-the-fake');
  assert.equal(resumed.configDir, sswDir);
});

test('a session is never moved: a record of an account the config no longer lists, a transcript under two accounts and a record that cannot be read each refuse it and start nothing', async () => {
  const unlisted = await ready({ groups: [{ id: 'cg-work', name: 'Work', session: WORK }] });
  fs.writeFileSync(path.join(unlisted.s.state, 'accounts.json'), JSON.stringify({ [WORK]: '/not/in/config' }));
  const viewer = listen(unlisted.s, unlisted.token, WORK);
  try {
    const res = await post(unlisted.s, unlisted.token, `/api/sessions/${WORK}/send`, { text: 'begin a session' });
    assert.deepEqual([res.status, res.body().error], [409, 'This session started on the account in /not/in/config, which config.json no longer lists. Add that account back to use the session.']);
    await until(() => viewer.events.some(e => e.type === 'error'));
    assert.match(viewer.events.find(e => e.type === 'error').data.message, /which config\.json no longer lists/, 'the page that opens it is told why it will not run');
  } finally {
    viewer.close();
  }
  assert.deepEqual(startsOf(unlisted.s), []);

  const both = await ready({ sessions: [{ id: 'dup', account: ['Default', 'SSW'] }] });
  const twice = await post(both.s, both.token, '/api/sessions/dup/send', { text: 'hello' });
  assert.deepEqual([twice.status, twice.body().error], [409, 'Session dup has a transcript under both Default and SSW, so GhostShell will not pick one. Move one of the two files away.']);
  assert.deepEqual(startsOf(both.s), []);

  const corrupt = await ready({ groups: [{ id: 'cg-work', name: 'Work', session: WORK }] });
  fs.writeFileSync(path.join(corrupt.s.state, 'accounts.json'), '{ not json');
  const broken = await post(corrupt.s, corrupt.token, `/api/sessions/${WORK}/send`, { text: 'begin a session' });
  assert.equal(broken.status, 500);
  assert.match(broken.body().error, /^accounts\.json cannot be read/);
  assert.deepEqual(startsOf(corrupt.s), []);
  assert.equal(fs.readFileSync(path.join(corrupt.s.state, 'accounts.json'), 'utf8'), '{ not json', 'and it is not written over');
});

// ---- what a session starts for itself ---------------------------------------------------------------

test('a chip starts its session on the account of the session that made it, whatever folder the chip names', async () => {
  const { s, token, sswDir } = await ready({ sessions: [{ id: 'maker', account: 'SSW' }] });
  const res = await post(s, token, '/api/chips/start', { sessionId: 'maker', toolUseId: 'toolu_a', title: 'Follow up', prompt: 'begin a session', cwd: s.home });
  assert.equal(res.status, 200, res.text);
  assert.equal(startsOf(s)[0].configDir, sswDir);
  assert.deepEqual(recordsOf(s), { 'begun-by-the-fake': sswDir });
});

const textOf = reply => reply.result.content[0].text;
const replies = s => cliCalls(s).filter(c => c.mcp).map(c => c.mcp);
async function callTool(s, token, id, tool, args) {
  const before = replies(s).length;
  assert.equal((await post(s, token, `/api/sessions/${id}/send`, { text: `call ${tool} ${JSON.stringify(args)}` })).status, 200);
  await until(() => replies(s).length > before);
  return replies(s)[before];
}

test('a group\'s chat starts on the account its members are on, and a session it starts follows it', async () => {
  const { s, token, sswDir } = await ready({
    groups: [{ id: 'cg-work', name: 'Work', session: WORK }],
    sessions: [{ id: 'a', title: 'Member A', group: 'cg-work', account: 'SSW' }, { id: 'b', title: 'Member B', group: 'cg-work', account: 'SSW' }],
  });
  assert.equal((await post(s, token, `/api/sessions/${WORK}/send`, { text: 'begin a session' })).status, 200);
  await until(() => startsOf(s).length === 1);
  assert.equal(startsOf(s)[0].configDir, sswDir);
  const reply = await callTool(s, token, WORK, 'start_group_session', { cwd: s.home, prompt: 'begin a session' });
  assert.match(textOf(reply), /^Started session \[begun-by-the-fake\]/);
  await until(() => startsOf(s).length === 2);
  assert.equal(startsOf(s)[1].configDir, sswDir, 'the group\'s tool does not take it back to the folder\'s account');
  assert.equal(recordsOf(s)['begun-by-the-fake'], sswDir);
});

test('a group whose members are on different accounts starts its chat on the first account', async () => {
  const { s, token } = await ready({
    groups: [{ id: 'cg-work', name: 'Work', session: WORK }],
    sessions: [{ id: 'a', title: 'Member A', group: 'cg-work', account: 'SSW' }, { id: 'b', title: 'Member B', group: 'cg-work' }],
  });
  assert.equal((await post(s, token, `/api/sessions/${WORK}/send`, { text: 'begin a session' })).status, 200);
  await until(() => startsOf(s).length === 1);
  assert.equal(startsOf(s)[0].configDir, undefined);
});

// ---- a session with nothing to say which account it is on -------------------------------------------

const UNLISTED = [{ name: 'SSW', configDir: '~/.claude-ssw' }, { name: 'Other', configDir: '~/.claude-other' }];

test('a group\'s chat whose transcript sits under a folder the config does not list is refused naming the folder, and starts and records nothing', async () => {
  const { s, token, defaultDir } = await ready({ accounts: UNLISTED, groups: [{ id: 'cg-work', name: 'Work', session: WORK }], sessions: [{ id: WORK, title: 'chat', source: 'cli' }] });
  const res = await post(s, token, `/api/sessions/${WORK}/send`, { text: 'hello' });
  const folder = path.join(defaultDir, 'projects', '-test-folder');
  assert.equal(res.status, 409, res.text);
  assert.ok(res.body().error.includes(`${folder}, which GhostShell cannot match to one account in config.json`), res.body().error);
  assert.deepEqual(startsOf(s), []);
  assert.equal(recorded(s), false);
  assert.ok(fs.existsSync(path.join(folder, `${WORK}.jsonl`)), 'the transcript is left where it is');
});

test('a chip is refused when the session that made it has a transcript under a folder the config does not list', async () => {
  const { s, token } = await ready({ accounts: UNLISTED, sessions: [{ id: 'maker', title: 'maker', source: 'cli' }] });
  const res = await post(s, token, '/api/chips/start', { sessionId: 'maker', toolUseId: 'toolu_x', title: 'Follow up', prompt: 'begin a session', cwd: s.home, confirmCwd: s.home });
  assert.deepEqual([res.status, res.body().error], [409, 'GhostShell cannot tell which account this session is on.']);
  assert.deepEqual(startsOf(s), []);
  assert.equal(recorded(s), false);
});

test('a session Capcom started that has no transcript to be seen and no record is refused, not started on the default account', async () => {
  const { s, token } = await ready();
  fs.writeFileSync(path.join(s.state, 'started.json'), JSON.stringify([{ id: 'orphan', cwd: s.home, at: Date.now(), title: 'Orphan' }]));
  const sent = await post(s, token, '/api/sessions/orphan/send', { text: 'hello' });
  assert.deepEqual([sent.status, sent.body().error], [409, 'GhostShell cannot tell which account this session is on.']);
  const moded = await post(s, token, '/api/sessions/orphan/mode', { mode: 'plan' });
  assert.equal(moded.status, 409);
  assert.deepEqual(startsOf(s), []);
  assert.equal(recorded(s), false);
});

test('a group\'s chat is recorded on its account when it is booked, and is not looked for in other folders afterwards', async () => {
  const { s, token, sswDir } = await ready({
    groups: [{ id: 'cg-work', name: 'Work' }],
    sessions: [{ id: 'a', title: 'Member A', group: 'cg-work', account: 'SSW' }, { id: 'b', title: 'Member B', group: 'cg-work', account: 'SSW' }],
  });
  const { id } = (await post(s, token, '/api/groups/cg-work/session')).body();
  assert.deepEqual(recordsOf(s), { [id]: sswDir }, 'booked on the account its members are on, with nothing started');
  assert.equal((await post(s, token, '/api/groups/cg-work/session')).body().id, id);
  assert.deepEqual(recordsOf(s), { [id]: sswDir }, 'booking it again changes nothing');
  assert.deepEqual(startsOf(s), []);
  assert.equal((await post(s, token, `/api/sessions/${id}/send`, { text: 'begin a session' })).status, 200);
  await until(() => startsOf(s).length === 1);
  assert.equal(startsOf(s)[0].configDir, sswDir);
  assert.equal(flagOf(startsOf(s)[0].started, '--session-id'), id);
});

test('a group\'s chat booked before accounts is looked for in the folder the server was started with, and is refused when a transcript is there', async () => {
  const inherited = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-inherited-'));
  fs.mkdirSync(path.join(inherited, 'projects', '-group-folder'), { recursive: true });
  fs.writeFileSync(path.join(inherited, 'projects', '-group-folder', `${WORK}.jsonl`), `${JSON.stringify({ type: 'user', cwd: inherited, message: { role: 'user', content: 'an earlier turn' } })}\n`);
  const folder = path.join(inherited, 'projects', '-group-folder');
  const layouts = [{ groups: [{ id: 'cg-work', name: 'Work', session: WORK }] }, { layout: { retired: [{ id: 'cg-old', name: 'Old', project: null, session: WORK }] } }];
  for (const mine of layouts) {
    const { s, token } = await ready({ env: { CLAUDE_CONFIG_DIR: inherited }, ...mine });
    const res = await post(s, token, `/api/sessions/${WORK}/send`, { text: 'hello' });
    assert.equal(res.status, 409, res.text);
    assert.ok(res.body().error.includes(`transcript in ${folder}, which GhostShell cannot match to one account in config.json`), res.body().error);
    assert.deepEqual(startsOf(s), []);
    assert.equal(recorded(s), false);
    assert.ok(fs.existsSync(path.join(folder, `${WORK}.jsonl`)), 'the transcript is left where it is');
    assert.equal(fs.existsSync(path.join(s.home, '.claude', 'projects', '-group-folder')), false, 'and no second one is made');
  }
});

test('a group\'s chat booked before accounts that has no transcript anywhere is new, and is recorded on its account at its first spawn', async () => {
  const { s, token, defaultDir } = await ready({ env: { CLAUDE_CONFIG_DIR: '/inherited' }, groups: [{ id: 'cg-work', name: 'Work', session: WORK }] });
  assert.equal((await post(s, token, `/api/sessions/${WORK}/send`, { text: 'begin a session' })).status, 200);
  await until(() => startsOf(s).length === 1);
  assert.equal(flagOf(startsOf(s)[0].started, '--session-id'), WORK);
  assert.deepEqual(recordsOf(s), { [WORK]: defaultDir });
});

test('a group\'s chat on an account never logged in is refused before anything is recorded', async () => {
  const { s, token, sswDir } = await ready({ accounts: [{ ...ACCOUNTS[1], absent: true }, ACCOUNTS[0]], groups: [{ id: 'cg-work', name: 'Work', session: WORK }] });
  const res = await post(s, token, `/api/sessions/${WORK}/send`, { text: 'hello' });
  assert.deepEqual([res.status, res.body().error], [409, `The SSW account is not logged in yet. In a terminal run CLAUDE_CONFIG_DIR=${sswDir} claude, then use /login.`]);
  assert.deepEqual(startsOf(s), []);
  assert.equal(recorded(s), false, 'a record would make the chat belong to an account it never ran on');
});

test('an account that cannot be read is not taken for one with nothing in it: what needs its sessions is refused, and runs again once it can be read', { skip: process.getuid?.() === 0 && 'root reads any folder' }, async () => {
  const r = await ready({
    groups: [{ id: 'cg-work', name: 'Work', session: WORK }],
    sessions: [{ id: WORK, title: 'chat', source: 'cli', account: 'SSW' }, { id: 'hidden', title: 'Hidden', source: 'capcom', ago: 1, account: 'SSW' }, { id: 'work', title: 'Work', account: 'SSW' }],
  });
  const projects = path.join(r.sswDir, 'projects');
  fs.chmodSync(projects, 0o000);
  try {
    // The server starts again so that the account has never been read, rather than read once and kept.
    const s = await restart(r.s);
    const { token } = await signIn(s);
    const cannot = ' as it cannot read the sessions of the SSW account.';
    const group = await post(s, token, `/api/sessions/${WORK}/send`, { text: 'hello' });
    assert.deepEqual([group.status, group.body().error], [409, `GhostShell cannot tell whether this group's chat is new,${cannot}`]);
    const started = await post(s, token, '/api/sessions/hidden/send', { text: 'hello' });
    assert.deepEqual([started.status, started.body().error], [409, `GhostShell cannot tell which account this session is on${cannot}`]);
    assert.equal((await post(s, token, '/api/sessions/hidden/mode', { mode: 'plan' })).status, 409);
    assert.equal((await post(s, token, '/api/sessions/work/mode', { mode: 'plan' })).status, 404, 'a session the list cannot show has no row to start a chat from');
    assert.equal((await post(s, token, '/api/sessions/work/send', { text: 'hello' })).status, 404);
    assert.deepEqual(startsOf(s), []);
    assert.equal(recorded(s), false);

    fs.chmodSync(projects, 0o755);
    await get(s, token, '/api/sessions/work/messages');
    for (const id of [WORK, 'hidden', 'work']) assert.equal((await post(s, token, `/api/sessions/${id}/send`, { text: 'hello' })).status, 200, id);
    await until(() => startsOf(s).length === 3);
    assert.deepEqual(startsOf(s).map(c => [flagOf(c.started, '--resume'), c.configDir]).sort(), [[WORK, r.sswDir], ['hidden', r.sswDir], ['work', r.sswDir]].sort());
    assert.deepEqual(recordsOf(s), { [WORK]: r.sswDir, hidden: r.sswDir, work: r.sswDir }, 'sessions found on an account are recorded on it at their first spawn');
  } finally {
    fs.chmodSync(projects, 0o755);
  }
});

test('a session whose account is found to be another while a chat of it is running is refused, and the chat is left on the account it started on', async () => {
  const { s, token, defaultDir, sswDir } = await ready();
  assert.equal((await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', account: 'SSW' })).status, 200);
  await until(() => startsOf(s).length === 1);
  fs.writeFileSync(path.join(s.state, 'accounts.json'), JSON.stringify({ 'begun-by-the-fake': defaultDir }));
  const sent = await post(s, token, '/api/sessions/begun-by-the-fake/send', { text: 'hello' });
  assert.deepEqual([sent.status, sent.body().error], [409, 'Session begun-by-the-fake is running on the SSW account but is now found on the Default account, so GhostShell will not move it.']);
  const moded = await post(s, token, '/api/sessions/begun-by-the-fake/mode', { mode: 'plan' });
  assert.equal(moded.status, 409);
  assert.equal(startsOf(s).length, 1);
  assert.equal(startsOf(s)[0].configDir, sswDir);
});

test('the mode of a session that is not in the list is a 404 and starts nothing', async () => {
  const { s, token } = await ready();
  const res = await post(s, token, '/api/sessions/nobody/mode', { mode: 'plan' });
  assert.equal(res.status, 404, res.text);
  assert.deepEqual(startsOf(s), []);
});

// ---- routines ---------------------------------------------------------------------------------------

async function routine(extra, mine) {
  const r = await ready(mine);
  const fields = typeof extra === 'function' ? extra(r) : extra;
  const file = path.join(r.s.home, 'SKILL.md');
  fs.writeFileSync(file, '---\nname: demo\ndescription: A demo\n---\n\nCheck the thing.\n');
  fs.writeFileSync(path.join(r.s.state, 'routines.json'), JSON.stringify({
    seededAt: '2026-10-16T00:00:00+11:00',
    routines: [{ id: 'demo', title: 'Demo', cron: '0 0 1 1 *', jitterSeconds: 0, file, cwd: r.s.home, model: null, effort: null, mode: null, enabledInDesktop: false, enabled: false, ...fields }],
  }));
  return r;
}

test('a routine runs on the account it names, otherwise on the one for its folder', async () => {
  const named = await routine({ account: 'ssw' });
  const ran = await post(named.s, named.token, '/api/routines/demo/run');
  assert.equal(ran.status, 200, ran.text);
  assert.equal(ran.body().routine.account, 'ssw');
  assert.equal(startsOf(named.s)[0].configDir, named.sswDir, 'a routine in a folder that is not the account\'s own');

  const byFolder = await routine(r => ({ cwd: r.ssw }));
  assert.equal((await post(byFolder.s, byFolder.token, '/api/routines/demo/run')).status, 200);
  assert.equal(startsOf(byFolder.s)[0].configDir, byFolder.sswDir);
  assert.equal(recordsOf(byFolder.s)['begun-by-the-fake'], byFolder.sswDir);

  const plain = await routine({});
  assert.equal((await post(plain.s, plain.token, '/api/routines/demo/run')).status, 200);
  assert.equal(startsOf(plain.s)[0].configDir, undefined);
  assert.equal((await get(plain.s, plain.token, '/api/routines')).routines[0].account, null);
});

test('a routine that names an account the config does not list is a problem, and does not run', async () => {
  const { s, token } = await routine({ account: 'Nobody' });
  const [item] = (await get(s, token, '/api/routines')).routines;
  assert.equal(item.problem, 'Unknown account Nobody.');
  const ran = await post(s, token, '/api/routines/demo/run');
  assert.deepEqual([ran.status, ran.body().error], [400, 'Unknown account Nobody.']);
  assert.deepEqual(startsOf(s), []);
});

// ---- the list of accounts, the defaults and the pickers ---------------------------------------------

test('with two accounts the lists, the open chat and its stream say which account a session is on, and the defaults offer the choice', async () => {
  const { s, token, ssw } = await ready({ sessions: [{ id: 'plain', title: 'Plain' }, { id: 'work', title: 'Work', account: 'SSW' }] });
  const rows = rowsOf(await get(s, token, '/api/sessions'));
  assert.deepEqual([rows.get('plain').account, rows.get('work').account], ['Default', 'SSW']);
  assert.equal((await get(s, token, '/api/sessions/work/messages')).session.account, 'SSW');
  assert.equal((await get(s, token, '/api/sessions/plain/messages')).session.account, 'Default');
  const viewer = listen(s, token, 'work');
  try {
    await until(() => viewer.events.length);
    assert.equal(viewer.events[0].type, 'status');
    assert.equal(viewer.events[0].data.account, 'SSW');
  } finally {
    viewer.close();
  }

  const folder = await get(s, token, `/api/defaults?cwd=${encodeURIComponent(ssw)}`);
  assert.deepEqual([folder.account, folder.accounts], ['SSW', ['Default', 'SSW']]);
  const chosen = await get(s, token, `/api/defaults?cwd=${encodeURIComponent(ssw)}&account=default`);
  assert.equal(chosen.account, 'Default');
  assert.equal((await request(s, 'GET', '/api/defaults?account=Nobody', { headers: as(token) })).status, 400);
});

test('with one account nothing on the page or in the API mentions accounts', async () => {
  const s = await start({ sessions: [{ id: 'plain', title: 'Plain' }], claude: true });
  const { token } = await signIn(s);
  const rows = rowsOf(await get(s, token, '/api/sessions'));
  assert.equal('account' in rows.get('plain'), false);
  assert.equal('account' in (await get(s, token, '/api/sessions/plain/messages')).session, false);
  const defaults = await get(s, token, '/api/defaults');
  assert.equal('account' in defaults || 'accounts' in defaults, false);
  const made = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session' });
  assert.equal(made.status, 200, made.text);
  assert.equal(startsOf(s)[0].configDir, undefined, 'it runs as it always did, with no config folder');
  const viewer = listen(s, token, 'begun-by-the-fake');
  try {
    await until(() => viewer.events.length);
    assert.equal('account' in viewer.events[0].data, false);
  } finally {
    viewer.close();
  }
});

test('the / list and the models are asked for on the account chosen with the folder, and each account keeps its own', async () => {
  const { s, token, ssw } = await ready();
  const ask = (what, json) => post(s, token, `/api/${what}`, json);
  assert.equal((await ask('commands', { cwd: s.home, account: 'Nobody' })).status, 400);
  assert.equal((await ask('models', { cwd: s.home, account: 3 })).status, 400);
  assert.equal((await ask('commands', { cwd: ssw })).status, 200);
  assert.equal((await ask('models', { cwd: ssw, account: 'Default' })).status, 200);
  await until(() => startsOf(s).length === 2);
  assert.deepEqual(startsOf(s).map(c => c.configDir), [path.join(s.home, '.claude-ssw'), undefined]);
});

test('the / list and the models of an account never logged in are refused with how to log in, and start nothing', async () => {
  const { s, token, ssw, sswDir } = await ready({ accounts: [ACCOUNTS[0], { ...ACCOUNTS[1], absent: true }] });
  for (const what of ['commands', 'models']) {
    const res = await post(s, token, `/api/${what}`, { cwd: ssw });
    assert.deepEqual([res.status, res.body().error], [409, `The SSW account is not logged in yet. In a terminal run CLAUDE_CONFIG_DIR=${sswDir} claude, then use /login.`], what);
  }
  assert.deepEqual(startsOf(s), []);
  assert.equal(fs.existsSync(sswDir), false);
  assert.equal((await post(s, token, '/api/commands', { cwd: s.home })).status, 200, 'the default account is not held up by it');
});

// ---- what the session inherits ----------------------------------------------------------------------

const KEYS = { ANTHROPIC_API_KEY: 'key', ANTHROPIC_AUTH_TOKEN: 'token', CLAUDE_CODE_OAUTH_TOKEN: 'oauth' };

test('with two accounts the API key and tokens in the server\'s environment reach no session, and with one they are passed on as before', async () => {
  const two = await ready({ env: KEYS });
  for (const cwd of [two.s.home, two.ssw]) assert.equal((await post(two.s, two.token, '/api/new', { cwd, text: 'begin a session' })).status, 200);
  assert.deepEqual(startsOf(two.s).map(c => c.ambient), [undefined, undefined]);

  const one = await start({ claude: true, env: KEYS });
  const { token } = await signIn(one);
  assert.equal((await post(one, token, '/api/new', { cwd: one.home, text: 'begin a session' })).status, 200);
  assert.deepEqual(startsOf(one)[0].ambient, Object.keys(KEYS));
});
