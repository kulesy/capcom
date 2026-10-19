// Run with `npm test`. The place held for a widget while Claude writes it is a few rules about what to hold and for how long, so they
// are checked here without a page. The calls and phrases are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TEXT, hasRow, HOLD_MS, nextHold, waitText } from '../public/ui/widget-wait.js';

const read = relative => fs.readFileSync(fileURLToPath(new URL(`../public/${relative}`, import.meta.url)), 'utf8');

const WIDGET = 'mcp__capcom__show_widget';
// A name given as undefined stays undefined, which a default value would turn into the widget's.
const call = (id, loading, ...name) => ({ id, name: name.length ? name[0] : WIDGET, summary: '', ...(loading ? { loading } : {}) });
// One look at the page: what is held, what is live, which calls already have a row in the thread, and the time.
const look = (held, tools, rows = [], now = 1000) => nextHold({ held, tools, inThread: id => rows.includes(id), now });

test('the newest widget call in the live list is held, with the phrases it has sent so far', () => {
  assert.deepEqual(look(null, [call('a', ['Plotting the values'])]), { id: 'a', loading: ['Plotting the values'], since: null });
  assert.deepEqual(look(null, [call('a', ['One']), call('b', ['Two', 'Three'])]), { id: 'b', loading: ['Two', 'Three'], since: null });
  assert.deepEqual(look(null, [call('a')]), { id: 'a', loading: [], since: null });
});

test('only a show_widget call is held, from whichever server it comes, and a name that merely looks like it is not', () => {
  for (const name of [WIDGET, 'mcp__visualize__show_widget', 'mcp__0f8a1c2e-1111-4a2b-9c3d-123456789abc__show_widget']) {
    assert.equal(look(null, [call('a', [], name)])?.id, 'a', name);
  }
  for (const name of ['Bash', 'show_widget', 'mcp__capcom__show_widget_later', 'mcp__capcom__widget_guide', 'mcp__capcom__show_widgets', '', undefined, 7]) {
    assert.equal(look(null, [call('a', ['One'], name)]), null, String(name));
  }
  assert.equal(look(null, [call('a', [], 'Bash'), call('b', [], WIDGET), call('c', [], 'Read')])?.id, 'b', 'other tools beside it do not matter');
});

test('nothing is held when nothing is live, whatever shape the list is in', () => {
  for (const tools of [undefined, null, 'tools', 7, {}, [], [null, 5, 'x', {}, []], [{ name: WIDGET }, { name: WIDGET, id: 7 }, { name: WIDGET, id: '' }]]) {
    assert.equal(look(null, tools), null, JSON.stringify(tools));
  }
});

test('phrases that are not text are left out, and a list that is not a list is none', () => {
  assert.deepEqual(look(null, [call('a', ['One', 7, null, '', ['Two'], 'Three'])]).loading, ['One', 'Three']);
  for (const loading of ['Plotting', 7, { 0: 'Plotting' }, null]) assert.deepEqual(look(null, [{ ...call('a'), loading }]).loading, []);
});

test('a call whose row is already in the thread is not held, even while the call is still live', () => {
  assert.equal(look(null, [call('a', ['One'])], ['a']), null);
  assert.deepEqual(look(null, [call('a', ['One']), call('b', ['Two'])], ['b']), { id: 'a', loading: ['One'], since: null }, 'the newest call without a row is the one held');
});

test('a call that has left the live list is held until its row arrives', () => {
  const live = look(null, [call('a', ['One', 'Two'])]);
  const gone = look(live, [], [], 2000);
  assert.deepEqual(gone, { id: 'a', loading: ['One', 'Two'], since: 2000 });
  assert.deepEqual(look(gone, undefined, [], 3000), gone, 'a list that is missing counts as an empty one');
  assert.equal(look(gone, [], ['a'], 3000), null, 'the row came, so the place goes');
});

test('the hold lasts HOLD_MS from the first look that found the call gone, not from when the call began', () => {
  let held = look(null, [call('a', ['One'])], [], 0);
  held = look(held, [call('a', ['One'])], [], 30_000);
  assert.equal(held.since, null, 'a call that is still live is never counting down, however long it has been written');
  held = look(held, [], [], 30_500);
  assert.equal(held.since, 30_500);
  for (const now of [31_000, 35_000, 30_500 + HOLD_MS - 1]) {
    held = look(held, [], [], now);
    assert.equal(held?.since, 30_500, `the count starts once, and the call is still held at ${now}`);
  }
  assert.equal(look(held, [], [], 30_500 + HOLD_MS), null);
  assert.equal(look(held, [], [], 30_500 + HOLD_MS + 5000), null);
  assert.equal(look(null, [], [], 30_500 + HOLD_MS + 5000), null, 'once dropped it stays dropped');
});

