// Run with `npm test`. Where a tooltip sits against its trigger, which needs no page: centred above it with the arrow under the
// trigger's centre, slid along the edge of the window, and under the trigger when there is no room above. A wide trigger such as a row
// can ask for the right side instead, which flips to the left, then to above or below, as the room runs out. A tooltip the keyboard
// opened stays through a scroll while its trigger's middle is still inside the window and the box that scrolled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { place, inView } from '../public/ui/tooltip.js';

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

test('a tooltip asked to go right sits 10px past the trigger, centred on its height, with its arrow at the trigger\'s middle', () => {
  const at = place(trigger(0, 400, 380, 26), SIZE, VIEW, 'right');
  assert.deepEqual(at, { side: 'right', x: 390, y: 399, arrow: 9 });
});

test('a tooltip asked to go right goes left of the trigger when only that side has room', () => {
  const at = place(trigger(1000, 400, 260, 26), SIZE, VIEW, 'right');
  assert.deepEqual(at, { side: 'left', x: 910, y: 399, arrow: 9 });
});

test('a tooltip beside its trigger slides down or up to stay in the window, and its arrow stays at the trigger\'s middle', () => {
  assert.deepEqual(place(trigger(0, 880, 380, 26), SIZE, VIEW, 'right'), { side: 'right', x: 390, y: 872, arrow: 16 });
  assert.deepEqual(place(trigger(0, 2, 380, 10), SIZE, VIEW, 'right'), { side: 'right', x: 390, y: 0, arrow: 2 });
});

test('a tooltip beside its trigger has no arrow when the trigger\'s middle is out of its reach', () => {
  const at = place(trigger(0, 1000, 380, 26), SIZE, VIEW, 'right');
  assert.equal(at.y, 872);
  assert.equal(at.arrow, null);
});

test('a tooltip asked to go right with no room on either side goes above the trigger as usual', () => {
  const at = place(trigger(0, 400, 1280, 26), SIZE, VIEW, 'right');
  assert.deepEqual(at, { side: 'top', x: 600, y: 362, arrow: 35 });
  assert.deepEqual(place(trigger(300, 400), SIZE, VIEW, 'top'), place(trigger(300, 400), SIZE, VIEW));
});

test('a trigger is in view while its middle is inside the box, even when part of it has scrolled out', () => {
  const box = { left: 300, top: 100, width: 400, height: 300 };
  assert.equal(inView(trigger(310, 200, 380, 26), box), true);
  assert.equal(inView(trigger(310, 90, 380, 26), box), true);
  assert.equal(inView(trigger(310, 380, 380, 26), box), true);
});

test('a trigger is out of view once its middle passes an edge of the box', () => {
  const box = { left: 300, top: 100, width: 400, height: 300 };
  assert.equal(inView(trigger(310, 80, 380, 26), box), false);
  assert.equal(inView(trigger(310, 390, 380, 26), box), false);
  assert.equal(inView(trigger(100, 200, 100, 26), box), false);
  assert.equal(inView(trigger(710, 200, 100, 26), box), false);
});
