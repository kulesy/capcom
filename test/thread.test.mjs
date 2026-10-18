// Run with `npm test`. The page's thread logic is plain functions on plain data, so it runs here without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { absorb, activity, display, prepend, summarize } from '../public/ui/thread.js';

let n = 0;
const item = (kind, extra = {}) => ({ kind, key: `k${++n}`, ...extra });
const tool = (name, extra = {}) => item('tool', { id: `t${n + 1}`, name, status: 'ok', input: {}, ...extra });
const think = text => item('thinking', { msgId: 'm', text });
const said = text => item('assistant', { msgId: 'm', text });

test('thinking between tool calls folds into the group with them, in order', () => {
  const [a, b, c] = [think('first'), tool('Bash'), think('second')];
  const rows = display([said('Hello'), a, b, c, tool('Read')]);
  assert.deepEqual(rows.map(r => r.kind), ['assistant', 'group']);
  assert.equal(rows[1].rows.length, 4);
  assert.deepEqual(rows[1].rows.slice(0, 3), [a, b, c]);
  assert.equal(rows[1].key, `g${a.key}`);
});

test('thinking with no tool call beside it stays a row of its own, one for each block', () => {
  const [a, b, reply] = [think('one'), think('two'), said('Done')];
  assert.deepEqual(display([a, b, reply]), [a, b, reply]);
});

test('a message or a card ends a run, so the thinking after it starts the next one', () => {
  const rows = display([tool('Bash'), said('Result'), think('more'), tool('Grep'), tool('mcp__capcom__spawn_task'), tool('Read')]);
  assert.deepEqual(rows.map(r => r.kind), ['group', 'assistant', 'group', 'tool', 'group']);
  assert.equal(rows[2].rows.length, 2);
});

test('a group that thought says so first, then what its calls did', () => {
  const g = summarize([think('x'), think('y'), tool('Read', { input: { file_path: '/a' } }), tool('Bash')]);
  assert.equal(g.title, 'Thought, read 1 file, ran 1 command');
  assert.equal(g.status, 'ok');
  assert.equal(summarize([tool('Bash', { status: 'pending' }), think('z')]).note, 'running');
});

test('sending a message to another session and looking up who can receive one are named in a group, not counted as other tools', () => {
  const g = summarize([tool('ListAgents'), tool('SendMessage', { input: { to: 'Worker' } }), tool('SendMessage', { input: { to: 'Worker' } })]);
  assert.equal(g.title, 'Looked up other sessions, sent 2 messages');
  assert.equal(summarize([tool('SendMessage', { status: 'denied' })]).note, '1 denied');
  assert.deepEqual(activity({ tools: [{ name: 'SendMessage', summary: 'to Worker: Run the tests' }] }), { doing: 'Sending a message', detail: 'to Worker: Run the tests' });
  assert.deepEqual(activity({ tools: [{ name: 'ListAgents', summary: 'other sessions' }] }), { doing: 'Looking up other sessions', detail: 'other sessions' });
});

test('the status line names the one tool running, with what it works on', () => {
  assert.deepEqual(activity({ tools: [{ name: 'Bash', summary: 'npm test' }] }), { doing: 'Running', detail: 'npm test' });
  assert.deepEqual(activity({ tools: [{ name: 'Read', summary: 'lib/runner.mjs' }] }), { doing: 'Reading', detail: 'lib/runner.mjs' });
  assert.deepEqual(activity({ tools: [{ name: 'mcp__claude-in-chrome__navigate', summary: 'https://example.com' }] }), { doing: 'Using Chrome', detail: 'https://example.com' });
  assert.deepEqual(activity({ tools: [{ name: 'mcp__visualize__show_widget', summary: '' }] }), { doing: 'Using', detail: 'visualize show widget' });
  assert.deepEqual(activity({ tools: [{ name: 'mcp__Claude_Browser__computer', summary: 'screenshot' }] }), { doing: 'Using', detail: 'Claude Browser computer: screenshot' });
});

