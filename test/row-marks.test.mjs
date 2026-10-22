// Run with `npm test`. The mark at the right of each row, as the server works it out from Desktop's record of the session, Desktop's Local
// Storage and Capcom's own marks.json: dots.test.mjs checks the rules, and these check where their facts come from. Over HTTP against the
// real server, with a fake Mac under a temporary home.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { everyRow } from '../public/ui/tree.js';
import { as, listen, request, signIn, start, until } from './harness.mjs';

const MINUTE = 60_000;
const WEEK = 7 * 24 * 60;

const index = async (s, token, query = '') => (await request(s, 'GET', `/api/sessions${query}`, { headers: as(token) })).body();
const rowOf = (ix, id) => everyRow(ix).find(r => r.id === id);
const dotsOf = ix => Object.fromEntries(everyRow(ix).map(r => [r.id, r.dot]));
const send = (s, token, id, text) => request(s, 'POST', `/api/sessions/${id}/send`, { headers: as(token), json: { text } });
const marksOf = s => JSON.parse(fs.readFileSync(path.join(s.state, 'marks.json'), 'utf8'));

async function ready(mac) {
  const s = await start(mac);
  return { s, ...(await signIn(s)) };
}

// Each case is [id, what is true of the row, the mark it shows]. Times are minutes ago. `ago` is the row's last activity, 10 by default.
// `unread` puts it in Desktop's unread list and `acked` is when Desktop last acknowledged it. `edge`, `seen`, `capcomError` and `capcomUnread`
// are Capcom's marks for it.
const CASES = [
  ['quiet', {}, null],
  ['done', { verdict: 'done' }, null],
  ['failed-verdict', { verdict: 'failed' }, 'error'],
  ['blocked', { verdict: 'blocked' }, 'awaiting'],
  ['asks', { verdict: 'need_input' }, 'awaiting'],
  ['asks-week-old', { verdict: 'need_input', ago: WEEK + 60 }, null],
  ['asks-week-old-unread', { verdict: 'need_input', ago: WEEK + 60, unread: true }, 'awaiting'],
  ['asks-routine', { verdict: 'need_input', routine: 'nightly' }, null],
  ['asks-routine-unread', { verdict: 'need_input', routine: 'nightly', unread: true }, 'awaiting'],
  ['asks-acked', { verdict: 'need_input', acked: 5 }, null],
  ['asks-acked-unread', { verdict: 'need_input', acked: 5, unread: true }, 'ready'],
  ['asks-acked-before', { verdict: 'need_input', acked: 30 }, 'awaiting'],
  ['failed-acked', { verdict: 'failed', acked: 5 }, null],
  ['error-hour', { errorAgo: 60 }, 'error'],
  ['error-week-old', { errorAgo: WEEK + 60 }, null],
  ['error-acked-after', { errorAgo: 60, acked: 30 }, null],
  ['error-acked-before', { errorAgo: 60, acked: 120 }, 'error'],
  ['unread', { unread: true }, 'ready'],
  ['unread-seen-since', { unread: true, seen: 1 }, null],
  ['unread-seen-before', { unread: true, seen: 30 }, 'ready'],
  ['verdict-stale', { verdict: 'need_input', edge: 5 }, null],
  ['error-superseded', { errorAgo: 60, edge: 30 }, null],
  ['error-after-edge', { errorAgo: 60, edge: 30, capcomError: 20 }, 'error'],
  ['capcom-error', { capcomError: 20 }, 'error'],
  ['capcom-error-week-old', { capcomError: WEEK + 60 }, null],
  ['term-error', { source: 'cli', capcomError: 20 }, 'error'],
  ['term-unread', { source: 'cli', capcomUnread: 15 }, 'ready'],
  ['term-unread-seen-since', { source: 'cli', capcomUnread: 15, seen: 5 }, null],
  ['term-unread-after-seen', { source: 'cli', capcomUnread: 5, seen: 15 }, 'ready'],
];

