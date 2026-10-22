// Run with `npm test`. The CLI is a small script that never answers, so the start timeout can be shortened to a moment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCommands } from '../lib/commands.mjs';
import { activeStates, startChat } from '../lib/runner.mjs';

const wait = ms => new Promise(done => setTimeout(done, ms));

test('a start that times out is stopped and forgotten, so a slow CLI never becomes a session nothing knows about', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const exited = path.join(dir, 'exited');
  const cli = path.join(dir, 'slow-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "process.stdin.on('data', () => {});",
    `process.stdin.on('end', () => { fs.writeFileSync(${JSON.stringify(exited)}, 'closed'); process.exit(0); });`,
    '',
  ].join('\n'), { mode: 0o755 });
  await assert.rejects(
    startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: cli, chrome: false, chips: null, timeoutMs: 300 }),
    /Claude did not start within 0\.3 seconds/,
  );
  assert.deepEqual(Object.keys(activeStates()), [], 'the chat is gone from the registry');
  for (let i = 0; i < 40 && !fs.existsSync(exited); i++) await wait(50);
  assert.equal(fs.existsSync(exited), true, 'its input was closed, so the CLI was told to stop');
});

const until = async (check, ms = 4000) => {
  for (let waited = 0; !check(); waited += 20) {
    if (waited > ms) throw new Error('timed out waiting');
    await wait(20);
  }
};

test('Claude is asked for thinking summaries, and what it streams reaches the page as think and work events that are gone when the turn ends', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const log = path.join(dir, 'stdin.log');
  const cli = path.join(dir, 'streaming-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "const ev = event => out({ type: 'stream_event', event });",
    'let turn = 0;',
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    `  fs.appendFileSync(${JSON.stringify(log)}, line + '\\n');`,
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    '  turn++;',
    "  if (turn === 1) return out({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'stub' });",
    '  if (turn === 2) {',
    "    out({ type: 'system', subtype: 'status', status: 'requesting' });",
    "    ev({ type: 'message_start', message: { id: 'msg_1' } });",
    "    ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });",
    "    return ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Checking the folder.' } });",
    '  }',
    "  ev({ type: 'content_block_stop', index: 0 });",
    "  ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } });",
    "  ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{\"command\":\"ls\"}' } });",
    "  ev({ type: 'content_block_stop', index: 1 });",
    "  ev({ type: 'message_delta', usage: { output_tokens: 90 } });",
    "  out({ type: 'result', subtype: 'success', is_error: false });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: cli, chrome: false, chips: null });
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('think about it', []);
  await until(() => chat.status().think);
  assert.equal(chat.status().think.text, 'Checking the folder.', 'a page opened now is told what has been thought so far');
  assert.equal(chat.status().work.thinking, true);

  chat.send('go on', []);
  await until(() => chat.state === 'idle');
  const asked = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(m => m.request).filter(Boolean);
  assert.deepEqual(asked.find(r => r.subtype === 'set_max_thinking_tokens'), { subtype: 'set_max_thinking_tokens', thinking_display: 'summarized' });
  assert.deepEqual(heard.filter(e => e.type === 'think').map(e => e.data), [{ id: 'msg_1', text: 'Checking the folder.' }, { id: 'msg_1', done: true }]);
  const lastWork = heard.filter(e => e.type === 'work').at(-1).data;
  assert.deepEqual([lastWork.tools, lastWork.tokens], [[{ id: 'toolu_1', name: 'Bash', summary: 'ls' }], 90]);
  assert.equal(chat.status().work, null, 'nothing is left of the turn once it has ended');
  assert.equal(chat.status().think, null);
  chat.stop();
});

