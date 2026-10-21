// Run with `npm test`. The live turn of a chat another app runs, read from its transcript. The transcripts here are made up: each
// entry holds the fields the reader looks at and nothing else. The last tests go over HTTP against the real server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOutside } from '../lib/outside.mjs';
import { as, cliCalls, listen, request, signIn, start, until } from './harness.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-outside-test-'));
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-10-21T10:00:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();
const reader = options => createOutside({ now: () => NOW, ...options });

let count = 0;
function chat() {
  const dir = fs.mkdtempSync(path.join(base, 'chat-'));
  const id = `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`;
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, '');
  return { id, file, dir };
}

const stamp = (before, entrypoint = 'claude-desktop') => ({ timestamp: ago(before), cwd: '/work/demo', isSidechain: false, entrypoint });
const prompt = (text, before, extra) => ({ type: 'user', message: { role: 'user', content: text }, ...stamp(before), ...extra });
const reply = (id, content, { reason = 'tool_use', tokens, before, ...extra }) => ({
  type: 'assistant',
  message: { id, role: 'assistant', content, stop_reason: reason, usage: tokens === undefined ? {} : { output_tokens: tokens } },
  ...stamp(before),
  ...extra,
});
const call = (id, name, input) => ({ type: 'tool_use', id, name, input });
const said = text => ({ type: 'text', text });
const answer = (id, before, { content = 'done', ...extra } = {}) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  ...stamp(before),
  ...extra,
});
const system = (subtype, before) => ({ type: 'system', subtype, ...stamp(before) });

const started = (entrypoint = 'claude-desktop') => [
  prompt('Check the build', 60 * SECOND, { entrypoint }),
  reply('m1', [call('t1', 'Bash', { command: 'npm run build' })], { tokens: 12, before: 50 * SECOND, entrypoint }),
];

const lines = entries => entries.map(e => `${typeof e === 'string' ? e : JSON.stringify(e)}\n`).join('');
const settle = (c, quiet = SECOND) => {
  const at = (NOW - quiet) / 1000;
  fs.utimesSync(c.file, at, at);
};
const put = (c, entries, { quiet } = {}) => {
  fs.writeFileSync(c.file, lines(entries));
  settle(c, quiet);
};
const add = (c, entries, quiet) => {
  fs.appendFileSync(c.file, lines(entries));
  settle(c, quiet);
};
const ids = turn => turn.tools.map(t => t.id);

test('a turn Desktop has open is live, with its calls waiting for a result, its tokens counted once for each message, when it began and how long ago, and nothing else', () => {
  const c = chat();
  put(c, [
    prompt('Run the checks', 120 * SECOND),
    reply('m0', [call('t1', 'Read', { file_path: '/work/demo/lib/a.mjs' })], { tokens: 40, before: 100 * SECOND }),
    answer('t1', 99 * SECOND),
    reply('m1', [said('Now the tests.')], { tokens: 10, before: 90 * SECOND }),
    reply('m1', [call('t2', 'Bash', { command: 'npm test\n  --reporter dot' })], { tokens: 25, before: 89 * SECOND }),
    reply('m1', [call('t3', 'Read', { file_path: '/work/demo/lib/b.mjs' })], { tokens: 25, before: 88 * SECOND }),
  ]);
  assert.deepEqual(reader().read(c), {
    tools: [{ id: 't2', name: 'Bash' }, { id: 't3', name: 'Read' }],
    tokens: 65,
    turnMs: 120 * SECOND,
    startedAt: NOW - 120 * SECOND,
  });
});

test('a call is sent as its id and tool name only, whatever it was asked to do, and a name that is not text reads as none', () => {
  const c = chat();
  put(c, [prompt('Go', 10 * SECOND), reply('m1', [call('t1', 'Bash', { command: `echo ${'a'.repeat(300)}` }), call('t2', 7, {}), call('t3', 'Bash')], { before: 5 * SECOND })]);
  assert.deepEqual(reader().read(c).tools, [{ id: 't1', name: 'Bash' }, { id: 't2', name: '' }, { id: 't3', name: 'Bash' }]);
});

test('each way a turn ends leaves no live turn', () => {
  const endings = {
    'a reply that ends the turn': reply('m2', [said('Built.')], { reason: 'end_turn', before: 10 * SECOND }),
    'a reply cut at the token limit': reply('m2', [said('Buil')], { reason: 'max_tokens', before: 10 * SECOND }),
    'a reply that hit a stop sequence': reply('m2', [said('Built.')], { reason: 'stop_sequence', before: 10 * SECOND }),
    'a refusal': reply('m2', [said('No.')], { reason: 'refusal', before: 10 * SECOND }),
    'an interrupt': prompt('[Request interrupted by user]', 10 * SECOND),
    'an interrupt while a tool ran, in a text block': { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }, ...stamp(10 * SECOND) },
    'the output of a local command': prompt('<local-command-stdout>Done</local-command-stdout>', 10 * SECOND),
    'the error output of a local command': prompt('  <local-command-stderr>Failed</local-command-stderr>', 10 * SECOND),
    'the length of the turn being saved': system('turn_duration', 10 * SECOND),
  };
  for (const [name, ending] of Object.entries(endings)) {
    const c = chat();
    put(c, [...started(), ending]);
    assert.equal(reader().read(c), null, name);
  }
});

