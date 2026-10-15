// Run with `npm test`. The messages are the ones the CLI streams, in the order it streams them, trimmed to what the tracker reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWork } from '../lib/work.mjs';

const stream = event => ({ type: 'stream_event', event });
const messageStart = id => stream({ type: 'message_start', message: { id } });
const blockStart = (index, content_block) => stream({ type: 'content_block_start', index, content_block });
const blockDelta = (index, delta) => stream({ type: 'content_block_delta', index, delta });
const blockStop = index => stream({ type: 'content_block_stop', index });
const messageDelta = output_tokens => stream({ type: 'message_delta', usage: { output_tokens } });
const thinkingStart = index => blockStart(index, { type: 'thinking', thinking: '', signature: '' });
const thinking = (index, text) => blockDelta(index, { type: 'thinking_delta', thinking: text });
const toolStart = (index, id, name) => blockStart(index, { type: 'tool_use', id, name, input: {} });
const toolInput = (index, json) => blockDelta(index, { type: 'input_json_delta', partial_json: json });
const toolResult = id => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

function turn() {
  const clock = { t: 1_000_000 };
  const work = createWork('/work', () => clock.t);
  const heard = [];
  const feed = (...messages) => { for (const m of messages) heard.push(...work.feed(m)); };
  return { work, clock, heard, feed, types: () => heard.map(([type]) => type) };
}

test('nothing is reported before a turn begins, and the snapshot is empty', () => {
  const t = turn();
  t.feed(messageStart('msg_1'), thinkingStart(0), thinking(0, 'hello'));
  assert.deepEqual(t.heard, []);
  assert.equal(t.work.snapshot(), null);
  assert.equal(t.work.thought(), null);
});

test('a turn starts the clock, and the snapshot says how long it has run', () => {
  const t = turn();
  assert.deepEqual(t.work.begin(), [['work', { thinking: false, writing: false, tools: [], tokens: 0, turnMs: 0 }]]);
  t.clock.t += 12_500;
  assert.equal(t.work.snapshot().turnMs, 12_500);
  assert.deepEqual(t.work.begin(), [], 'a second start does not move it');
  assert.equal(t.work.snapshot().turnMs, 12_500);
});

test('thinking text is passed on as it arrives, the block is marked done, and only the one in progress can be read back', () => {
  const t = turn();
  t.work.begin();
  t.feed(messageStart('msg_1'), thinkingStart(0), thinking(0, 'I need to check '), thinking(0, '91.'));
  assert.deepEqual(t.heard.filter(([type]) => type === 'think'), [['think', { id: 'msg_1', text: 'I need to check ' }], ['think', { id: 'msg_1', text: '91.' }]]);
  assert.equal(t.work.snapshot().thinking, true);
  assert.deepEqual(t.work.thought(), { id: 'msg_1', text: 'I need to check 91.', done: false });
  t.feed(blockStop(0));
  assert.deepEqual(t.heard.filter(([type]) => type === 'think').at(-1), ['think', { id: 'msg_1', done: true }]);
  assert.equal(t.work.snapshot().thinking, false);
  assert.equal(t.work.thought(), null, 'a finished block is in the transcript already');
});

test('two thinking blocks in one message read as paragraphs, and a new message starts the text again', () => {
  const t = turn();
  t.work.begin();
  t.feed(messageStart('msg_1'), thinkingStart(0), thinking(0, 'First.'), blockStop(0), thinkingStart(1), thinking(1, 'Second.'));
  assert.equal(t.work.thought().text, 'First.\n\nSecond.');
  t.feed(blockStop(1), messageStart('msg_2'), thinkingStart(0), thinking(0, 'Third.'));
  assert.deepEqual(t.work.thought(), { id: 'msg_2', text: 'Third.', done: false });
});

test('thinking with no text, as a CLI that redacts it streams it, shows as thinking but sends nothing to read', () => {
  const t = turn();
  t.work.begin();
  t.feed(messageStart('msg_1'), thinkingStart(0), thinking(0, ''), blockStop(0));
  assert.equal(t.types().includes('think'), false);
  assert.equal(t.work.thought(), null);
  assert.equal(t.heard.some(([type, data]) => type === 'work' && data.thinking), true);
});