const holdingCli = dir => {
  const cli = path.join(dir, 'holding-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    "  const [state, id, rest] = m.message.content.split(' ');",
    "  if (state === 'start') return out({ type: 'system', subtype: 'init', session_id: id, model: 'stub' });",
    "  out({ type: 'system', subtype: 'peer_message_hold', state, message_uuid: id, lane: 'socket', from: 'uds:/tmp/cc-socks/1.sock', from_name: 'Worker', ...JSON.parse(rest || '{}') });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  return cli;
};

test('a message the CLI holds for another session shows as held with its cause and is gone once released, and it is never an approval', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const chat = await startChat({ cwd: dir, mode: 'acceptEdits', text: 'start sess-hold-1', images: [], claude: holdingCli(dir), chrome: false, chips: null });
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('held m1 {"cause":"mode-mismatch"}', []);
  await until(() => chat.status().holds.length === 1);
  assert.deepEqual(chat.status().holds.map(({ id, from, cause }) => ({ id, from, cause })), [{ id: 'm1', from: 'Worker', cause: 'mode-mismatch' }]);
  assert.deepEqual(chat.status().pending, [], 'there is nothing to allow or deny');
  assert.equal(chat.state, 'working', 'a hold does not make the chat wait for the owner');

  chat.send('held m1 {"cause":"no-mode-asserted"}', []);
  chat.send('released m1', []);
  await until(() => chat.status().holds.length === 0);
  assert.deepEqual(heard.filter(e => e.type.startsWith('hold')).map(e => [e.type, e.data.id, e.data.cause ?? e.data.state]), [
    ['hold', 'm1', 'mode-mismatch'],
    ['hold', 'm1', 'no-mode-asserted'],
    ['hold-ended', 'm1', 'released'],
  ]);
  chat.stop();
});

test('a hold that is dropped says how it ended, one the page never saw still ends, and a sender cannot pass off its name or id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const chat = await startChat({ cwd: dir, mode: 'acceptEdits', text: 'start sess-hold-2', images: [], claude: holdingCli(dir), chrome: false, chips: null });
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('dropped m2 {"outcome":"expired"}', []);
  chat.send('reopened m3', []);
  chat.send(`held ${'i'.repeat(300)} {"from_name":"A\\u202eB\\nC"}`, []);
  await until(() => chat.status().holds.length === 1);
  assert.deepEqual(heard.filter(e => e.type === 'hold-ended').map(e => e.data), [{ id: 'm2', from: 'Worker', state: 'dropped', outcome: 'expired' }]);
  assert.equal(heard.some(e => e.data?.id === 'm3'), false, 'a state the page cannot draw is ignored');
  const [held] = chat.status().holds;
  assert.deepEqual([held.id.length, held.from], [100, 'A B C']);

  chat.stop();
  await until(() => !chat.status().running);
  assert.deepEqual(chat.status().holds, [], 'a hold does not outlive the process that was holding it');
});

test('a hold frame with no message_uuid is ignored, since its own uuid differs from the one that ends it and the hold would never clear', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const chat = await startChat({ cwd: dir, mode: 'acceptEdits', text: 'start sess-hold-3', images: [], claude: holdingCli(dir), chrome: false, chips: null });
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('held x {"message_uuid":null,"uuid":"frame-1"}', []);
  chat.send('released x {"message_uuid":null,"uuid":"frame-2"}', []);
  chat.send('held m4', []);
  await until(() => chat.status().holds.some(h => h.id === 'm4'));
  assert.deepEqual(chat.status().holds.map(h => h.id), ['m4']);
  assert.deepEqual(heard.filter(e => e.type.startsWith('hold')).map(e => [e.type, e.data.id]), [['hold', 'm4']]);
  chat.stop();
});

test('a hold of a process that was told to stop is gone once a message starts a new one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const chat = await startChat({ cwd: dir, mode: 'acceptEdits', text: 'start sess-hold-4', images: [], claude: holdingCli(dir), chrome: false, chips: null });

  chat.send('held m5', []);
  await until(() => chat.status().holds.length === 1);
  chat.stop();
  chat.send('held m6', []);
  await until(() => chat.status().holds.some(h => h.id === 'm6'));
  assert.deepEqual(chat.status().holds.map(h => h.id), ['m6'], 'the old process\'s hold was not carried over');
  chat.stop();
});

