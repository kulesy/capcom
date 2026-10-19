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

// A block that is not an object. The array holds a tool call of its own, which must not be tracked.
const NOT_OBJECTS = [null, 'text', 7, true, [{ type: 'tool_use', id: 'inside', name: 'Bash', input: {} }]];

test('a block that is not an object costs only itself: a tool beside it is still tracked, and ends when its result arrives', () => {
  for (const bad of NOT_OBJECTS) {
    const t = turn();
    t.work.begin();
    t.feed({ type: 'assistant', message: { id: 'msg_1', content: [bad, { type: 'text', text: 'Looking.' }, bad, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }, bad] } });
    assert.deepEqual(t.work.snapshot().tools, [{ id: 'toolu_1', name: 'Bash', summary: 'ls' }], String(bad));
    t.feed({ type: 'user', message: { role: 'user', content: [bad, { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }, bad] } });
    assert.deepEqual(t.work.snapshot().tools, [], String(bad));
  }
});

test('content that is not a list costs only its own message, so the tool tracked before it is still tracked after', () => {
  const t = turn();
  t.work.begin();
  t.feed({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } });
  for (const content of [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: {} }, 7, true, 'text']) {
    t.feed({ type: 'assistant', message: { id: 'msg_2', content } }, { type: 'user', message: { role: 'user', content } });
  }
  assert.deepEqual(t.work.snapshot().tools, [{ id: 'toolu_1', name: 'Bash', summary: 'ls' }]);
});

test('a tool call whose input is null is named with no summary, whether it arrives finished or as streamed JSON', () => {
  const t = turn();
  t.work.begin();
  t.feed({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: null }] } });
  t.feed(messageStart('msg_2'), toolStart(0, 'toolu_2', 'Bash'), toolInput(0, 'null'), blockStop(0));
  assert.deepEqual(t.work.snapshot().tools, [{ id: 'toolu_1', name: 'Bash', summary: '' }, { id: 'toolu_2', name: 'Bash', summary: '' }]);
});

const COMPUTER = 'mcp__claude-in-chrome__computer';

// A tool call as the CLI sends it: whole in a finished message, or as partial messages that end with its input as streamed JSON.
const ARRIVALS = {
  finished: (t, n, name, input) => t.feed({ type: 'assistant', message: { id: `msg_${n}`, content: [{ type: 'tool_use', id: `toolu_${n}`, name, input }] } }),
  streamed: (t, n, name, input) => t.feed(messageStart(`msg_${n}`), toolStart(0, `toolu_${n}`, name), toolInput(0, JSON.stringify(input)), blockStop(0)),
};

test('a Chrome computer call whose coordinate is not a list is tracked with the summary it can give, whether it arrives finished or as streamed JSON', () => {
  for (const [how, arrive] of Object.entries(ARRIVALS)) {
    const t = turn();
    t.work.begin();
    [[512, 300], '[512, 300]', 512, { x: 512, y: 300 }].forEach((coordinate, n) => arrive(t, n, COMPUTER, { action: 'left_click', coordinate }));
    assert.deepEqual(t.work.snapshot().tools.map(x => [x.id, x.summary]), [['toolu_0', 'left_click at 512,300'], ['toolu_1', 'left_click'], ['toolu_2', 'left_click'], ['toolu_3', 'left_click']], how);
  }
});

test('a tool call whose name is not a string, or is missing, is tracked with an empty name, whether it arrives finished or as streamed JSON', () => {
  for (const [how, arrive] of Object.entries(ARRIVALS)) {
    const t = turn();
    t.work.begin();
    [7, undefined, null, ['Bash'], 'Bash'].forEach((name, n) => arrive(t, n, name, { command: 'ls' }));
    assert.deepEqual(t.work.snapshot().tools, [
      { id: 'toolu_0', name: '', summary: 'ls' },
      { id: 'toolu_1', name: '', summary: 'ls' },
      { id: 'toolu_2', name: '', summary: 'ls' },
      { id: 'toolu_3', name: '', summary: 'ls' },
      { id: 'toolu_4', name: 'Bash', summary: 'ls' },
    ], how);
  }
});

