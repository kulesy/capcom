// Run with `npm test`. The page's thread logic is plain functions on plain data, so it runs here without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { activity, display, summarize } from '../public/ui/thread.js';

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

test('the status line names the one tool running, with what it works on', () => {
  assert.deepEqual(activity({ tools: [{ name: 'Bash', summary: 'npm test' }] }), { doing: 'Running', detail: 'npm test' });
  assert.deepEqual(activity({ tools: [{ name: 'Read', summary: 'lib/runner.mjs' }] }), { doing: 'Reading', detail: 'lib/runner.mjs' });
  assert.deepEqual(activity({ tools: [{ name: 'mcp__claude-in-chrome__navigate', summary: 'https://example.com' }] }), { doing: 'Using Chrome', detail: 'https://example.com' });
  assert.deepEqual(activity({ tools: [{ name: 'mcp__visualize__show_widget', summary: '' }] }), { doing: 'Using', detail: 'show widget' });
});

test('several tools at once are counted and named once each', () => {
  const work = { tools: [{ name: 'Read', summary: 'a' }, { name: 'Read', summary: 'b' }, { name: 'Grep', summary: 'c' }] };
  assert.deepEqual(activity(work), { doing: 'Running 3 tools', detail: 'Read, Grep' });
});

test('with no tool the status line says thinking, writing or just working', () => {
  assert.equal(activity({ tools: [], thinking: true, writing: false }).doing, 'Thinking');
  assert.equal(activity({ tools: [], thinking: false, writing: true }).doing, 'Writing');
  assert.equal(activity({ tools: [], thinking: false, writing: false }).doing, 'Working');
  assert.equal(activity(null).doing, 'Working');
});