test('a tool call is named when it starts, gets its summary when the input is complete, and is gone when its result is back', () => {
  const t = turn();
  t.work.begin();
  t.feed(messageStart('msg_1'), toolStart(0, 'toolu_1', 'Bash'));
  assert.deepEqual(t.work.snapshot().tools, [{ id: 'toolu_1', name: 'Bash', summary: '' }]);
  t.feed(toolInput(0, '{"command":"npm '), toolInput(0, 'test"}'), blockStop(0));
  assert.deepEqual(t.work.snapshot().tools, [{ id: 'toolu_1', name: 'Bash', summary: 'npm test' }]);
  const before = t.heard.length;
  t.feed({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }] } });
  assert.equal(t.heard.length, before, 'the finished message says nothing new');
  t.feed(toolResult('toolu_1'));
  assert.deepEqual(t.work.snapshot().tools, []);
});

test('several tools in one message are all listed, with paths relative to the folder', () => {
  const t = turn();
  t.work.begin();
  t.feed(messageStart('msg_1'), toolStart(0, 'a', 'Read'), toolInput(0, '{"file_path":"/work/lib/runner.mjs"}'), blockStop(0), toolStart(1, 'b', 'Grep'), toolInput(1, '{"pattern":"think"}'), blockStop(1));
  assert.deepEqual(t.work.snapshot().tools.map(x => [x.name, x.summary]), [['Read', 'lib/runner.mjs'], ['Grep', 'think']]);
  t.feed(toolResult('a'));
  assert.deepEqual(t.work.snapshot().tools.map(x => x.id), ['b']);
});

test('a CLI that sends no partial messages still names the tool from the finished message', () => {
  const t = turn();
  t.work.begin();
  t.feed({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'toolu_9', name: 'Glob', input: { pattern: '**/*.mjs' } }] } });
  assert.deepEqual(t.work.snapshot().tools, [{ id: 'toolu_9', name: 'Glob', summary: '**/*.mjs' }]);
});

test('text being written shows as writing until its block ends', () => {
  const t = turn();
  t.work.begin();
  t.feed(messageStart('msg_1'), blockStart(0, { type: 'text', text: '' }));
  assert.equal(t.work.snapshot().writing, true);
  t.feed(blockStop(0));
  assert.equal(t.work.snapshot().writing, false);
});

test('tokens are the output counts of the replies that have finished, one per message, so they never move while a reply is in progress', () => {
  const t = turn();
  t.work.begin();
  t.feed(messageStart('msg_1'), thinkingStart(0), thinking(0, 'x'));
  assert.equal(t.work.snapshot().tokens, 0);
  t.feed(messageDelta(518));
  assert.equal(t.work.snapshot().tokens, 518);
  t.feed(messageDelta(520));
  assert.equal(t.work.snapshot().tokens, 520, 'a later count for the same message replaces the earlier one');
  t.feed(messageStart('msg_2'), messageDelta(166));
  assert.equal(t.work.snapshot().tokens, 686);
});

test('what a subagent streams is not the session\'s own work', () => {
  const t = turn();
  t.work.begin();
  t.feed({ ...messageStart('msg_9'), parent_tool_use_id: 'toolu_agent' }, { ...toolStart(0, 'inner', 'Bash'), parent_tool_use_id: 'toolu_agent' });
  assert.deepEqual(t.work.snapshot().tools, []);
  assert.deepEqual(t.heard, []);
});

test('the end of a turn clears everything, so the next one starts from nothing', () => {
  const t = turn();
  t.work.begin();
  t.feed(messageStart('msg_1'), thinkingStart(0), thinking(0, 'x'), toolStart(1, 'a', 'Bash'), messageDelta(40));
  t.work.end();
  assert.equal(t.work.snapshot(), null);
  assert.equal(t.work.thought(), null);
  t.clock.t += 5_000;
  t.work.begin();
  assert.deepEqual(t.work.snapshot(), { thinking: false, writing: false, tools: [], tokens: 0, turnMs: 0 });
});