// ---- the phrases a widget call opens with --------------------------------------------------------------------------------------

const WIDGET = 'mcp__capcom__show_widget';
const pieces = (json, size) => json.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'));
// Each list of phrases the page was sent for the first tool, in order. A report that leaves the list alone shares the array the one
// before it sent, so it shows once here, and a list that was changed after it was sent would show as its grown self in both places.
function phrases(t) {
  const lists = [];
  for (const [type, work] of t.heard) {
    const list = type === 'work' ? work?.tools[0]?.loading : undefined;
    if (list && list !== lists.at(-1)) lists.push(list);
  }
  return lists;
}

// A widget call as the API streams it: the input as JSON cut into pieces that can end anywhere. A name given as undefined stays so.
function widgetCall(t, json, size, options = {}) {
  t.feed(messageStart('msg_w'), toolStart(0, options.id ?? 'toolu_w', 'name' in options ? options.name : WIDGET));
  for (const piece of pieces(json, size)) t.feed(toolInput(0, piece));
  t.feed(blockStop(0));
}

test('a widget call\'s phrases are reported as each one is finished, whichever delta ends it, and a report never changes a list already sent', () => {
  const t = turn();
  t.work.begin();
  t.feed(messageStart('msg_1'), toolStart(0, 'toolu_1', WIDGET));
  t.feed(toolInput(0, '{"loading_messages": ["Plott'));
  assert.deepEqual(phrases(t), [], 'a phrase that is not finished yet is not sent');
  t.feed(toolInput(0, 'ing the values", "Draw'));
  t.feed(toolInput(0, 'ing the bars"'));
  assert.deepEqual(phrases(t), [['Plotting the values'], ['Plotting the values', 'Drawing the bars']]);
  const sent = t.heard.length;
  t.feed(toolInput(0, '], "title": "q4_sales", "widget_code": "<svg viewBox=\\"0 0 4 4\\"></svg>"}'));
  assert.equal(t.heard.length, sent, 'once the list is closed nothing in the rest of the input is reported');
  t.feed(blockStop(0));
  assert.deepEqual(phrases(t).at(-1), ['Plotting the values', 'Drawing the bars']);
  assert.deepEqual(phrases(t)[0], ['Plotting the values'], 'the list sent first did not grow when the second was made');
  assert.deepEqual(t.work.snapshot().tools, [{ id: 'toolu_1', name: WIDGET, summary: 'q4_sales', loading: ['Plotting the values', 'Drawing the bars'] }]);
});

test('a phrase is read the same however the input is cut, down to one character at a time, and escapes and accents come out as written', () => {
  const json = '{"loading_messages":["Say \\"hi\\" to caf\\u00e9","Crème brûlée \\\\ \\/ tab\\there"],"title":"x","widget_code":"<p></p>"}';
  for (const size of [1, 2, 3, 5, 8, 13, 400]) {
    const t = turn();
    t.work.begin();
    widgetCall(t, json, size);
    assert.deepEqual(t.work.snapshot().tools[0].loading, ['Say "hi" to café', 'Crème brûlée \\ / tab here'], `pieces of ${size}`);
  }
});

test('the phrases are found wherever the key sits in the input, and however it is cut, even behind a long widget', () => {
  const rest = '"loading_messages":  [ "Late one" ,\n "Second" ],"title":"x"}';
  const json = `{"widget_code":"${'<p>padding</p>'.repeat(40)}",${rest}`;
  for (const size of [1, 2, 3, 7, 31, 63, 64, 65, 66, 1000]) {
    const t = turn();
    t.work.begin();
    widgetCall(t, json, size);
    assert.deepEqual(t.work.snapshot().tools[0].loading, ['Late one', 'Second'], `pieces of ${size}`);
  }
  for (let at = json.length - rest.length - 3; at < json.length - 20; at++) {
    const t = turn();
    t.work.begin();
    t.feed(messageStart('msg_w'), toolStart(0, 'toolu_w', WIDGET), toolInput(0, json.slice(0, at)), toolInput(0, json.slice(at)), blockStop(0));
    assert.deepEqual(t.work.snapshot().tools[0].loading, ['Late one', 'Second'], `cut at ${at}`);
  }
});