function macOf(cases) {
  const times = key => Object.fromEntries(cases.filter(([, facts]) => facts[key] !== undefined).map(([id, facts]) => [id, facts[key]]));
  return {
    sessions: cases.map(([id, { unread, acked, edge, seen, capcomError, capcomUnread, ...session }]) => ({ id, title: id, ...session })),
    localStorage: { unread: cases.filter(([, facts]) => facts.unread).map(([id]) => id), acked: times('acked') },
    marks: { edges: times('edge'), seen: times('seen'), errors: times('capcomError'), unread: times('capcomUnread') },
  };
}

test('a row shows the mark its record, Desktop\'s Local Storage and Capcom\'s marks add up to', async () => {
  const { s, token } = await ready(macOf(CASES));
  const dots = dotsOf(await index(s, token));
  assert.deepEqual(dots, Object.fromEntries(CASES.map(([id, , mark]) => [id, mark])));
});

test('an archived row shows no mark, whatever its record says', async () => {
  const { s, token } = await ready(macOf([
    ['asks', { verdict: 'need_input' }, 'awaiting'],
    ['archived-asks', { verdict: 'need_input', archived: true }],
    ['archived-failed', { verdict: 'failed', errorAgo: 30, archived: true }],
    ['archived-unread', { unread: true, archived: true }],
  ]));
  const dots = dotsOf(await index(s, token, '?archived=1'));
  assert.deepEqual(dots, { asks: 'awaiting', 'archived-asks': null, 'archived-failed': null, 'archived-unread': null });
});

test('what a mark is worked out from stays on the server, and every row carries its mark, null or not', async () => {
  const { s, token } = await ready(macOf(CASES));
  for (const row of everyRow(await index(s, token))) {
    assert.ok(Object.hasOwn(row, 'dot'), row.id);
    for (const key of ['verdict', 'error', 'errorAt', 'sortKey']) assert.equal(Object.hasOwn(row, key), false, `${row.id} ${key}`);
  }
});

test('a chat Capcom is working on shows running, and one waiting on an approval shows awaiting, ahead of what its record says', async () => {
  const { s, token } = await ready({
    claude: true,
    sessions: [
      { id: 'run', title: 'Running one', ago: 10 },
      { id: 'ask', title: 'Asking one', ago: 10, verdict: 'failed', errorAgo: 30 },
    ],
    localStorage: { unread: ['run', 'ask'] },
  });
  await send(s, token, 'run', 'keep going');
  await send(s, token, 'ask', 'ask for approval');
  await until(async () => {
    const ix = await index(s, token);
    return rowOf(ix, 'run').state === 'working' && rowOf(ix, 'ask').state === 'waiting';
  });
  const ix = await index(s, token);
  assert.deepEqual([rowOf(ix, 'run').dot, rowOf(ix, 'ask').dot], ['running', 'awaiting']);
});

