// Run with `npm test`. Small text helpers the page uses, which need no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { duration, preview, tokenCount } from '../public/ui/format.js';

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