test('the same words inside the widget\'s own code are not its phrases, but the real key after them is', () => {
  const fake = '<script>const config = {"loading_messages":["Not this"], "other": 1}</script>';
  const alone = turn();
  alone.work.begin();
  widgetCall(alone, JSON.stringify({ title: 'x', widget_code: fake }), 6);
  assert.deepEqual(alone.work.snapshot().tools, [{ id: 'toolu_w', name: WIDGET, summary: 'x' }], 'no phrases, and no empty list either');
  const both = turn();
  both.work.begin();
  widgetCall(both, JSON.stringify({ widget_code: fake, loading_messages: ['Real one'], title: 'x' }), 6);
  assert.deepEqual(both.work.snapshot().tools[0].loading, ['Real one']);
  assert.deepEqual(phrases(both), [['Real one']]);
});

test('at most four phrases are kept, empty ones are dropped, each is one trimmed line of at most eighty characters, and the rest of the list is not read', () => {
  const given = ['', '  Plotting \n  the   values\t', 'x'.repeat(200), '\u{1F600}'.repeat(100), 'c', 'd', 'e'];
  const expected = ['Plotting the values', 'x'.repeat(80), '\u{1F600}'.repeat(80), 'c'];
  const t = turn();
  t.work.begin();
  widgetCall(t, JSON.stringify({ loading_messages: given, title: 'x', widget_code: '<p></p>' }), 9);
  assert.deepEqual(t.work.snapshot().tools[0].loading, expected);
  assert.deepEqual(phrases(t).at(-1), expected);
  assert.equal(phrases(t).every(list => list.length <= 4), true);
  const spaces = turn();
  spaces.work.begin();
  widgetCall(spaces, JSON.stringify({ loading_messages: [`${'a'.repeat(79)} ${'b'.repeat(10)}`, '   ', 'ok'], title: 'x', widget_code: '' }), 9);
  assert.deepEqual(spaces.work.snapshot().tools[0].loading, ['a'.repeat(79), 'ok'], 'a cut that ends on a space is trimmed');
});

test('a phrase that is far too long, or a list that holds something other than text, ends the reading with what was read before it', () => {
  for (const [list, expected] of [[['ok', 'y'.repeat(500), 'never read'], ['ok']], [['one', 7, 'two'], ['one']], [['one', null], ['one']], [['one', ['two']], ['one']]]) {
    const t = turn();
    t.work.begin();
    widgetCall(t, JSON.stringify({ loading_messages: list, title: 'x', widget_code: '<p></p>' }), 11);
    assert.deepEqual(t.work.snapshot().tools[0].loading, expected, JSON.stringify(list).slice(0, 40));
  }
});

test('an empty list, text where the list should be, or no key at all gives no phrases', () => {
  for (const input of [{ loading_messages: [] }, { loading_messages: ['', '  '] }, { loading_messages: 'Plotting' }, { loading_messages: null }, { loading_messages: { 0: 'Plotting' } }, {}]) {
    const t = turn();
    t.work.begin();
    widgetCall(t, JSON.stringify({ ...input, title: 'x', widget_code: '<p></p>' }), 8);
    assert.deepEqual(t.work.snapshot().tools, [{ id: 'toolu_w', name: WIDGET, summary: 'x' }], JSON.stringify(input));
    assert.deepEqual(phrases(t), []);
  }
});

test('any server\'s show_widget is read the same way, and no other tool is', () => {
  const json = JSON.stringify({ loading_messages: ['Plotting'], title: 'x', widget_code: '<p></p>', command: 'ls' });
  const read = ['mcp__capcom__show_widget', 'mcp__visualize__show_widget', 'mcp__0f8a1c2e-1111-4a2b-9c3d-123456789abc__show_widget'];
  const left = ['Bash', 'show_widget', 'mcp__capcom__show_widget_later', 'mcp__capcom__widget_guide', 'mcp__capcom__show_widgets', '', undefined, 7];
  for (const name of read) {
    const t = turn();
    t.work.begin();
    widgetCall(t, json, 10, { name });
    assert.deepEqual(t.work.snapshot().tools[0].loading, ['Plotting'], name);
  }
  for (const name of left) {
    const t = turn();
    t.work.begin();
    widgetCall(t, json, 10, { name });
    assert.equal('loading' in t.work.snapshot().tools[0], false, String(name));
  }
});