test('entries that are not the end of a turn leave it open', () => {
  const quiet = {
    'a pause': reply('m2', [said('Waiting.')], { reason: 'pause_turn', before: 10 * SECOND }),
    'a reply with no stop reason yet': reply('m2', [said('Wor')], { reason: null, before: 10 * SECOND }),
    'a retry after an API error': system('api_error', 10 * SECOND),
    'a stop hook': system('stop_hook_summary', 10 * SECOND),
    'a notice': system('informational', 10 * SECOND),
    'a title': { type: 'custom-title', customTitle: 'Build check' },
    'the last prompt': { type: 'last-prompt', lastPrompt: 'Check the build' },
    'a snapshot': { type: 'file-history-snapshot', snapshot: {} },
    'a queue note': { type: 'queue-operation', operation: 'enqueue' },
  };
  for (const [name, entry] of Object.entries(quiet)) {
    const c = chat();
    put(c, [...started(), entry]);
    assert.deepEqual(ids(reader().read(c) ?? { tools: [] }), ['t1'], name);
  }
});

test('a turn Capcom ran itself is not shown, and a terminal turn is, whatever app wrote it', () => {
  const own = chat();
  put(own, started('sdk-cli'));
  assert.equal(reader().read(own), null);

  const mixed = chat();
  put(mixed, [...started('sdk-cli'), reply('m2', [call('t2', 'Read', { file_path: '/work/demo/a.mjs' })], { tokens: 3, before: 40 * SECOND, entrypoint: 'cli' })]);
  assert.equal(reader().read(mixed), null, 'the app that began the turn decides whose it is, not the last one to write to it');

  const terminal = chat();
  put(terminal, started('cli'));
  assert.deepEqual(ids(reader().read(terminal)), ['t1']);

  const unnamed = chat();
  put(unnamed, started().map(({ entrypoint, ...rest }) => rest));
  assert.deepEqual(ids(reader().read(unnamed)), ['t1']);
});

test('a turn that has gone quiet for ten minutes is not live, unless an agent the chat started wrote within them', () => {
  let clock = NOW;
  const outside = createOutside({ now: () => clock });
  const c = chat();
  put(c, started(), { quiet: 11 * MINUTE });
  assert.equal(outside.read(c), null);

  const folder = path.join(c.dir, c.id, 'subagents');
  fs.mkdirSync(folder, { recursive: true });
  const agent = path.join(folder, 'agent-1.jsonl');
  fs.writeFileSync(agent, '{}\n');
  fs.utimesSync(agent, (NOW - 30 * SECOND) / 1000, (NOW - 30 * SECOND) / 1000);
  clock = NOW + 5 * SECOND;
  assert.equal(outside.read(c), null, 'the folder was looked at five seconds ago and is not looked at again yet');
  clock = NOW + 20 * SECOND;
  assert.equal(outside.read(c).startedAt, NOW - 60 * SECOND);
  clock = NOW + 12 * MINUTE;
  assert.equal(outside.read(c), null, 'the agent has gone quiet too');
});

test('a turn is live up to the ten minutes, and the limit can be set', () => {
  const c = chat();
  put(c, started(), { quiet: 9 * MINUTE });
  assert.ok(reader().read(c));
  settle(c, 11 * MINUTE);
  assert.equal(reader().read(c), null);
  assert.ok(reader({ staleMs: 12 * MINUTE }).read(c));
});

test('a later read applies what was written since: a result clears its call, an ending ends the turn, a new prompt opens the next', () => {
  const outside = reader();
  const c = chat();
  put(c, started());
  assert.deepEqual(ids(outside.read(c)), ['t1']);

  add(c, [answer('t1', 40 * SECOND)]);
  const same = outside.read(c);
  assert.deepEqual(same.tools, []);
  assert.equal(same.startedAt, NOW - 60 * SECOND);
  assert.equal(same.tokens, 12);

  add(c, [reply('m2', [said('Built.')], { reason: 'end_turn', tokens: 5, before: 30 * SECOND })]);
  assert.equal(outside.read(c), null);

  add(c, [prompt('Now deploy', 20 * SECOND)]);
  const next = outside.read(c);
  assert.equal(next.startedAt, NOW - 20 * SECOND);
  assert.equal(next.tokens, 0);
  assert.deepEqual(next.tools, []);
});