test('a null line, content that is not a list and blocks that are not objects cost only themselves: the tool is tracked, the live text is cleared, and the turn ends normally', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const cli = path.join(dir, 'odd-blocks-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "const odd = [null, 'text', 7, true, [{ type: 'text', text: 'inside' }]];",
    "const notLists = ['text', { type: 'text', text: 'in an object' }, 7];",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    '  const step = m.message.content;',
    "  if (step === 'start') return out({ type: 'system', subtype: 'init', session_id: 'sess-odd-blocks', model: 'stub' });",
    "  if (step === 'write') {",
    "    out({ type: 'system', subtype: 'status', status: 'requesting' });",
    "    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Look' } } });",
    "    process.stdout.write('null\\n');",
    "    for (const content of notLists) out({ type: 'assistant', message: { id: 'msg_0', role: 'assistant', content } });",
    "    return out({ type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [...odd, { type: 'text', text: 'Looking.' }, ...odd, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }, ...odd] } });",
    '  }',
    "  if (step === 'answer') return out({ type: 'user', message: { role: 'user', content: [...odd, { type: 'tool_result', tool_use_id: 'toolu_1', content: [...odd, { type: 'text', text: 'ok' }] }, ...odd] } });",
    "  out({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01 });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start', images: [], claude: cli, chrome: false, chips: null });
  // A failed assertion must not leave the CLI running, or the test run never ends.
  t.after(() => chat.stop());
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('write', []);
  await until(() => chat.status().work?.tools.length === 1);
  assert.deepEqual(chat.status().work.tools, [{ id: 'toolu_1', name: 'Bash', summary: 'ls' }]);
  assert.equal(heard.some(e => e.type === 'delta'), true, 'the text was being written');
  assert.equal(chat.status().live, '', 'and the finished message, odd blocks and all, cleared it');

  chat.send('answer', []);
  await until(() => chat.status().work?.tools.length === 0);

  chat.send('finish', []);
  await until(() => chat.state === 'idle');
  assert.deepEqual(heard.filter(e => e.type === 'turn-end').map(e => e.data), [{ error: false, message: '', cost: 0.01 }]);
  assert.deepEqual([chat.status().running, chat.status().lastError], [true, '']);
});

test('a line the CLI prints that is not an object costs only itself: the chat carries on, and the turn ends normally', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const cli = path.join(dir, 'odd-lines-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    "  if (m.message.content === 'start') return out({ type: 'system', subtype: 'init', session_id: 'sess-odd-lines', model: 'stub' });",
    "  for (const odd of ['null', '7', '\"text\"', 'true', '[]']) process.stdout.write(odd + '\\n');",
    "  out({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01 });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'start', images: [], claude: cli, chrome: false, chips: null });
  // A failed assertion must not leave the CLI running, or the test run never ends.
  t.after(() => chat.stop());
  const heard = [];
  chat.listeners.add(ev => heard.push(ev));

  chat.send('go', []);
  await until(() => chat.state === 'idle');
  assert.deepEqual(heard.filter(e => e.type === 'turn-end').map(e => e.data), [{ error: false, message: '', cost: 0.01 }]);
  assert.deepEqual([chat.status().running, chat.status().lastError], [true, '']);
});

