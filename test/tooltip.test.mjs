// Run with `npm test`. Where a tooltip sits against its trigger, which needs no page: centred above it with the arrow under the
// trigger's centre, slid along the edge of the window, and under the trigger when there is no room above.
import test from 'node:test';
import assert from 'node:assert/strict';
import { place } from '../public/ui/tooltip.js';

const VIEW = { width: 1280, height: 900 };
const SIZE = { width: 80, height: 28 };
const trigger = (left, top, width = 32, height = 32) => ({ left, top, width, height });

test('a tooltip is centred over its trigger and 10px above it, with its arrow under the trigger\'s centre', () => {
  const at = place(trigger(300, 400), SIZE, VIEW);
  assert.deepEqual(at, { side: 'top', x: 276, y: 362, arrow: 35 });
});

test('a tooltip slides along the edge to stay in the window, and its arrow stays under the trigger', () => {
  assert.deepEqual(place(trigger(4, 400), { width: 200, height: 28 }, VIEW), { side: 'top', x: 0, y: 362, arrow: 15 });
  assert.deepEqual(place(trigger(1250, 400, 24, 24), { width: 200, height: 28 }, VIEW), { side: 'top', x: 1080, y: 362, arrow: 177 });
});

test('a tooltip has no arrow when the trigger\'s centre is out of its reach', () => {
  const at = place(trigger(1272, 400, 8, 8), { width: 200, height: 28 }, VIEW);
  assert.equal(at.x, 1080);
  assert.equal(at.arrow, null);
});

test('a tooltip with no room above its trigger goes under it, 10px down', () => {
  const at = place(trigger(300, 10), SIZE, VIEW);
  assert.deepEqual([at.side, at.y], ['bottom', 52]);
});

test('a tooltip with no room on either side takes the roomier one', () => {
  const short = { width: 1280, height: 50 };
  assert.equal(place(trigger(300, 20), SIZE, short).side, 'top');
  assert.equal(place(trigger(300, 5), SIZE, short).side, 'bottom');
});
