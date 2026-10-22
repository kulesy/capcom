// Run with `npm test`. The commands the prompt box's / list shows and the models its model menu offers: how the CLI's lists are tidied, and how a
// folder's lists are asked for, shared and kept. The CLI is a small script that logs each start, so a start that should not have happened shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCommands, listModels, remember, tidy, tidyModels } from '../lib/commands.mjs';

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
// And its models: the aliases come first, with a `value` that is not the model they resolve to, and then the full ids.
const MODELS = [
  { value: 'default', resolvedModel: 'claude-opus-5', displayName: 'Default (recommended)', supportsFastMode: true },
  { value: 'opus', resolvedModel: 'claude-opus-5', displayName: 'Opus', supportsFastMode: true },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
  { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
  { value: 'claude-opus-5', resolvedModel: 'claude-opus-5', displayName: 'Opus 5', supportsFastMode: true },
  { value: 'claude-fable-5', resolvedModel: 'claude-fable-5', displayName: 'Fable 5', supportsFastMode: false },
];
const MODELS_TIDIED = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', fast: false },
  { id: 'claude-opus-5', label: 'Opus 5', fast: true },
  { id: 'claude-fable-5', label: 'Fable 5', fast: false },
];

// A CLI that logs each start (its process, arguments and folder), then answers an initialize request the way its mode file says:
// 'answer' with LISTED and MODELS, 'slow' with the same after 400 ms, 'old' with LISTED and no models, 'bare' with no commands, 'refuse' with an
// error, 'silent' not at all, and 'fail' by writing a message and exiting at once. Before its reply it writes lines the probe has to ignore.
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
    "    answer: { subtype: 'success', request_id: m.request_id, response: { commands: COMMANDS, models: MODELS } },",
    "    slow: { subtype: 'success', request_id: m.request_id, response: { commands: COMMANDS, models: MODELS } },",
    "    old: { subtype: 'success', request_id: m.request_id, response: { commands: COMMANDS } },",
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
    `const MODELS = ${JSON.stringify(MODELS)};`,
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

test('tidyModels keeps the models listed by full id, each with its display name and whether it takes fast mode, in the CLI\'s order', () => {
  assert.deepEqual(tidyModels(MODELS), MODELS_TIDIED);
});

test('tidyModels lists a model the CLI names only by an alias after the models it lists by id, under the name its id gives and with the alias\'s fast mode flag', () => {
  const list = tidyModels([
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', supportsFastMode: true },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', supportsFastMode: false },
    { value: 'best', resolvedModel: 'claude-opus-5', displayName: 'Best' },
    { value: 'claude-opus-5', resolvedModel: 'claude-opus-5', displayName: 'Opus 5', supportsFastMode: true },
    { value: 'x' },
  ]);
  assert.deepEqual(list, [{ id: 'claude-opus-5', label: 'Opus 5', fast: true }, { id: 'claude-opus-5-5', label: 'Opus 5.5', fast: true }]);
});