test('Always allow is offered and kept for a tool with suggestions but never for Chrome, and Bypass allows Chrome with no card', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const cli = path.join(dir, 'asking-claude.mjs');
  const rule = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls' }], behavior: 'allow', destination: 'localSettings' }];
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "const mode = process.argv[process.argv.indexOf('--permission-mode') + 1];",
    `const ask = (id, tool_name) => out({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name, input: {}, permission_suggestions: ${JSON.stringify(rule)} } });`,
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    `  fs.appendFileSync(path.join(${JSON.stringify(dir)}, mode + '.log'), line + '\\n');`,
    '  const m = JSON.parse(line);',
    "  if (m.type !== 'user') return;",
    "  if (m.message.content === 'start') return out({ type: 'system', subtype: 'init', session_id: `sess-always-${mode}`, model: 'stub' });",
    "  ask('ask-chrome', 'mcp__claude-in-chrome__navigate');",
    "  ask('ask-bash', 'Bash');",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const answers = mode => fs.readFileSync(path.join(dir, `${mode}.log`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(m => m.type === 'control_response').map(m => [m.response.request_id, m.response.response.behavior, m.response.response.updatedPermissions]);

  const chat = await startChat({ cwd: dir, mode: 'default', text: 'start', images: [], claude: cli, chrome: true, chips: null });
  // A failed assertion must not leave the CLI running, or the test run never ends.
  t.after(() => chat.stop());
  chat.send('ask', []);
  await until(() => chat.status().pending.length === 2);
  assert.deepEqual(chat.status().pending.map(p => [p.tool, p.always]), [['mcp__claude-in-chrome__navigate', false], ['Bash', true]]);
  chat.answer('ask-chrome', 'always');
  chat.answer('ask-bash', 'always');
  await until(() => answers('default').length === 2);
  assert.deepEqual(answers('default'), [['ask-chrome', 'allow', undefined], ['ask-bash', 'allow', rule]], 'Always allow on Chrome allows this one call and keeps no rule');

  const bypass = await startChat({ cwd: dir, mode: 'bypassPermissions', text: 'start', images: [], claude: cli, chrome: true, chips: null });
  t.after(() => bypass.stop());
  bypass.send('ask', []);
  await until(() => bypass.status().pending.length === 1 && answers('bypassPermissions').length === 1);
  assert.deepEqual(bypass.status().pending.map(p => p.tool), ['Bash']);
  assert.deepEqual(answers('bypassPermissions'), [['ask-chrome', 'allow', undefined]]);
});

// A CLI that answers an initialize request with `reply`, and starts its session when it is sent the first message.
const listingCli = (dir, reply) => {
  const cli = path.join(dir, 'listing-claude.mjs');
  fs.writeFileSync(cli, [
    '#!/usr/bin/env node',
    "import readline from 'node:readline';",
    "const out = o => process.stdout.write(JSON.stringify(o) + '\\n');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    '  const m = JSON.parse(line);',
    `  if (m.type === 'control_request' && m.request.subtype === 'initialize') return out({ type: 'control_response', response: { request_id: m.request_id, ...${JSON.stringify(reply)} } });`,
    "  if (m.type === 'user') out({ type: 'system', subtype: 'init', session_id: 'sess-listing', model: 'stub' });",
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  return cli;
};

test('the commands Claude lists in its reply to initialize are tidied onto the chat, and its folder keeps them for the next session started there', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
  const commands = [
    { name: 'review-pr', description: 'Review a pull request  (user)', argumentHint: '[number]' },
    { name: 'clear', description: 'Clear the conversation', builtin: true },
    { name: 'code-review', description: 'Review the diff', argumentHint: '[level]', builtin: true, aliases: ['review'] },
    { name: '__remote-workflow', builtin: true },
  ];
  const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: listingCli(dir, { subtype: 'success', response: { commands } }), chrome: false, chips: null });
  t.after(() => chat.stop());
  await until(() => chat.commands);
  assert.deepEqual(chat.commands, [
    { name: 'review-pr', description: 'Review a pull request (user)', hint: '[number]', aliases: [] },
    { name: 'code-review', description: 'Review the diff', hint: '[level]', aliases: ['review'] },
  ]);
  assert.deepEqual(await listCommands(dir, path.join(dir, 'no-such-claude')), chat.commands, 'the folder starts no CLI for what a chat has just listed');
});

test('a reply to initialize with an error or with no commands leaves the chat with no list, keeps nothing for its folder, and does not stop the chat', async t => {
  for (const reply of [{ subtype: 'error', error: 'Not today.' }, { subtype: 'success', response: {} }]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-runner-test-'));
    const chat = await startChat({ cwd: dir, mode: 'manual', text: 'hello', images: [], claude: listingCli(dir, reply), chrome: false, chips: null });
    t.after(() => chat.stop());
    assert.equal(chat.commands, null, reply.subtype);
    assert.equal(chat.status().running, true, 'the chat carries on');
    await assert.rejects(listCommands(dir, path.join(dir, 'no-such-claude')), /ENOENT/, 'the folder has to ask for itself');
  }
});
