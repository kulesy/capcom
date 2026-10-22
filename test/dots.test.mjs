// Run with `npm test`. The mark a row shows at its right, by Claude Desktop's own rules: one test for each line of them, from the first
// line that holds. These check the rules on their own, and row-marks.test.mjs checks where the server gets what they ask about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dotOf, WEEK } from '../lib/dots.mjs';

const NOW = Date.parse('2026-10-22T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const QUIET = { archived: false, routine: null, updatedAt: NOW - HOUR, approval: false, responding: false, elsewhere: false, verdict: null, error: false, errorAt: 0, unread: false, ackedAt: undefined };
const dot = changes => dotOf({ ...QUIET, ...changes }, NOW);

test('a week is seven days, and a row with nothing to report shows no mark', () => {
  assert.equal(WEEK, 7 * DAY);
  assert.equal(dot({}), null);
});

test('an archived row shows no mark, whatever else is true of it', () => {
  const busy = { archived: true, approval: true, responding: true, elsewhere: true, verdict: 'failed', error: true, errorAt: NOW - HOUR, unread: true };
  assert.equal(dot(busy), null);
  for (const key of Object.keys(busy).filter(k => k !== 'archived')) assert.equal(dot({ archived: true, [key]: busy[key] }), null, key);
});

test('a tool approval waiting now is awaiting, ahead of every line but archived', () => {
  assert.equal(dot({ approval: true }), 'awaiting');
  assert.equal(dot({ approval: true, responding: true, verdict: 'failed', error: true, errorAt: NOW - HOUR, unread: true, ackedAt: NOW }), 'awaiting');
});

test('a turn Capcom is running is running, ahead of an error, a verdict, an unread mark and an ack', () => {
  assert.equal(dot({ responding: true }), 'running');
  assert.equal(dot({ responding: true, verdict: 'failed', error: true, errorAt: NOW - HOUR, unread: true, ackedAt: NOW }), 'running');
  assert.equal(dot({ responding: true, verdict: 'need_input', ackedAt: NOW }), 'running');
});

test('a failed verdict is an error', () => {
  assert.equal(dot({ verdict: 'failed' }), 'error');
});

test('a turn error is an error for seven days after it, and not once the week is up', () => {
  assert.equal(dot({ error: true, errorAt: NOW - HOUR }), 'error');
  assert.equal(dot({ error: true, errorAt: NOW - WEEK + 1 }), 'error', 'a moment short of the week');
  assert.equal(dot({ error: true, errorAt: NOW - WEEK }), null, 'the week to the moment');
  assert.equal(dot({ error: true, errorAt: NOW - 8 * DAY }), null);
  assert.equal(dot({ error: true, errorAt: NOW - 8 * DAY, unread: true }), 'ready', 'an old error leaves the unread mark to show');
});

test('an error with no time of its own counts as an old one', () => {
  assert.equal(dot({ error: true, errorAt: 0 }), null);
});

test('an error is not shown while a turn runs somewhere else, which shows as running', () => {
  assert.equal(dot({ verdict: 'failed', elsewhere: true }), 'running');
  assert.equal(dot({ error: true, errorAt: NOW - HOUR, elsewhere: true }), 'running');
});

test('an ack at or after the row\'s last turn hides its error, and one before it does not', () => {
  const failed = { verdict: 'failed', updatedAt: NOW - HOUR };
  assert.equal(dot({ ...failed, ackedAt: NOW - HOUR }), null, 'at');
  assert.equal(dot({ ...failed, ackedAt: NOW }), null, 'after');
  assert.equal(dot({ ...failed, ackedAt: NOW - HOUR - 1 }), 'error', 'a moment before');
  assert.equal(dot({ ...failed, ackedAt: 0 }), 'error', 'an ack at time zero is an ack, and an old one');
});

test('an ack at or after the error\'s own time hides it even when the row has had a turn since', () => {
  const failed = { error: true, errorAt: NOW - 5 * HOUR, updatedAt: NOW - HOUR };
  assert.equal(dot({ ...failed, ackedAt: NOW - 5 * HOUR }), null, 'at');
  assert.equal(dot({ ...failed, ackedAt: NOW - 3 * HOUR }), null, 'after');
  assert.equal(dot({ ...failed, ackedAt: NOW - 6 * HOUR }), 'error', 'before');
});

test('an error with no time is never hidden by an ack older than the row, as in Desktop, where comparing with a missing time is false', () => {
  assert.equal(dot({ verdict: 'failed', errorAt: 0, updatedAt: NOW - HOUR, ackedAt: NOW - 2 * HOUR }), 'error');
});

test('an ack that hides an error leaves the unread mark to show', () => {
  assert.equal(dot({ verdict: 'failed', ackedAt: NOW, unread: true }), 'ready');
  assert.equal(dot({ verdict: 'failed', ackedAt: NOW }), null);
});

test('an error comes before a needs-input verdict and an unread mark', () => {
  assert.equal(dot({ verdict: 'need_input', error: true, errorAt: NOW - HOUR, unread: true }), 'error');
});

test('a row that needs input is awaiting, whether Claude is blocked or needs an answer', () => {
  assert.equal(dot({ verdict: 'blocked' }), 'awaiting');
  assert.equal(dot({ verdict: 'need_input' }), 'awaiting');
  for (const verdict of ['done', 'working', 'failed_to_say', '', null]) assert.equal(dot({ verdict }), null, String(verdict));
});

test('a needs-input verdict lapses when the row is a week old or a routine run, unless the row is unread', () => {
  const asks = { verdict: 'need_input' };
  assert.equal(dot({ ...asks, updatedAt: NOW - WEEK + 1 }), 'awaiting', 'a moment short of a week');
  assert.equal(dot({ ...asks, updatedAt: NOW - WEEK }), null, 'a week to the moment');
  assert.equal(dot({ ...asks, updatedAt: NOW - 30 * DAY }), null);
  assert.equal(dot({ ...asks, updatedAt: NOW - 30 * DAY, unread: true }), 'awaiting', 'unread, so it has not lapsed');
  assert.equal(dot({ ...asks, routine: 'nightly' }), null, 'a recent routine run');
  assert.equal(dot({ ...asks, routine: 'nightly', unread: true }), 'awaiting');
});

test('a needs-input verdict is not shown while a turn runs, which shows as running', () => {
  assert.equal(dot({ verdict: 'need_input', elsewhere: true }), 'running');
  assert.equal(dot({ verdict: 'blocked', responding: true }), 'running');
});

test('an ack at or after the row\'s last turn hides a needs-input verdict and a turn running elsewhere, and leaves the unread mark', () => {
  assert.equal(dot({ verdict: 'need_input', ackedAt: NOW - HOUR }), null);
  assert.equal(dot({ verdict: 'need_input', ackedAt: NOW - HOUR, unread: true }), 'ready');
  assert.equal(dot({ elsewhere: true, ackedAt: NOW }), null);
  assert.equal(dot({ elsewhere: true, ackedAt: NOW, unread: true }), 'ready');
  assert.equal(dot({ verdict: 'need_input', ackedAt: NOW - HOUR - 1 }), 'awaiting', 'an older ack hides nothing');
  assert.equal(dot({ elsewhere: true, ackedAt: NOW - HOUR - 1 }), 'running');
});

test('a turn running in another app is running', () => {
  assert.equal(dot({ elsewhere: true }), 'running');
  assert.equal(dot({ elsewhere: true, unread: true }), 'running', 'ahead of the unread mark');
});

test('an unread row is ready, and a row that is read has no mark', () => {
  assert.equal(dot({ unread: true }), 'ready');
  assert.equal(dot({ unread: false }), null);
});

test('the first line that holds wins when several do', () => {
  const everything = { approval: true, responding: true, elsewhere: true, verdict: 'failed', error: true, errorAt: NOW - HOUR, unread: true };
  const without = (...keys) => Object.fromEntries(Object.entries(everything).filter(([key]) => !keys.includes(key)));
  assert.equal(dot(everything), 'awaiting');
  assert.equal(dot(without('approval')), 'running');
  assert.equal(dot(without('approval', 'responding', 'elsewhere')), 'error');
  assert.equal(dot(without('approval', 'responding', 'verdict', 'error', 'errorAt')), 'running', 'elsewhere, ahead of unread');
  assert.equal(dot(without('approval', 'responding', 'elsewhere', 'verdict', 'error', 'errorAt')), 'ready');
});

test('the time defaults to now', () => {
  const at = Date.now();
  assert.equal(dotOf({ ...QUIET, updatedAt: at - 1000, verdict: 'blocked' }), 'awaiting');
  assert.equal(dotOf({ ...QUIET, updatedAt: at - 8 * DAY, verdict: 'blocked' }), null);
  assert.equal(dotOf({ ...QUIET, error: true, errorAt: at - 1000 }), 'error');
});
