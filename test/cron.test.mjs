// Run with `npm test`. Every time here is built from local fields, so the expected values read as clock times.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextFire, nextSlot, parseCron } from '../lib/cron.mjs';

const zone = name => { process.env.TZ = name; };
zone('Australia/Sydney');
const at = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const show = ms => new Date(ms).toLocaleString('en-AU', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fires = (cron, after, jitter, count) => {
  const out = [];
  for (let t = nextFire(cron, after, jitter); out.length < count; t = nextFire(cron, t, jitter)) out.push(t);
  return out;
};

// Every schedule Desktop exported on 15 Oct 2026, with an oracle that says whether a minute matches, written without the parser.
const weekday = d => d.getDay() >= 1 && d.getDay() <= 5;
const SEEDS = [
  ['0 9 * * 1', 813, d => d.getMinutes() === 0 && d.getHours() === 9 && d.getDay() === 1],
  ['0 8 * * *', 140, d => d.getMinutes() === 0 && d.getHours() === 8],
  ['0 11 * * 1', 706, d => d.getMinutes() === 0 && d.getHours() === 11 && d.getDay() === 1],
  ['0 9,17 * * 1-5', 520, d => d.getMinutes() === 0 && (d.getHours() === 9 || d.getHours() === 17) && weekday(d)],
  ['30 7 * * 1-5', 737, d => d.getMinutes() === 30 && d.getHours() === 7 && weekday(d)],
  ['0 7 * * 5', 41, d => d.getMinutes() === 0 && d.getHours() === 7 && d.getDay() === 5],
  ['0 7 * * 1-5', 822, d => d.getMinutes() === 0 && d.getHours() === 7 && weekday(d)],
  ['0 7 * * 1-5', 195, d => d.getMinutes() === 0 && d.getHours() === 7 && weekday(d)],
  ['30 9 * * 1-5', 713, d => d.getMinutes() === 30 && d.getHours() === 9 && weekday(d)],
  ['0 7 * * 1-5', 532, d => d.getMinutes() === 0 && d.getHours() === 7 && weekday(d)],
];

test('every seed schedule parses', () => {
  for (const [cron] of SEEDS) assert.doesNotThrow(() => parseCron(cron), cron);
});

test('the next fire is the cron time plus the jitter, in local time', () => {
  const now = at(2026, 10, 15, 21, 43, 12);
  const expected = [
    [at(2026, 10, 19, 9, 13, 33), 'Monday 09:00 + 813 s'],
    [at(2026, 10, 16, 8, 2, 20), 'daily 08:00 + 140 s'],
    [at(2026, 10, 19, 11, 11, 46), 'Monday 11:00 + 706 s'],
    [at(2026, 10, 16, 9, 8, 40), 'weekdays 09:00 + 520 s'],
    [at(2026, 10, 16, 7, 42, 17), 'weekdays 07:30 + 737 s, the 07:42:17 Desktop gave as its example'],
    [at(2026, 10, 16, 7, 0, 41), 'Friday 07:00 + 41 s'],
    [at(2026, 10, 16, 7, 13, 42), 'weekdays 07:00 + 822 s'],
    [at(2026, 10, 16, 7, 3, 15), 'weekdays 07:00 + 195 s'],
    [at(2026, 10, 16, 9, 41, 53), 'weekdays 09:30 + 713 s'],
    [at(2026, 10, 16, 7, 8, 52), 'weekdays 07:00 + 532 s'],
  ];
  SEEDS.forEach(([cron, jitter], i) => assert.equal(nextFire(cron, now, jitter), expected[i][0], `${cron} +${jitter}: ${expected[i][1]}, got ${show(nextFire(cron, now, jitter))}`));
});

test('each seed schedule fires on every matching minute and on no other, for 30 fires', () => {
  const start = at(2026, 10, 15, 21, 43, 12);
  for (const [cron, jitter, matches] of SEEDS) {
    const offset = jitter * 1000;
    let previous = start;
    for (const fire of fires(cron, start, jitter, 30)) {
      if (fire <= previous) assert.fail(`${cron} did not move forward`);
      if ((fire - offset) % 60_000 !== 0) assert.fail(`${cron} did not fire on a minute plus its jitter`);
      if (!matches(new Date(fire - offset))) assert.fail(`${cron} fired at ${show(fire - offset)}, which the oracle rejects`);
      for (let m = Math.floor((previous - offset) / 60_000) * 60_000 + 60_000; m < fire - offset; m += 60_000) {
        if (matches(new Date(m))) assert.fail(`${cron} skipped ${show(m)}`);
      }
      previous = fire;
    }
  }
});

test('a fire is strictly after the moment it is asked from, even to the second', () => {
  const fire = at(2026, 10, 16, 7, 42, 17);
  assert.equal(nextFire('30 7 * * 1-5', fire - 1, 737), fire);
  assert.equal(nextFire('30 7 * * 1-5', fire, 737), at(2026, 10, 19, 7, 42, 17));
  assert.equal(nextFire('30 7 * * 1-5', fire - 737_000, 0), at(2026, 10, 19, 7, 30));
});

test('the weekend is skipped, and Sunday is 0 or 7', () => {
  assert.equal(nextFire('30 7 * * 1-5', at(2026, 10, 16, 8), 0), at(2026, 10, 19, 7, 30));
  assert.equal(nextFire('0 12 * * 0', at(2026, 10, 15), 0), at(2026, 10, 18, 12));
  assert.equal(nextFire('0 12 * * 7', at(2026, 10, 15), 0), at(2026, 10, 18, 12));
  assert.equal(nextFire('0 12 * * 5-7', at(2026, 10, 17, 13), 0), at(2026, 10, 18, 12));
  assert.deepEqual([...parseCron('0 0 * * 5-7').dow].sort(), [0, 5, 6]);
});

test('lists, ranges and steps', () => {
  assert.deepEqual([...parseCron('*/15 * * * *').minute], [0, 15, 30, 45]);
  assert.deepEqual([...parseCron('5,10-12,50/5 * * * *').minute].sort((a, b) => a - b), [5, 10, 11, 12, 50, 55]);
  assert.deepEqual([...parseCron('0 1-10/3 * * *').hour], [1, 4, 7, 10]);
  assert.deepEqual([...parseCron('0 0 1,15 * *').dom], [1, 15]);
  assert.deepEqual([...parseCron('0 0 1 */4 *').month], [1, 5, 9]);
  assert.equal(parseCron('0 0 * * *').minute.size, 1);
  assert.equal(nextFire('*/15 * * * *', at(2026, 10, 15, 21, 43, 12), 0), at(2026, 10, 15, 21, 45));
  assert.equal(nextFire('0 0 1,15 * *', at(2026, 10, 15, 0, 0, 1), 0), at(2026, 11, 1));
  assert.equal(nextFire('0 0 1 */4 *', at(2026, 10, 15), 0), at(2027, 1, 1));
});

test('both day fields restricted means either one matches; one star means the other decides', () => {
  const either = '0 9 13 * 5';
  assert.equal(nextFire(either, at(2026, 10, 15), 0), at(2026, 10, 16, 9));
  assert.equal(nextFire(either, at(2026, 10, 16, 10), 0), at(2026, 10, 23, 9));
  assert.equal(nextFire('0 9 13 * *', at(2026, 10, 15), 0), at(2026, 11, 13, 9));
  assert.equal(nextFire('0 9 * * 5', at(2026, 10, 15), 0), at(2026, 10, 16, 9));
});

test('month ends, leap days and a schedule that never comes', () => {
  assert.equal(nextFire('0 0 31 * *', at(2026, 11, 1), 0), at(2026, 12, 31));
  assert.equal(nextFire('0 0 29 2 *', at(2026, 10, 15), 0), at(2028, 2, 29));
  assert.equal(nextFire('0 0 31 2 *', at(2026, 10, 15), 0), null);
  assert.equal(nextFire('59 23 31 12 *', at(2026, 12, 31, 23, 59), 0), at(2027, 12, 31, 23, 59));
});

test('a schedule the parser cannot read is refused with the reason', () => {
  const bad = [
    ['', /five fields/], ['* * * *', /five fields/], ['* * * * * *', /five fields/], ['@daily', /five fields/],
    ['60 * * * *', /outside 0 to 59 in the minute/], ['* 24 * * *', /outside 0 to 23 in the hour/], ['* * 0 * *', /outside 1 to 31/],
    ['* * 32 * *', /outside 1 to 31/], ['* * * 13 *', /outside 1 to 12/], ['* * * * 8', /outside 0 to 7/], ['5-1 * * * *', /outside/],
    ['*/0 * * * *', /step/], ['1- * * * *', /Cannot read/], ['a * * * *', /Cannot read/], ['mon * * * *', /Cannot read/], ['1,,2 * * * *', /Cannot read/],
    ['* * * jan *', /Cannot read/], ['? * * * *', /Cannot read/],
  ];
  for (const [cron, why] of bad) assert.throws(() => parseCron(cron), why, JSON.stringify(cron));
  assert.throws(() => parseCron(undefined), /five fields/);
  assert.throws(() => nextFire('nonsense', 0), /five fields/);
});

test('extra spaces and zero-padded numbers are fine', () => {
  assert.equal(nextFire('  05   07  * *  1-5 ', at(2026, 10, 15, 21), 0), at(2026, 10, 16, 7, 5));
});

test('the weekday run does not move when the clocks do', () => {
  zone('Australia/Sydney');
  assert.equal(nextFire('0 9 * * *', at(2027, 4, 3, 9, 0, 30), 0), at(2027, 4, 4, 9));
  assert.equal(at(2027, 4, 4, 9) - at(2027, 4, 3, 9), 25 * 3600_000, 'the clocks went back, so that day is 25 hours long');
  assert.equal(nextFire('0 9 * * *', at(2026, 10, 3, 9, 0, 30), 0), at(2026, 10, 4, 9));
  assert.equal(at(2026, 10, 4, 9) - at(2026, 10, 3, 9), 23 * 3600_000, 'the clocks went forward, so that day is 23 hours long');
});

test('an hour that repeats fires once, the first time', () => {
  zone('Australia/Sydney');
  const first = at(2027, 4, 4, 2, 30);
  const second = first + 3600_000;
  assert.equal(new Date(second).getHours(), 2);
  assert.equal(new Date(second).getMinutes(), 30);
  assert.equal(nextFire('30 2 * * *', at(2027, 4, 3, 12), 0), first);
  assert.equal(nextFire('30 2 * * *', first, 0), at(2027, 4, 5, 2, 30), 'not the second 02:30');
  assert.equal(nextFire('30 2 * * *', second - 60_000, 0), at(2027, 4, 5, 2, 30), 'asked from inside the second pass');
  assert.ok(nextFire('30 2 * * *', second, 0) > second, 'asked from the second 02:30 itself');
  assert.equal(nextFire('*/30 * * * *', first, 0), at(2027, 4, 4, 3), 'a wildcard hour skips the repeat too');
});

test('a time that does not exist is skipped for that day', () => {
  zone('Australia/Sydney');
  assert.equal(nextFire('30 2 * * *', at(2026, 10, 3, 12), 0), at(2026, 10, 5, 2, 30), '4 Oct 2026 jumped from 02:00 to 03:00');
  assert.equal(nextFire('0 3 * * *', at(2026, 10, 3, 12), 0), at(2026, 10, 4, 3));
});

test('the same holds in a zone with the repeat in the other hour, and in one with no clock changes', () => {
  zone('America/New_York');
  const first = at(2026, 11, 1, 1, 30);
  assert.equal(nextFire('30 1 * * *', at(2026, 10, 31, 12), 0), first);
  assert.equal(nextFire('30 1 * * *', first, 0), at(2026, 11, 2, 1, 30));
  assert.equal(nextFire('30 2 * * *', at(2027, 3, 13, 12), 0), at(2027, 3, 15, 2, 30), '14 Mar 2027 jumped from 02:00 to 03:00');
  zone('Australia/Brisbane');
  assert.equal(nextFire('30 7 * * 1-5', at(2026, 10, 15, 21, 43, 12), 737), at(2026, 10, 16, 7, 42, 17));
  assert.equal(new Date(at(2027, 4, 4, 9)).getTimezoneOffset(), -600);
  zone('UTC');
  assert.equal(nextFire('0 9,17 * * 1-5', Date.UTC(2026, 9, 16, 9, 0, 1), 520), Date.UTC(2026, 9, 16, 9, 8, 40), 'the 09:00 fire is still ahead until its jitter has passed');
  assert.equal(nextFire('0 9,17 * * 1-5', Date.UTC(2026, 9, 16, 9, 8, 40), 520), Date.UTC(2026, 9, 16, 17, 8, 40));
  zone('Australia/Sydney');
});

test('nextSlot is the jitter-free search', () => {
  assert.equal(nextSlot(parseCron('30 7 * * 1-5'), at(2026, 10, 15, 21)), at(2026, 10, 16, 7, 30));
  assert.equal(nextSlot(parseCron('0 0 31 2 *'), at(2026, 10, 15)), null);
});