test('a turn another app has open shows running, once it is found in the transcript and not on a recent write alone', async () => {
  const entry = (ago, extra) => ({ cwd: '/test-folder', isSidechain: false, entrypoint: 'claude-desktop', timestamp: new Date(Date.now() - ago * MINUTE).toISOString(), ...extra });
  const prompted = ago => entry(ago, { type: 'user', message: { role: 'user', content: 'Check the build' } });
  const answered = ago => entry(ago, { type: 'assistant', message: { id: 'end', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Passed.' }] } });
  const { s, token } = await ready({
    sessions: [
      { id: 'open', title: 'Mid-turn in Desktop', ago: 10 },
      { id: 'finished', title: 'Finished in Desktop', ago: 10 },
      { id: 'open-unread', title: 'Mid-turn and unread', ago: 10 },
      { id: 'open-acked', title: 'Mid-turn and acknowledged', ago: 10 },
      { id: 'term', title: 'Mid-turn in a terminal', source: 'cli', ago: 10 },
      { id: 'term-quiet', title: 'Quiet terminal', source: 'cli', ago: 11 },
    ],
    localStorage: { unread: ['open-unread'], acked: { 'open-acked': 5 } },
  });
  const rewrite = (id, ago, entries) => {
    const file = path.join(s.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`);
    fs.writeFileSync(file, entries.map(e => `${JSON.stringify(e)}\n`).join(''));
    const at = (Date.now() - ago * MINUTE) / 1000;
    fs.utimesSync(file, at, at);
  };
  for (const id of ['open', 'open-unread', 'open-acked']) rewrite(id, 0.5, [prompted(0.5)]);
  rewrite('finished', 0.5, [prompted(1), answered(0.5)]);
  rewrite('term', 0.5, [prompted(0.5)]);
  rewrite('term-quiet', 11, [prompted(11)]);
  const ix = await index(s, token);
  assert.deepEqual(dotsOf(ix), { open: 'running', finished: null, 'open-unread': 'running', 'open-acked': null, term: 'running', 'term-quiet': null });
  assert.equal(rowOf(ix, 'finished').state, 'active', 'it was written moments ago, which is not a turn');
});

test('a turn that fails shows an error until the next turn begins, and a turn that ends with no page open shows ready until a page opens the chat', async () => {
  const { s, token } = await ready({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 10 }] });
  const dot = async () => rowOf(await index(s, token), 'calm').dot;
  assert.equal(await dot(), null);

  await send(s, token, 'calm', 'fail the turn');
  await until(async () => (await dot()) === 'error');

  await send(s, token, 'calm', 'finish the turn');
  await until(async () => (await dot()) === 'ready');

  const viewer = listen(s, token, 'calm');
  await until(() => viewer.events.length);
  assert.equal(await dot(), null, 'a page with the chat open has read it');
  await until(() => marksOf(s).seen.calm);
  const opened = marksOf(s).seen.calm;
  await new Promise(resolve => setTimeout(resolve, 30));
  viewer.close();
  await until(() => marksOf(s).seen.calm > opened);
  assert.equal(await dot(), null, 'and it stays read once the page closes it');
});

test('a row whose last turn is later than a page last saw it is ready, unless a page has the chat open now', async () => {
  // The record puts the last turn ten minutes ahead of now, so opening the chat now is before it.
  const { s, token } = await ready({ sessions: [{ id: 'fresh', title: 'Fresh turn', ago: 10, edgeAgo: -10 }], localStorage: { unread: ['fresh'] } });
  const dot = async () => rowOf(await index(s, token), 'fresh').dot;
  assert.equal(await dot(), 'ready');

  const viewer = listen(s, token, 'fresh');
  await until(() => viewer.events.length);
  assert.equal(await dot(), null);
  await new Promise(resolve => setTimeout(resolve, 30));
  viewer.close();
  await until(async () => (await dot()) === 'ready');
});

test('the server writes marks.json as Capcom runs a turn and as a page opens and closes a chat', async () => {
  const { s, token } = await ready({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 10 }] });
  const file = path.join(s.state, 'marks.json');
  assert.equal(fs.existsSync(file), false, 'nothing is written until there is something to say');

  const asked = Date.now();
  await send(s, token, 'calm', 'keep going');
  await until(() => fs.existsSync(file) && marksOf(s).edges.calm >= asked);
  assert.deepEqual([marksOf(s).unread, marksOf(s).errors], [{}, {}]);

  await send(s, token, 'calm', 'finish the turn');
  await until(() => marksOf(s).unread.calm);
  const ended = marksOf(s);
  assert.equal(ended.edges.calm, ended.unread.calm, 'the end of the turn is the edge, and what the page has not read');

  const viewer = listen(s, token, 'calm');
  await until(() => marksOf(s).seen.calm);
  const opened = marksOf(s);
  assert.ok(opened.seen.calm >= ended.unread.calm, 'a page opening the chat has seen it');
  assert.equal('calm' in opened.unread, false, 'and it is read');

  // The viewer hears the chat go idle after the mark for the end of the turn is written.
  const heard = viewer.events.length;
  await send(s, token, 'calm', 'finish the turn');
  await until(() => viewer.events.slice(heard).some(e => e.type === 'state' && e.data.state === 'idle'));
  assert.ok(marksOf(s).edges.calm > ended.edges.calm, 'the second turn moved the edge');
  assert.equal('calm' in marksOf(s).unread, false, 'a turn that ends with a page on the chat leaves nothing unread');

  await new Promise(resolve => setTimeout(resolve, 30));
  viewer.close();
  await until(() => marksOf(s).seen.calm > opened.seen.calm);
  assert.equal(fs.readdirSync(s.state).some(name => name.endsWith('.tmp')), false, 'no temp file is left');
});