test('two widget calls in one message keep their own phrases', () => {
  const t = turn();
  t.work.begin();
  t.feed(messageStart('msg_1'), toolStart(0, 'a', WIDGET), toolStart(1, 'b', WIDGET));
  t.feed(toolInput(0, '{"loading_messages":["First'), toolInput(1, '{"loading_messages":["Second","Third"]'), toolInput(0, ' one"]'));
  assert.deepEqual(t.work.snapshot().tools.map(x => x.loading), [['First one'], ['Second', 'Third']]);
});

test('a CLI that streams nothing partial gives the phrases from the finished message, cleaned the same way', () => {
  const finished = (id, input) => ({ type: 'assistant', message: { id: `msg_${id}`, content: [{ type: 'tool_use', id, name: WIDGET, input }] } });
  const t = turn();
  t.work.begin();
  t.feed(finished('a', { loading_messages: ['', ' Plotting  the values ', 7, null, 'x'.repeat(200), 'c', 'd', 'e'], title: 'chart', widget_code: '<p></p>' }));
  assert.deepEqual(t.work.snapshot().tools, [{ id: 'a', name: WIDGET, summary: 'chart', loading: ['Plotting the values', 'x'.repeat(80), 'c', 'd'] }]);
  t.feed(finished('b', { loading_messages: 'Plotting', title: 'x' }), finished('c', { title: 'x' }), finished('d', { loading_messages: [], title: 'x' }));
  assert.deepEqual(t.work.snapshot().tools.slice(1), [{ id: 'b', name: WIDGET, summary: 'x' }, { id: 'c', name: WIDGET, summary: 'x' }, { id: 'd', name: WIDGET, summary: 'x' }]);
  t.feed({ type: 'assistant', message: { id: 'msg_e', content: [{ type: 'tool_use', id: 'e', name: 'Bash', input: { loading_messages: ['No'], command: 'ls' } }] } });
  assert.equal('loading' in t.work.snapshot().tools.at(-1), false);
});

test('the finished message adds nothing when the stream already gave the same phrases, and fills in what the stream missed', () => {
  const t = turn();
  t.work.begin();
  widgetCall(t, '{"loading_messages":["One","Two"],"title":"chart","widget_code":"<p></p>"}', 12);
  const before = t.heard.length;
  const input = { loading_messages: ['One', 'Two'], title: 'chart', widget_code: '<p></p>' };
  t.feed({ type: 'assistant', message: { id: 'msg_w', content: [{ type: 'tool_use', id: 'toolu_w', name: WIDGET, input }] } });
  assert.equal(t.heard.length, before, 'the same phrases are not sent again');
  t.feed({ type: 'assistant', message: { id: 'msg_w', content: [{ type: 'tool_use', id: 'toolu_w', name: WIDGET, input: { ...input, loading_messages: ['One', 'Two', 'Three'] } }] } });
  assert.deepEqual(phrases(t).at(-1), ['One', 'Two', 'Three']);
  t.feed({ type: 'assistant', message: { id: 'msg_w', content: [{ type: 'tool_use', id: 'toolu_w', name: WIDGET, input: { title: 'chart' } }] } });
  assert.deepEqual(t.work.snapshot().tools[0].loading, ['One', 'Two', 'Three'], 'a finished message with none does not take back what was streamed');
});

test('a widget\'s phrases go with its tool, so they are gone when its result is back', () => {
  const t = turn();
  t.work.begin();
  widgetCall(t, '{"loading_messages":["One"],"title":"chart","widget_code":"<p></p>"}', 12);
  assert.deepEqual(t.work.snapshot().tools.map(x => x.loading), [['One']]);
  t.feed(toolResult('toolu_w'));
  assert.deepEqual(t.work.snapshot().tools, []);
});
