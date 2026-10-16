// Run with `npm test`. Small text helpers the page uses, which need no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { duration, holdCause, holdEnd, preview, tokenCount } from '../public/ui/format.js';

test('a timer reads in seconds, then minutes and seconds, then hours and minutes', () => {
  assert.deepEqual([0, 999, 1000, 59_999, 60_000, 65_000, 3_599_000, 3_600_000, 3_725_000].map(duration), ['0s', '0s', '1s', '59s', '1m 00s', '1m 05s', '59m 59s', '1h 00m', '1h 02m']);
  assert.equal(duration(-5), '0s');
});

test('a token count is exact below a thousand and then rounds to thousands', () => {
  assert.deepEqual([0, 842, 999, 1000, 1234, 9949, 9999, 10_000, 12_345, 123_456].map(tokenCount), ['0', '842', '999', '1k', '1.2k', '9.9k', '10k', '10k', '12k', '123k']);
});

test('a thinking preview is one plain line of the start of the text', () => {
  assert.equal(preview('**Checking the divisors**\n\nUp to `45` only.'), 'Checking the divisors Up to 45 only.');
  assert.equal(preview('## Plan\n- one'), 'Plan - one');
  assert.equal(preview('x'.repeat(300)).length, 160);
});

// The causes and outcomes the CLI's peer_message_hold message lists (checked on CLI 2.1.301).
const CAUSES = ['explicit-setting', 'managed-setting', 'repo-setting', 'invalid-setting', 'bypass-default', 'mode-unknown', 'mode-mismatch', 'no-mode-asserted'];
const OUTCOMES = ['expired', 'refused', 'dropped', 'discarded'];

test('every reason the CLI gives for holding a message, and every way a hold ends, has its own plain sentence', () => {
  const causes = CAUSES.map(holdCause);
  const ends = OUTCOMES.map(holdEnd);
  assert.equal(new Set(causes).size, CAUSES.length, 'no cause falls back to the general sentence');
  assert.equal(new Set(ends).size, OUTCOMES.length);
  for (const text of [...causes, ...ends]) assert.match(text, /^[A-Z][^\u2013\u2014]+\.$/u, 'one sentence with no dash');
});

test('a reason or outcome from a newer CLI, or one a sender made up, falls back to a general sentence and is never shown as sent', () => {
  assert.equal(holdCause('<img src=x>'), 'The CLI is holding it for approval.');
  assert.equal(holdCause(undefined), 'The CLI is holding it for approval.');
  assert.equal(holdEnd('<b>x</b>'), 'The CLI dropped it.');
  assert.equal(holdEnd(''), 'The CLI dropped it.');
});
