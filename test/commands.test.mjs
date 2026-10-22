// Run with `npm test`. The commands the prompt box's / list shows: how the CLI's list is tidied, and how a folder's list is asked for,
// shared and kept. The CLI is a small script that logs each start, so a start that should not have happened shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCommands, rememberCommands, tidy } from '../lib/commands.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-commands-test-'));
const wait = ms => new Promise(done => setTimeout(done, ms));

// What the CLI lists, as the real one does: `clear` and `__remote-workflow` are for tidy to leave out.
const LISTED = [
  { name: 'review-pr', description: 'Review a pull request', argumentHint: '[number]' },
  { name: 'clear', description: 'Clear the conversation', builtin: true },
  { name: 'code-review', description: 'Review the diff', argumentHint: '[level]', builtin: true, aliases: ['review'] },
  { name: '__remote-workflow', builtin: true },
];
const TIDIED = [
  { name: 'review-pr', description: 'Review a pull request', hint: '[number]', aliases: [] },
  { name: 'code-review', description: 'Review the diff', hint: '[level]', aliases: ['review'] },
];

// A CLI that logs each start (its process, arguments and folder), then answers an initialize request the way its mode file says:
// 'answer' with LISTED, 'slow' with LISTED after 400 ms, 'bare' with no commands, 'refuse' with an error, 'silent' not at all, and
// 'fail' by writing a message and exiting at once. Before its reply it writes lines the probe has to ignore.
function stubCli() {
  const dir = fs.mkdtempSync(path.join(base, 'cli-'));
  const cli = path.join(dir, 'claude.mjs');
  const log = path.join(dir, 'starts.log');
  const modeFile = path.join(dir, 'mode');
  fs.writeFileSync(modeFile, 'answer');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import readline from 'node:readline';",
    `const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8').trim();`,
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ pid: process.pid, args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');`,
    "if (mode === 'fail') process.stderr.write('Setting up\\nThe fake CLI could not start.\\n', () => process.exit(1));",
    "const say = message => process.stdout.write(JSON.stringify(message) + '\\n');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'control_request' || m.request.subtype !== 'initialize' || mode === 'silent') return;",
    '  const reply = {',
    "    answer: { subtype: 'success', request_id: m.request_id, response: { commands: COMMANDS } },",
    "    slow: { subtype: 'success', request_id: m.request_id, response: { commands: COMMANDS } },",
    "    bare: { subtype: 'success', request_id: m.request_id, response: {} },",
    "    refuse: { subtype: 'error', request_id: m.request_id, error: 'The fake CLI refused.' },",
    '  }[mode];',
    '  setTimeout(() => {',
    "    process.stdout.write('this is not json\\n');",
    "    say({ type: 'system', subtype: 'init' });",
    "    say({ type: 'control_response', response: { subtype: 'success', request_id: 'someone-else', response: { commands: [] } } });",
    "    say({ type: 'control_response', response: reply });",
    "  }, mode === 'slow' ? 400 : 0);",
    "}).on('close', () => process.exit(0));",
    `const COMMANDS = ${JSON.stringify(LISTED)};`,
    '',
  ].join('\n'), { mode: 0o755 });
  return {
    cli,
    mode: value => fs.writeFileSync(modeFile, value),
    starts: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []),
  };
}

const folder = () => fs.mkdtempSync(path.join(base, 'folder-'));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const gone = async pid => {
  for (let i = 0; i < 150 && alive(pid); i++) await wait(20);
  return !alive(pid);
};

test('tidy keeps each command\'s name, description, argument hint and aliases, in the CLI\'s order', () => {
  assert.deepEqual(tidy(LISTED), TIDIED);
});

test('tidy leaves out /clear and the names that start with two underscores', () => {
  const names = tidy([{ name: 'clear' }, { name: '__remote-workflow' }, { name: '__' }, { name: 'clearly' }, { name: 'a__b' }]).map(c => c.name);
  assert.deepEqual(names, ['clearly', 'a__b']);
});