test('a later read does not parse the bytes it has already read', () => {
  const outside = reader();
  const c = chat();
  put(c, started());
  assert.deepEqual(ids(outside.read(c)), ['t1']);

  fs.writeFileSync(c.file, fs.readFileSync(c.file, 'utf8').replace('"id":"t1"', '"id":"x1"'));
  add(c, [reply('m2', [call('t2', 'Read', { file_path: '/work/demo/a.mjs' })], { before: 40 * SECOND })]);
  assert.deepEqual(ids(outside.read(c)), ['t1', 't2'], 'the first call is still the one it saw');
  assert.deepEqual(ids(reader().read(c)), ['x1', 't2'], 'a reader that starts now sees the bytes as they are');
});

test('a file rewritten smaller is read again from its end', () => {
  const outside = reader();
  const c = chat();
  put(c, [
    prompt('A long first turn', 300 * SECOND),
    reply('m1', [call('t1', 'Bash', { command: 'one' })], { tokens: 100, before: 280 * SECOND }),
    answer('t1', 270 * SECOND),
    reply('m2', [call('t2', 'Bash', { command: 'two' })], { tokens: 100, before: 260 * SECOND }),
    answer('t2', 250 * SECOND),
    reply('m3', [call('t3', 'Bash', { command: 'three' })], { tokens: 100, before: 240 * SECOND }),
  ]);
  const long = outside.read(c);
  assert.deepEqual([ids(long), long.tokens, long.startedAt], [['t3'], 300, NOW - 300 * SECOND]);

  put(c, [prompt('Again', 20 * SECOND), reply('n1', [call('u1', 'Grep', { pattern: 'todo' })], { tokens: 7, before: 10 * SECOND })]);
  const short = outside.read(c);
  assert.deepEqual([ids(short), short.tokens, short.startedAt], [['u1'], 7, NOW - 20 * SECOND]);
});

test('entries from a side chain are ignored, and a side chain on its own is no turn', () => {
  const c = chat();
  put(c, [
    ...started(),
    reply('s1', [call('s2', 'Read', { file_path: '/work/demo/a.mjs' })], { before: 45 * SECOND, isSidechain: true }),
    reply('s3', [said('Side work done.')], { reason: 'end_turn', before: 40 * SECOND, isSidechain: true }),
    answer('t1', 30 * SECOND, { isSidechain: true }),
  ]);
  assert.deepEqual(ids(reader().read(c)), ['t1']);

  const alone = chat();
  put(alone, [prompt('Side', 60 * SECOND, { isSidechain: true })]);
  assert.equal(reader().read(alone), null);
});

test('a message queued while Claude works opens a turn, and another kind of attachment does not', () => {
  const queued = chat();
  put(queued, [{ type: 'attachment', attachment: { type: 'queued_command', prompt: 'Also tidy up', commandMode: 'prompt' }, ...stamp(20 * SECOND) }]);
  assert.equal(reader().read(queued).startedAt, NOW - 20 * SECOND);

  const other = chat();
  put(other, [{ type: 'attachment', attachment: { type: 'todo_reminder' }, ...stamp(20 * SECOND) }]);
  assert.equal(reader().read(other), null);
});

test('a compaction changes nothing: its boundary and its summary neither open a turn nor close one', () => {
  const summary = prompt('This session is being continued from an earlier one.', 29 * SECOND, { isCompactSummary: true });
  const open = chat();
  put(open, [...started(), system('compact_boundary', 30 * SECOND), summary]);
  const turn = reader().read(open);
  assert.deepEqual(ids(turn), ['t1']);
  assert.equal(turn.startedAt, NOW - 60 * SECOND);

  const closed = chat();
  put(closed, [...started(), reply('m2', [said('Built.')], { reason: 'end_turn', before: 40 * SECOND }), system('compact_boundary', 30 * SECOND), summary]);
  assert.equal(reader().read(closed), null);
});

test('lines that cannot be read are skipped, and a first entry with no readable time takes the start from the next', () => {
  const c = chat();
  put(c, [
    { ...prompt('Go', 60 * SECOND), timestamp: 'later' },
    'this is not json',
    '42',
    'null',
    '',
    reply('m1', [call('t1', 'Bash', { command: 'npm test' })], { tokens: 3, before: 50 * SECOND }),
  ]);
  const turn = reader().read(c);
  assert.deepEqual(ids(turn), ['t1']);
  assert.equal(turn.startedAt, NOW - 50 * SECOND);

  const never = chat();
  put(never, [{ ...prompt('Go', 60 * SECOND), timestamp: undefined }]);
  assert.equal(reader().read(never), null, 'a turn with no start would count from nothing');
});