test('several tools at once are counted and named once each', () => {
  const work = { tools: [{ name: 'Read', summary: 'a' }, { name: 'Read', summary: 'b' }, { name: 'Grep', summary: 'c' }] };
  assert.deepEqual(activity(work), { doing: 'Running 3 tools', detail: 'Read, Grep' });
});

test('several MCP tools at once are named with their servers, so two called computer are told apart', () => {
  const work = { tools: [{ name: 'mcp__Claude_Browser__computer', summary: 'screenshot' }, { name: 'mcp__claude-in-chrome__computer', summary: 'screenshot' }, { name: 'mcp__Claude_Browser__computer', summary: 'zoom' }, { name: 'Read', summary: 'a' }] };
  assert.deepEqual(activity(work), { doing: 'Running 4 tools', detail: 'Claude Browser computer, Chrome computer, Read' });
});

test('with no tool the status line says thinking, writing or just working', () => {
  assert.equal(activity({ tools: [], thinking: true, writing: false }).doing, 'Thinking');
  assert.equal(activity({ tools: [], thinking: false, writing: true }).doing, 'Writing');
  assert.equal(activity({ tools: [], thinking: false, writing: false }).doing, 'Working');
  assert.equal(activity(null).doing, 'Working');
});

const fresh = () => ({ items: [], orphans: new Map() });
const call = (id, name = 'Read') => ({ kind: 'tool', id, name, status: 'pending', summary: '' });
const answer = (toolId, extra = {}) => ({ kind: 'result', toolId, status: 'ok', output: 'done', ...extra });
const shot = ref => ({ ref, type: 'image/png' });

test('a result hands its pictures to its tool, and one with none leaves the tool without a list', () => {
  const [read, grep] = [call('toolu_1'), call('toolu_2', 'Grep')];
  const { items } = absorb(fresh(), [read, grep, answer('toolu_1', { images: [shot('5.r0.u'), shot('5.r1.u')] }), answer('toolu_2')]);
  assert.deepEqual(items.map(i => [i.status, i.output]), [['ok', 'done'], ['ok', 'done']]);
  assert.deepEqual(items[0].images, [shot('5.r0.u'), shot('5.r1.u')]);
  assert.equal('images' in items[1], false);
  assert.equal('images' in read, false, 'the tool the page held before is not changed in place');
});

test('a result that arrives in a later read finds its tool already in the thread and brings its pictures', () => {
  const first = absorb(fresh(), [call('toolu_1')]);
  const next = absorb(first, [answer('toolu_1', { images: [shot('9.r0.u')] })]);
  assert.deepEqual(next.items[0].images, [shot('9.r0.u')]);
  assert.equal(first.items[0].status, 'pending');
  assert.equal(next.orphans.size, 0);
});

test('a result that comes before its tool waits with its pictures, and the earlier chunk that holds the tool settles it', () => {
  const later = absorb(fresh(), [answer('toolu_1', { images: [shot('7.r0.u')] })]);
  assert.equal(later.items.length, 0);
  assert.deepEqual(later.orphans.get('toolu_1').images, [shot('7.r0.u')]);
  const joined = prepend(later, [call('toolu_1'), call('toolu_2')]);
  assert.deepEqual(joined.items.map(i => [i.id, i.status]), [['toolu_1', 'ok'], ['toolu_2', 'pending']]);
  assert.deepEqual(joined.items[0].images, [shot('7.r0.u')]);
  assert.equal('images' in joined.items[1], false);
  assert.equal(joined.orphans.size, 0);
});

test('a chunk that holds both a tool and its result brings the pictures too, and one without pictures adds no list', () => {
  const joined = prepend(absorb(fresh(), [call('toolu_9')]), [call('toolu_1'), answer('toolu_1', { images: [shot('2.r0.u')] }), call('toolu_2'), answer('toolu_2')]);
  assert.deepEqual(joined.items[0].images, [shot('2.r0.u')]);
  assert.equal('images' in joined.items[1], false);
  assert.equal(joined.items.length, 3);
});