test('tidy turns every run of white space in a description or hint into one space', () => {
  const [c] = tidy([{ name: 'a', description: '  Review a pull request  (user)\n\tand more ', argumentHint: ' [one]\n[two] ' }]);
  assert.deepEqual([c.description, c.hint], ['Review a pull request (user) and more', '[one] [two]']);
});

test('tidy cuts a description to 200 characters with an ellipsis, counting characters rather than code units', () => {
  const of = description => tidy([{ name: 'a', description }])[0].description;
  assert.equal(of('x'.repeat(200)), 'x'.repeat(200));
  assert.equal(of('x'.repeat(201)), `${'x'.repeat(199)}…`);
  assert.equal(of('😀'.repeat(250)), `${'😀'.repeat(199)}…`);
  assert.equal(of(`${'a'.repeat(198)} ${'b'.repeat(50)}`), `${'a'.repeat(198)}…`, 'no space is left before the ellipsis');
});

test('tidy drops a command whose name came before, and anything in the list that is not a command', () => {
  const list = tidy([{ name: 'a', description: 'first' }, null, 'b', 5, {}, { name: '' }, { name: 7 }, { name: 'a', description: 'second' }, { name: 'c' }]);
  assert.deepEqual(list.map(c => [c.name, c.description]), [['a', 'first'], ['c', '']]);
});

test('tidy gives nothing when the CLI\'s answer is not a list', () => {
  for (const answer of [undefined, null, {}, 'commands', 7]) assert.deepEqual(tidy(answer), []);
});

test('tidy gives a command with no description, hint or aliases empty ones, and keeps only the aliases that are names', () => {
  assert.deepEqual(tidy([{ name: 'a' }]), [{ name: 'a', description: '', hint: '', aliases: [] }]);
  assert.deepEqual(tidy([{ name: 'a', aliases: ['x', '', 3, null, 'y'] }])[0].aliases, ['x', 'y']);
  assert.deepEqual(tidy([{ name: 'a', aliases: 'x' }])[0].aliases, []);
});

test('the commands of a folder come from a CLI started there that makes no session, no MCP server and no hook, and that stops once it has answered', async () => {
  const cli = stubCli();
  const cwd = folder();
  assert.deepEqual(await listCommands(cwd, cli.cli), TIDIED);
  const started = cli.starts();
  assert.equal(started.length, 1);
  assert.equal(started[0].cwd, fs.realpathSync(cwd));
  for (const flag of ['-p', '--strict-mcp-config', '--no-session-persistence']) assert.ok(started[0].args.includes(flag), flag);
  assert.equal(started[0].args.includes('--resume'), false);
  assert.deepEqual(JSON.parse(started[0].args[started[0].args.indexOf('--settings') + 1]), { disableAllHooks: true });
  assert.equal(await gone(started[0].pid), true, 'its input was closed, so it stopped');
});

test('a second ask for a folder inside the time a list is kept starts no CLI, and one after it asks again', async () => {
  const cli = stubCli();
  const cwd = folder();
  await listCommands(cwd, cli.cli);
  assert.deepEqual(await listCommands(cwd, cli.cli), TIDIED);
  assert.equal(cli.starts().length, 1);
  assert.deepEqual(await listCommands(cwd, cli.cli, { ttlMs: 0 }), TIDIED);
  assert.equal(cli.starts().length, 2, 'a list older than ttlMs is asked for again');
  await listCommands(folder(), cli.cli);
  assert.equal(cli.starts().length, 3, 'each folder has its own list');
});

test('callers that ask while the CLI is still starting share its one process', async () => {
  const cli = stubCli();
  cli.mode('slow');
  const cwd = folder();
  const first = listCommands(cwd, cli.cli);
  await wait(100);
  const second = listCommands(cwd, cli.cli);
  assert.deepEqual(await Promise.all([first, second]), [TIDIED, TIDIED]);
  assert.equal(cli.starts().length, 1);
});

