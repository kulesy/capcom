// Run with `npm test`. How a group's sessions fall into the parts of its panel and of the list tool, and the summary line over them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUCKETS, bucketOf, bucketsOf, membersOf, RECENT_MS, summaryOf } from '../public/ui/group-rules.js';

const NOW = Date.parse('2026-10-23T06:00:00.000Z');
const row = (id, state, ago, extra) => ({ id, state, lastActivityAt: NOW - ago, ...extra });
const ids = list => list.map(r => r.id);

test('a session that needs you, one that is working, a recent one and an idle one each fall in their own part, and an archived one in the last', () => {
  assert.deepEqual(BUCKETS.map(b => b.key), ['needs', 'working', 'recent', 'idle', 'archived']);
  assert.deepEqual(
    [row('w', 'waiting', 5), row('k', 'working', 5), row('r', 'idle', 60_000), row('a', 'active', RECENT_MS * 3), row('i', 'idle', RECENT_MS + 1), row('x', 'idle', 0, { archived: true }), row('xw', 'waiting', 0, { archived: true })].map(r => bucketOf(r, NOW)),
    ['needs', 'working', 'recent', 'recent', 'idle', 'archived', 'archived'],
  );
});

test('each part goes newest first, a tie goes by id, and the parts come back in the panel\'s order', () => {
  const out = bucketsOf([row('b', 'idle', 10), row('c', 'idle', 5), row('a', 'idle', 10), row('z', 'waiting', 1), row('y', 'working', 1)], NOW);
  assert.deepEqual(Object.keys(out), ['needs', 'working', 'recent', 'idle', 'archived']);
  assert.deepEqual(ids(out.recent), ['c', 'a', 'b']);
  assert.deepEqual([ids(out.needs), ids(out.working), ids(out.idle), ids(out.archived)], [['z'], ['y'], [], []]);
});

test('the sessions nested under a member count as members, one after the one they are under', () => {
  const group = { sessions: [row('p', 'idle', 1, { children: [row('c1', 'working', 2), row('c2', 'idle', 3)] }), row('q', 'idle', 4)] };
  assert.deepEqual(ids(membersOf(group)), ['p', 'c1', 'c2', 'q']);
  assert.deepEqual(ids(bucketsOf(membersOf(group), NOW).working), ['c1']);
});

test('the summary counts what needs you, what is working, what is recent and the rest as more, and leaves out a part with nothing in it', () => {
  const rows = [row('a', 'waiting', 1), row('b', 'waiting', 1), row('c', 'working', 1), row('d', 'working', 1), row('e', 'working', 1), row('f', 'idle', 1000), ...Array.from({ length: 11 }, (_, n) => row(`r${n}`, 'idle', 1000 + n)), row('o', 'idle', RECENT_MS * 2), row('p', 'idle', RECENT_MS * 2)];
  const out = bucketsOf(rows, NOW);
  assert.equal(summaryOf(out), '2 need you · 3 working · 12 recent · 2 more');
  assert.equal(summaryOf(out, 140), '2 need you · 3 working · 12 recent · 142 more', 'the archived ones the index counts but does not list are in the more');
  assert.equal(summaryOf(bucketsOf([row('a', 'waiting', 1)], NOW)), '1 needs you');
  assert.equal(summaryOf(bucketsOf([row('a', 'idle', RECENT_MS * 2)], NOW)), '1 more');
  assert.equal(summaryOf(bucketsOf([], NOW)), 'No sessions yet');
  assert.equal(summaryOf(bucketsOf([], NOW), 3), '3 more');
});