test('a turn longer than the look back starts at the oldest entry the look back reaches', () => {
  const c = chat();
  const entries = [reply('m0', [said('Earlier turn done.')], { reason: 'end_turn', before: 700 * SECOND }), prompt('Start the long job', 600 * SECOND)];
  for (let n = 0; n < 12; n++) {
    entries.push(reply(`a${n}`, [call(`t${n}`, 'Bash', { command: `step ${n}` })], { tokens: 10, before: (590 - 40 * n) * SECOND }));
    if (n < 11) entries.push(answer(`t${n}`, (570 - 40 * n) * SECOND));
  }
  put(c, entries);
  const starts = [];
  let at = 0;
  for (const e of entries) {
    starts.push(at);
    at += Buffer.byteLength(JSON.stringify(e)) + 1;
  }
  const lookBackBytes = 1500;
  const first = entries[starts.findIndex(s => s >= at - lookBackBytes)];

  const short = reader({ lookBackBytes }).read(c);
  assert.equal(short.startedAt, Date.parse(first.timestamp));
  assert.ok(short.startedAt > NOW - 600 * SECOND, 'later than the prompt that began the turn');
  assert.deepEqual(ids(short), ['t11']);
  assert.equal(reader().read(c).startedAt, NOW - 600 * SECOND, 'the whole turn is found with the default look back');
});

test('the turn is found across the chunks the end of a big file is read in, with a line longer than a chunk', () => {
  const c = chat();
  const entries = [reply('m0', [said('Earlier turn done.')], { reason: 'end_turn', before: 900 * SECOND }), prompt('Start', 600 * SECOND)];
  for (let n = 0; n < 12; n++) {
    entries.push(reply(`a${n}`, [call(`t${n}`, 'Bash', { command: `step ${n}` })], { tokens: 10, before: (590 - 40 * n) * SECOND }));
    if (n < 11) entries.push(answer(`t${n}`, (580 - 40 * n) * SECOND, { content: 'x'.repeat(n === 5 ? 1.25 * 1024 * 1024 : 150 * 1024) }));
  }
  put(c, entries);
  assert.ok(fs.statSync(c.file).size > 2.5 * 1024 * 1024);
  const turn = reader().read(c);
  assert.equal(turn.startedAt, NOW - 600 * SECOND);
  assert.deepEqual(ids(turn), ['t11']);
  assert.equal(turn.tokens, 120);
});

test('a file that grew by more than the look back is read from its end instead of line by line', () => {
  const outside = reader({ lookBackBytes: 4000 });
  const c = chat();
  put(c, started());
  assert.deepEqual(ids(outside.read(c)), ['t1']);
  const more = [];
  for (let n = 0; n < 30; n++) more.push(reply(`b${n}`, [call(`u${n}`, 'Bash', { command: `step ${n}` })], { tokens: 1, before: (40 - n) * SECOND }), answer(`u${n}`, (39 - n) * SECOND));
  more.push(reply('b30', [call('u30', 'Bash', { command: 'last' })], { tokens: 1, before: 5 * SECOND }));
  add(c, more);
  assert.ok(fs.statSync(c.file).size > 4000 + lines(started()).length);
  const turn = outside.read(c);
  assert.deepEqual(ids(turn), ['u30']);
  assert.ok(turn.startedAt > NOW - 60 * SECOND, 'it starts inside the window, not at the first prompt');
});

test('a line still being written is left until it is whole', () => {
  const outside = reader();
  const c = chat();
  const ending = JSON.stringify(reply('m2', [said('Built.')], { reason: 'end_turn', before: 10 * SECOND }));
  put(c, started());
  fs.appendFileSync(c.file, ending.slice(0, 40));
  settle(c);
  assert.ok(outside.read(c), 'a first read leaves it');
  assert.ok(outside.read(c), 'and so does the next');
  fs.appendFileSync(c.file, `${ending.slice(40)}\n`);
  settle(c);
  assert.equal(outside.read(c), null);

  const d = chat();
  const result = JSON.stringify(answer('t1', 10 * SECOND));
  const done = JSON.stringify(reply('m2', [said('Built.')], { reason: 'end_turn', before: 5 * SECOND }));
  put(d, started());
  assert.deepEqual(ids(outside.read(d)), ['t1']);
  fs.appendFileSync(d.file, result.slice(0, 30));
  settle(d);
  assert.deepEqual(ids(outside.read(d)), ['t1'], 'a later read leaves it too');
  fs.appendFileSync(d.file, `${result.slice(30)}\n${done.slice(0, 25)}`);
  settle(d);
  assert.deepEqual(ids(outside.read(d)), [], 'the line that is whole is read and the one after it left');
  fs.appendFileSync(d.file, `${done.slice(25)}\n`);
  settle(d);
  assert.equal(outside.read(d), null);
});