test('a held call that comes back to the live list stops counting down', () => {
  const gone = look(look(null, [call('a')], [], 0), [], [], 5000);
  assert.equal(gone.since, 5000);
  assert.equal(look(gone, [call('a')], [], 8000).since, null);
});

test('a newer widget call takes the place of a held one, and the older call\'s row no longer matters', () => {
  const gone = look(look(null, [call('a', ['Old'])]), [], [], 2000);
  assert.deepEqual(look(gone, [call('b', ['New'])], [], 3000), { id: 'b', loading: ['New'], since: null });
  assert.equal(look(look(null, [call('b', ['New'])], [], 3000), [], ['a'], 4000)?.id, 'b', 'a row for another call does not end the hold');
});

test('the line shown is the call\'s own phrases in turn, wrapping round, or the default until it has sent one', () => {
  assert.equal(waitText([], 0), DEFAULT_TEXT);
  assert.equal(waitText([], 9), DEFAULT_TEXT);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(step => waitText(['One', 'Two', 'Three'], step)), ['One', 'Two', 'Three', 'One', 'Two', 'Three', 'One']);
  assert.equal(waitText(['Only'], 12), 'Only');
  assert.equal(DEFAULT_TEXT, 'Drawing a widget');
});

test('a row is found by the id of its tool call, and only a tool row counts', () => {
  const items = [{ kind: 'user', id: 'a', text: 'hi' }, { kind: 'tool', id: 'b', name: 'Bash' }, { kind: 'assistant', id: 'c' }];
  assert.equal(hasRow(items, 'b'), true);
  assert.equal(hasRow(items, 'a'), false, 'a message with the same id is not a tool row');
  assert.equal(hasRow(items, 'zzz'), false);
  assert.equal(hasRow([], 'b'), false);
  assert.equal(hasRow([null, undefined, 3, { kind: 'tool', id: 'd' }], 'd'), true);
  for (const bad of [undefined, null, 'items', {}]) assert.equal(hasRow(bad, 'b'), false);
});

// ---- how the page draws it ----------------------------------------------------------------------------------------------------

// The body of every block that opens with `header`, braces inside it included.
function blocks(css, header) {
  const found = [];
  for (let at = css.indexOf(header); at >= 0; at = css.indexOf(header, at + 1)) {
    let depth = 0;
    let end = css.indexOf('{', at);
    const start = end + 1;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    found.push(css.slice(start, end));
  }
  return found;
}

const css = read('app.css');
const rules = [...css.matchAll(/(\.widget-wait[^{]*)\{([^}]*)\}/g)].map(m => ({ selector: m[1].trim(), body: m[2] }));

test('the placeholder keeps its motion for people who have not asked for less of it', () => {
  const calm = blocks(css, '@media (prefers-reduced-motion: no-preference)');
  assert.ok(calm.some(body => /animation: widget-wait-sheen/.test(body)), 'the sheen is not in a no-preference block');
  assert.ok(calm.some(body => /animation: widget-wait-text-in/.test(body)), 'the change of phrase is not in a no-preference block');
  let outside = css;
  for (const body of calm) outside = outside.replace(body, '');
  assert.doesNotMatch(outside, /animation:[^;]*widget-wait/, 'the placeholder animates outside the no-preference block');
  assert.doesNotMatch(outside, /\.widget-wait::before/, 'the sheen is drawn outside the no-preference block');
});

test('the placeholder moves only what the browser can move without laying the page out again', () => {
  const keyframes = [...css.matchAll(/@keyframes (widget-wait-[\w-]+)\s*\{/g)].map(m => m[1]);
  assert.deepEqual(keyframes, ['widget-wait-sheen', 'widget-wait-text-in']);
  for (const name of keyframes) {
    const body = blocks(css, `@keyframes ${name}`)[0];
    assert.doesNotMatch(body, /\b(?:width|height|top|left|right|bottom|margin|padding|inset)\s*:/, `${name} changes the layout`);
  }
});

test('the placeholder is drawn only from colours the page already defines', () => {
  assert.ok(rules.length >= 3, `only ${rules.length} rules were read`);
  const names = new Set(rules.flatMap(r => [...r.body.matchAll(/var\((--[\w-]+)/g)].map(m => m[1])));
  assert.ok(names.size >= 4);
  for (const name of names) assert.match(css, new RegExp(`^\\s*${name}:`, 'm'), `${name} is not defined`);
});

test('the page puts the placeholder after the reply that is being written and before the line that says what Claude is doing', () => {
  const page = read('ui/transcript.js');
  const live = page.slice(page.indexOf('function Live('));
  const [reply, wait, working] = ['id="live"', '<${WidgetWait}', '<${Working}'].map(part => live.indexOf(part));
  assert.ok(reply > 0 && wait > reply && working > wait, 'the order in Live is not reply, placeholder, working');
});