test('a CLI that does not answer in time is stopped and rejected, and the failure is not kept', async () => {
  const cli = stubCli();
  cli.mode('silent');
  const cwd = folder();
  // NOTE: [22 Oct 2026] EK - At 1000 ms a loaded machine stopped the stub before it had started and logged, so the count below was 0.
  await assert.rejects(listCommands(cwd, cli.cli, { timeoutMs: 3000 }), { message: 'Claude did not list its commands in time.' });
  assert.equal(cli.starts().length, 1);
  assert.equal(await gone(cli.starts()[0].pid), true, 'the CLI was stopped');
  cli.mode('answer');
  assert.deepEqual(await listCommands(cwd, cli.cli), TIDIED);
  assert.equal(cli.starts().length, 2);
});

test('a CLI that answers with an error, or with no commands, is rejected with what it said', async () => {
  const cli = stubCli();
  cli.mode('refuse');
  await assert.rejects(listCommands(folder(), cli.cli), { message: 'The fake CLI refused.' });
  cli.mode('bare');
  await assert.rejects(listCommands(folder(), cli.cli), { message: 'Claude did not list its commands.' });
});

test('a CLI that stops without answering is rejected with the last line it wrote, and a failure is asked for again', async () => {
  const cli = stubCli();
  cli.mode('fail');
  const cwd = folder();
  await assert.rejects(listCommands(cwd, cli.cli), { message: 'The fake CLI could not start.' });
  await assert.rejects(listCommands(cwd, cli.cli), { message: 'The fake CLI could not start.' });
  assert.equal(cli.starts().length, 2);
  cli.mode('answer');
  assert.deepEqual(await listCommands(cwd, cli.cli), TIDIED);
  assert.equal(cli.starts().length, 3);
  assert.deepEqual(await listCommands(cwd, cli.cli), TIDIED);
  assert.equal(cli.starts().length, 3, 'a list that came is kept');
});

test('a CLI that is not there is rejected', async () => {
  await assert.rejects(listCommands(folder(), path.join(base, 'no-such-claude')), /ENOENT/);
});

test('a list a chat remembers is the list of its folder, and the folders remembered longest ago are forgotten first', async () => {
  const cli = stubCli();
  const cwd = folder();
  rememberCommands(cwd, TIDIED);
  assert.deepEqual(await listCommands(cwd, cli.cli), TIDIED);
  assert.deepEqual(cli.starts(), [], 'no CLI was needed');

  const oldest = folder();
  rememberCommands(oldest, TIDIED);
  for (let n = 0; n < 40; n++) rememberCommands(`/remembered/${n}`, TIDIED);
  await listCommands(oldest, cli.cli);
  assert.equal(cli.starts().length, 1, 'the oldest was forgotten');
  await listCommands('/remembered/39', cli.cli);
  assert.equal(cli.starts().length, 1, 'the newest was not');
});

test('a folder written with a trailing slash is the same folder, so it shares the probe that is running and the list that is kept', async () => {
  const cli = stubCli();
  cli.mode('slow');
  const cwd = folder();
  const first = listCommands(cwd, cli.cli);
  await wait(100);
  const second = listCommands(`${cwd}/`, cli.cli);
  assert.deepEqual(await Promise.all([first, second]), [TIDIED, TIDIED]);
  assert.equal(cli.starts().length, 1, 'the slash started no second CLI');
  assert.deepEqual(await listCommands(`${cwd}/`, cli.cli), TIDIED);
  assert.equal(cli.starts().length, 1, 'nor did a later ask');
});

test('a list a chat remembers for a folder is also the list of that folder written with a trailing slash, and the other way round', async () => {
  const cli = stubCli();
  const plain = folder();
  const slashed = folder();
  rememberCommands(plain, TIDIED);
  rememberCommands(`${slashed}/`, TIDIED);
  assert.deepEqual(await listCommands(`${plain}/`, cli.cli), TIDIED);
  assert.deepEqual(await listCommands(slashed, cli.cli), TIDIED);
  assert.deepEqual(cli.starts(), [], 'no CLI was needed');
});