test('a file that is missing or cannot be read gives no turn and does not throw', () => {
  const outside = reader();
  const c = chat();
  put(c, started());
  assert.ok(outside.read(c));
  const gone = { id: c.id, file: path.join(c.dir, 'gone', `${c.id}.jsonl`) };
  assert.equal(outside.read(gone), null);
  assert.equal(outside.read({ id: 'folder', file: c.dir }), null);
  assert.equal(outside.read({ id: 'none' }), null);
  assert.equal(outside.read(null), null);
});

test('a reader keeps the files it read last, and drops the one read longest ago', () => {
  const outside = reader({ keep: 2 });
  const [a, b, c] = [chat(), chat(), chat()];
  for (const x of [a, b]) {
    put(x, started());
    assert.deepEqual(ids(outside.read(x)), ['t1']);
  }
  outside.read(a);
  put(c, started());
  outside.read(c);
  for (const x of [a, b]) {
    fs.writeFileSync(x.file, fs.readFileSync(x.file, 'utf8').replace('"id":"t1"', '"id":"x1"'));
    add(x, [reply('m2', [call('t2', 'Read', { file_path: '/work/demo/a.mjs' })], { before: 40 * SECOND })]);
  }
  assert.deepEqual(ids(outside.read(a)), ['t1', 't2'], 'kept, so only the new line is read');
  assert.deepEqual(ids(outside.read(b)), ['x1', 't2'], 'dropped, so it is read again from its end');
});

// What the CLI writes when the owner runs a command with ! in a terminal: a caveat for Claude, the command, and its output.
const CAVEAT = '<local-command-caveat>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.</local-command-caveat>';
const shell = (before, entrypoint = 'cli') => [
  prompt(CAVEAT, before, { entrypoint, isMeta: true }),
  prompt('<bash-input>git pull</bash-input>', before - SECOND, { entrypoint }),
  prompt('<bash-stdout>Already up to date.</bash-stdout><bash-stderr></bash-stderr>', before - 2 * SECOND, { entrypoint }),
];

test('a command run with ! in a terminal neither opens a turn nor ends one, and nor does the caveat written before it', () => {
  const alone = chat();
  put(alone, shell(30 * SECOND));
  assert.equal(reader().read(alone), null, 'Claude never replies to it, so nothing is working');

  for (const text of ['<bash-input>ls</bash-input>', '  <bash-stdout>a.txt</bash-stdout>', '<bash-stderr>No such file</bash-stderr>', 'Caveat: the messages below were generated by the user while running local commands.']) {
    const one = chat();
    put(one, [prompt(text, 30 * SECOND, { entrypoint: 'cli' })]);
    assert.equal(reader().read(one), null, text);
  }

  const open = chat();
  put(open, [...started('cli'), ...shell(30 * SECOND)]);
  const turn = reader().read(open);
  assert.deepEqual(ids(turn), ['t1'], 'a turn that was open stays open');
  assert.equal(turn.startedAt, NOW - 60 * SECOND, 'and keeps its start');

  const ending = reply('m2', [said('Built.')], { reason: 'end_turn', before: 40 * SECOND, entrypoint: 'cli' });
  const closed = chat();
  put(closed, [...started('cli'), ending, ...shell(30 * SECOND)]);
  assert.equal(reader().read(closed), null, 'and a turn that had ended stays ended');

  const outside = reader();
  const later = chat();
  put(later, [...started('cli'), ending]);
  assert.equal(outside.read(later), null);
  add(later, shell(30 * SECOND));
  assert.equal(outside.read(later), null, 'the same when the lines are read as they are written');
  add(later, [prompt('Now deploy', 10 * SECOND, { entrypoint: 'cli' })]);
  assert.equal(outside.read(later).startedAt, NOW - 10 * SECOND, 'and a prompt after them opens a turn at its own time');
});

test('a prompt from another app begins a new turn, so a turn the first app never ended leaves no call, token or start behind', () => {
  const c = chat();
  put(c, [
    prompt('Run the build', 5 * HOUR, { entrypoint: 'sdk-cli' }),
    reply('m1', [call('d1', 'Bash', { command: 'sleep 99999' })], { tokens: 900, before: 5 * HOUR - 10 * SECOND, entrypoint: 'sdk-cli' }),
    prompt('Are you there?', 20 * SECOND),
    reply('m2', [call('t2', 'Read', { file_path: '/work/demo/a.mjs' })], { tokens: 30, before: 10 * SECOND }),
  ]);
  assert.deepEqual(reader().read(c), { tools: [{ id: 't2', name: 'Read' }], tokens: 30, turnMs: 20 * SECOND, startedAt: NOW - 20 * SECOND }, 'shown, though the turn before it was Capcom\'s');

  const own = chat();
  put(own, [
    prompt('Run the build', 5 * HOUR),
    reply('m1', [call('d1', 'Bash', { command: 'sleep 99999' })], { tokens: 900, before: 5 * HOUR - 10 * SECOND }),
    prompt('From Capcom', 20 * SECOND, { entrypoint: 'sdk-cli' }),
    reply('m2', [call('t2', 'Read', { file_path: '/work/demo/a.mjs' })], { tokens: 30, before: 10 * SECOND, entrypoint: 'sdk-cli' }),
  ]);
  assert.equal(reader().read(own), null, 'and hidden when Capcom began the turn, though Desktop left one open before it');

  const terminal = chat();
  put(terminal, [...started(), prompt('Back in the terminal', 20 * SECOND, { entrypoint: 'cli' })]);
  const next = reader().read(terminal);
  assert.deepEqual([ids(next), next.tokens, next.startedAt], [[], 0, NOW - 20 * SECOND], 'any app, not only Capcom\'s, begins a new turn');
});