test('tidyModels turns every run of white space in a display name into one space, and names a model by its id when it has none', () => {
  const [a, b, c] = tidyModels([
    { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8', displayName: '  Opus\n 4.8\t' },
    { value: 'claude-sonnet-5', resolvedModel: 'claude-sonnet-5' },
    { value: 'claude-fable-5', resolvedModel: 'claude-fable-5', displayName: '   ' },
  ]);
  assert.deepEqual([a.label, b.label, c.label], ['Opus 4.8', 'Sonnet 5', 'Fable 5']);
});

test('tidyModels says a model takes fast mode only when the CLI says so with true', () => {
  const of = supportsFastMode => tidyModels([{ value: 'a', resolvedModel: 'a', supportsFastMode }])[0].fast;
  assert.deepEqual([true, false, undefined, 'true', 1, null].map(of), [true, false, false, false, false, false]);
});

test('tidyModels drops a model whose id came before, and anything in the list that is not a model', () => {
  const list = tidyModels([
    { value: 'a', resolvedModel: 'a', displayName: 'first' }, null, 'b', 5, {}, { value: '', resolvedModel: '' }, { value: 7, resolvedModel: 7 },
    { value: 'a', resolvedModel: 'a', displayName: 'second' }, { value: 'c', resolvedModel: 'c' },
  ]);
  assert.deepEqual(list.map(m => [m.id, m.label]), [['a', 'first'], ['c', 'c']]);
});

test('tidyModels gives nothing when the CLI\'s answer is not a list', () => {
  for (const answer of [undefined, null, {}, 'models', 7]) assert.deepEqual(tidyModels(answer), []);
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
  await assert.rejects(listCommands(cwd, cli.cli, { timeoutMs: 3000 }), { message: 'Claude did not answer in time.' });
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
  await assert.rejects(listCommands(folder(), cli.cli), { message: 'Claude did not list its commands and models.' });
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
  remember(cwd, { commands: TIDIED, models: MODELS_TIDIED });
  assert.deepEqual(await listCommands(cwd, cli.cli), TIDIED);
  assert.deepEqual(cli.starts(), [], 'no CLI was needed');

  const oldest = folder();
  remember(oldest, { commands: TIDIED, models: MODELS_TIDIED });
  for (let n = 0; n < 40; n++) remember(`/remembered/${n}`, { commands: TIDIED, models: MODELS_TIDIED });
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
  remember(plain, { commands: TIDIED, models: MODELS_TIDIED });
  remember(`${slashed}/`, { commands: TIDIED, models: MODELS_TIDIED });
  assert.deepEqual(await listCommands(`${plain}/`, cli.cli), TIDIED);
  assert.deepEqual(await listCommands(slashed, cli.cli), TIDIED);
  assert.deepEqual(cli.starts(), [], 'no CLI was needed');
});

test('the models of a folder come from the same probe as its commands, so asking for both starts one CLI and each ask after it starts none', async () => {
  const cli = stubCli();
  const cwd = folder();
  assert.deepEqual(await listModels(cwd, cli.cli), MODELS_TIDIED);
  assert.deepEqual(await listCommands(cwd, cli.cli), TIDIED);
  assert.equal(cli.starts().length, 1);
  const other = folder();
  cli.mode('slow');
  const both = await Promise.all([listCommands(other, cli.cli), listModels(other, cli.cli)]);
  assert.deepEqual(both, [TIDIED, MODELS_TIDIED]);
  assert.equal(cli.starts().length, 2, 'asks made while the probe ran shared it');
});

test('a CLI that lists its commands and no models gives no models, and the commands still come', async () => {
  const cli = stubCli();
  cli.mode('old');
  const cwd = folder();
  assert.deepEqual(await listModels(cwd, cli.cli), []);
  assert.deepEqual(await listCommands(cwd, cli.cli), TIDIED);
  assert.equal(cli.starts().length, 1);
});

test('the models of a folder are rejected as its commands are, when the CLI refuses, lists nothing or does not answer in time', async () => {
  const cli = stubCli();
  cli.mode('refuse');
  await assert.rejects(listModels(folder(), cli.cli), { message: 'The fake CLI refused.' });
  cli.mode('bare');
  await assert.rejects(listModels(folder(), cli.cli), { message: 'Claude did not list its commands and models.' });
  cli.mode('silent');
  await assert.rejects(listModels(folder(), cli.cli, { timeoutMs: 3000 }), { message: 'Claude did not answer in time.' });
});

test('a list a chat remembers holds its models too, so a model ask for that folder needs no CLI', async () => {
  const cli = stubCli();
  const cwd = folder();
  remember(cwd, { commands: TIDIED, models: MODELS_TIDIED });
  assert.deepEqual(await listModels(cwd, cli.cli), MODELS_TIDIED);
  assert.deepEqual(await listModels(`${cwd}/`, cli.cli), MODELS_TIDIED);
  assert.deepEqual(cli.starts(), []);
});