test('a prompt from the same app begins a new turn when it comes more than ten minutes after the open turn\'s last entry, and joins the turn within them', () => {
  const second = gap => 30 * MINUTE - gap;
  const next = (kind, before) => (kind === 'queued'
    ? { type: 'attachment', attachment: { type: 'queued_command', prompt: 'Also tidy up', commandMode: 'prompt' }, ...stamp(before) }
    : prompt('Also tidy up', before));
  for (const kind of ['typed', 'queued']) {
    const run = gap => {
      const c = chat();
      put(c, [
        prompt('First', 31 * MINUTE),
        reply('m1', [call('d1', 'Bash', { command: 'sleep 99999' })], { tokens: 100, before: 30 * MINUTE }),
        next(kind, second(gap)),
        reply('m2', [call('t2', 'Read', { file_path: '/work/demo/a.mjs' })], { tokens: 7, before: second(gap) - 5 * SECOND }),
      ]);
      return reader().read(c);
    };
    const within = run(10 * MINUTE);
    assert.deepEqual([ids(within), within.tokens, within.startedAt], [['d1', 't2'], 107, NOW - 31 * MINUTE], `${kind}, exactly ten minutes later: one turn`);
    const over = run(10 * MINUTE + SECOND);
    assert.deepEqual([ids(over), over.tokens, over.startedAt], [['t2'], 7, NOW - second(10 * MINUTE + SECOND)], `${kind}, a second more: a new turn`);
    assert.deepEqual(ids(run(2 * MINUTE)), ['d1', 't2'], `${kind}, a message sent while Claude works joins the turn`);
  }
});

test('the gap is measured from the newest entry that has a readable time, a reply or a result continues the turn however late it comes, and a prompt with no time can still be told apart by its app', () => {
  const lost = e => ({ ...e, timestamp: 'later' });
  const c = chat();
  put(c, [
    prompt('First', 40 * MINUTE),
    reply('m1', [call('d1', 'Bash', { command: 'make' })], { tokens: 100, before: 39 * MINUTE }),
    lost(reply('m2', [call('d2', 'Bash', { command: 'make' })], { tokens: 100, before: 0 })),
    prompt('Second', 20 * MINUTE),
    reply('m3', [call('t3', 'Read', { file_path: '/work/demo/a.mjs' })], { tokens: 7, before: 19 * MINUTE }),
  ]);
  assert.deepEqual(ids(reader().read(c)), ['t3'], 'an entry with no time does not take the last time away');

  const long = chat();
  put(long, [
    prompt('Run the long job', 50 * MINUTE),
    reply('m1', [call('t1', 'Bash', { command: 'make all' })], { tokens: 10, before: 49 * MINUTE }),
    answer('t1', 20 * MINUTE),
    reply('m2', [call('t2', 'Bash', { command: 'make test' })], { tokens: 5, before: 19 * MINUTE, entrypoint: 'cli' }),
    answer('t2', 2 * MINUTE),
    reply('m3', [call('t3', 'Read', { file_path: '/work/demo/a.mjs' })], { tokens: 1, before: MINUTE }),
  ]);
  const turn = reader().read(long);
  assert.deepEqual([ids(turn), turn.tokens, turn.startedAt], [['t3'], 16, NOW - 50 * MINUTE]);

  const blind = chat();
  put(blind, [...started(), lost(prompt('Back in the terminal', 0, { entrypoint: 'cli' })), reply('m9', [call('t9', 'Read', { file_path: '/work/demo/a.mjs' })], { tokens: 3, before: 20 * SECOND, entrypoint: 'cli' })]);
  assert.deepEqual(ids(reader().read(blind)), ['t9'], 'another app\'s prompt needs no time to begin a new turn');
});

test('a look back that begins on the first byte of a line reads that line, and one byte short of it leaves the line out', () => {
  const c = chat();
  const entries = [reply('m0', [said('Earlier turn done.')], { reason: 'end_turn', before: 90 * SECOND })];
  for (let n = 0; n < 4; n++) entries.push(reply(`a${n}`, [call(`t${n}`, 'Bash', { command: `step ${n}` })], { tokens: 1, before: (60 - 10 * n) * SECOND }));
  put(c, entries);
  const sizes = entries.map(e => Buffer.byteLength(JSON.stringify(e)) + 1);
  for (let kept = 1; kept <= 4; kept++) {
    const window = sizes.slice(-kept).reduce((sum, n) => sum + n, 0);
    const wanted = n => ['t0', 't1', 't2', 't3'].slice(4 - n);
    assert.deepEqual(ids(reader({ lookBackBytes: window }).read(c)), wanted(kept), `a window of exactly the last ${kept} line(s)`);
    assert.deepEqual(ids(reader({ lookBackBytes: window - 1 }).read(c) ?? { tools: [] }), wanted(kept - 1), `a byte short of them`);
  }
});

// ---- over HTTP, against the real server ----------------------------------------------------------------------

const live = (before, extra) => ({ cwd: '/work/demo', isSidechain: false, entrypoint: 'claude-desktop', timestamp: new Date(Date.now() - before).toISOString(), ...extra });
const transcript = (s, id) => path.join(s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);

test('a chat another app runs reports its live turn when a viewer connects, and again as its transcript grows and ends', async () => {
  const s = await start({ sessions: [{ id: 'desk', title: 'Desktop one', ago: 1 }] });
  const { token } = await signIn(s);
  const file = transcript(s, 'desk');
  fs.writeFileSync(file, lines([
    live(90 * SECOND, { type: 'user', message: { role: 'user', content: 'Run the checks' } }),
    live(80 * SECOND, { type: 'assistant', message: { id: 'm1', role: 'assistant', stop_reason: 'tool_use', usage: { output_tokens: 30 }, content: [call('t1', 'Bash', { command: 'npm test' })] } }),
  ]));
  await request(s, 'GET', '/api/sessions', { headers: as(token) });

  const viewer = listen(s, token, 'desk');
  await until(() => viewer.events.length);
  const [status] = viewer.events;
  assert.equal(status.type, 'status');
  assert.equal(status.data.state, 'idle');
  const { outside } = status.data;
  assert.deepEqual(outside.tools, [{ id: 't1', name: 'Bash' }]);
  assert.equal(outside.tokens, 30);
  assert.deepEqual(Object.keys(outside).sort(), ['startedAt', 'tokens', 'tools', 'turnMs'], 'only what the page reads is sent');
  assert.ok(outside.turnMs >= 90 * SECOND && outside.turnMs < 5 * MINUTE);
  assert.ok(Math.abs(outside.startedAt - (Date.now() - 90 * SECOND)) < 5 * SECOND);

  const outsides = () => viewer.events.filter(e => e.type === 'outside');
  const result = id => live(0, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  // One call replaced by another leaves the same number of calls and the same tokens, and it is still a change.
  fs.appendFileSync(file, lines([result('t1'), live(0, { type: 'assistant', message: { id: 'm2', role: 'assistant', stop_reason: 'tool_use', content: [call('t2', 'Read', { file_path: '/work/demo/a.mjs' })] } })]));
  await until(() => outsides().length === 1, 6000);
  assert.deepEqual(outsides()[0].data.tools, [{ id: 't2', name: 'Read' }]);
  assert.equal(outsides()[0].data.startedAt, outside.startedAt);

  fs.appendFileSync(file, lines([result('t2')]));
  await until(() => outsides().length === 2, 6000);
  assert.deepEqual(outsides()[1].data.tools, []);

  fs.appendFileSync(file, lines([live(0, { type: 'assistant', message: { id: 'm3', role: 'assistant', stop_reason: 'end_turn', usage: { output_tokens: 9 }, content: [said('Passed.')] } })]));
  await until(() => outsides().length === 3, 6000);
  assert.equal(outsides()[2].data, null);
  viewer.close();
});

test('a chat Capcom is working on reports no turn of another app, though its transcript holds one, and a chat with a finished turn reports none', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'busy', title: 'Busy one', ago: 1 }, { id: 'idle', title: 'Idle one', ago: 1 }, { id: 'done', title: 'Done one', ago: 1 }] });
  const { token } = await signIn(s);
  const open = [live(60 * SECOND, { type: 'user', message: { role: 'user', content: 'Go' } }), live(50 * SECOND, { type: 'assistant', message: { id: 'm1', role: 'assistant', stop_reason: 'tool_use', content: [call('t1', 'Bash', { command: 'npm test' })] } })];
  fs.writeFileSync(transcript(s, 'busy'), lines(open));
  fs.writeFileSync(transcript(s, 'idle'), lines(open));
  fs.writeFileSync(transcript(s, 'done'), lines([...open, live(40 * SECOND, { type: 'assistant', message: { id: 'm2', role: 'assistant', stop_reason: 'end_turn', content: [said('Passed.')] } })]));
  await request(s, 'POST', '/api/sessions/busy/send', { headers: as(token), json: { text: 'keep going' } });
  await until(() => cliCalls(s).some(c => c.user === 'keep going'));

  const firstStatus = async id => {
    const viewer = listen(s, token, id);
    await until(() => viewer.events.length);
    viewer.close();
    return viewer.events[0].data;
  };
  const busy = await firstStatus('busy');
  assert.equal(busy.state, 'working');
  assert.equal(busy.outside, null, 'its own work shows from the CLI, not from the file');
  assert.deepEqual((await firstStatus('idle')).outside.tools, [{ id: 't1', name: 'Bash' }]);
  assert.equal((await firstStatus('done')).outside, null);
});

test('a turn another app has open is sent again to a viewer when Capcom\'s work in the chat ends before the next look at the transcript', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'desk', title: 'Desktop one', ago: 1 }] });
  const { token } = await signIn(s);
  fs.writeFileSync(transcript(s, 'desk'), lines([
    live(60 * SECOND, { type: 'user', message: { role: 'user', content: 'Go' } }),
    live(50 * SECOND, { type: 'assistant', message: { id: 'm1', role: 'assistant', stop_reason: 'tool_use', content: [call('t1', 'Bash', { command: 'npm test' })] } }),
  ]));
  await request(s, 'GET', '/api/sessions', { headers: as(token) });

  const viewer = listen(s, token, 'desk');
  await until(() => viewer.events.length);
  assert.deepEqual(viewer.events[0].data.outside.tools, [{ id: 't1', name: 'Bash' }]);

  // Sent as soon as the viewer is there, so the work starts and ends long before the first look at the transcript, 1.5 s after the viewer
  // connected. The page drops the turn when the work starts, and the transcript is the same when it ends.
  await request(s, 'POST', '/api/sessions/desk/send', { headers: as(token), json: { text: 'finish the turn' } });
  await until(() => viewer.events.some(e => e.type === 'state' && e.data.state === 'idle'));
  await until(() => viewer.events.some(e => e.type === 'outside'), 6000);
  const types = viewer.events.map(e => (e.type === 'state' ? `state ${e.data.state}` : e.type));
  assert.ok(types.indexOf('state working') >= 0 && types.indexOf('state working') < types.indexOf('outside'), `the turn comes after the work started: ${types}`);
  const back = viewer.events.find(e => e.type === 'outside').data;
  assert.deepEqual(back.tools, [{ id: 't1', name: 'Bash' }]);
  assert.ok(Math.abs(back.startedAt - (Date.now() - 60 * SECOND)) < 10 * SECOND);
  viewer.close();
});

test('a turn is sent again when only its tokens changed, and when only its start did', async () => {
  const s = await start({ sessions: [{ id: 'tok', title: 'Tokens', ago: 1 }, { id: 'beg', title: 'Start', ago: 1 }] });
  const { token } = await signIn(s);
  const first = [live(30 * SECOND, { type: 'user', message: { role: 'user', content: 'Go' } })];
  for (const id of ['tok', 'beg']) fs.writeFileSync(transcript(s, id), lines(first));
  await request(s, 'GET', '/api/sessions', { headers: as(token) });

  const [tok, beg] = ['tok', 'beg'].map(id => listen(s, token, id));
  await until(() => tok.events.length && beg.events.length);
  const before = { tokens: tok.events[0].data.outside.tokens, started: tok.events[0].data.outside.startedAt };
  assert.equal(before.tokens, 0);
  assert.equal(beg.events[0].data.outside.startedAt, before.started);

  fs.appendFileSync(transcript(s, 'tok'), lines([live(0, { type: 'assistant', message: { id: 'm1', role: 'assistant', stop_reason: null, usage: { output_tokens: 12 }, content: [said('Working.')] } })]));
  fs.appendFileSync(transcript(s, 'beg'), lines([
    live(1000, { type: 'assistant', message: { id: 'm1', role: 'assistant', stop_reason: 'end_turn', content: [said('Done.')] } }),
    live(0, { type: 'user', message: { role: 'user', content: 'Next' } }),
  ]));
  await until(() => tok.events.some(e => e.type === 'outside') && beg.events.some(e => e.type === 'outside'), 6000);
  const more = tok.events.find(e => e.type === 'outside').data;
  assert.deepEqual([more.tokens, more.startedAt], [12, before.started]);
  const next = beg.events.find(e => e.type === 'outside').data;
  assert.equal(next.tokens, 0);
  assert.ok(next.startedAt > before.started + 20 * SECOND, 'a new turn has a new start');
  tok.close();
  beg.close();
});
