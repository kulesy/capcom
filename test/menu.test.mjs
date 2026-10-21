// Run with `npm test`. The rules of the popup menus that need no page: where a menu sits next to its button or at a point, when it
// flips or slides to stay in view, which item an arrow key or a typed letter lands on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { graceArea, inside, nextMatch, place, stepIn } from '../public/ui/menu-rules.js';

const VIEW = { width: 1280, height: 900 };
const SIZE = { width: 180, height: 100 };
const button = (x, y) => ({ x, y, width: 32, height: 32 });
const point = (x, y) => ({ x, y, width: 0, height: 0 });
const dropdown = (anchor, extra = {}) => place({ anchor, size: SIZE, view: VIEW, side: 'bottom', align: 'end', offset: 4, pad: 8, ...extra });
const context = (anchor, extra = {}) => place({ anchor, size: SIZE, view: VIEW, side: 'right', align: 'start', offset: 2, pad: 8, ...extra });

test('a menu hangs under its button with its right edge on the button, 4px down', () => {
  const at = dropdown(button(300, 10));
  assert.deepEqual([at.x, at.y, at.side, at.align], [152, 46, 'bottom', 'end']);
  assert.equal(at.origin, '100% 0px');
});

test('a menu with no room under its button opens above it, and grows from the bottom edge', () => {
  const at = dropdown(button(300, 860));
  assert.deepEqual([at.x, at.y, at.side, at.align], [152, 756, 'top', 'end']);
  assert.equal(at.origin, '100% 100px');
});

test('a menu slides along the button until it is in view, and keeps its side', () => {
  const at = dropdown({ x: 1250, y: 10, width: 20, height: 20 }, { align: 'start' });
  assert.deepEqual([at.x, at.y, at.side, at.align], [1092, 34, 'bottom', 'start']);
});

test('a menu keeps 8px from the edge of the view, and none when asked for none', () => {
  const left = { x: 0, y: 10, width: 30, height: 30 };
  assert.equal(dropdown(left).x, 8);
  assert.equal(dropdown(left, { pad: 0 }).x, 0);
});

test('a menu with a centred alignment tries only the other side before it gives in', () => {
  const near = place({ anchor: button(600, 880), size: SIZE, view: VIEW, side: 'bottom', align: 'center', offset: 4, pad: 8 });
  assert.deepEqual([near.side, near.align, near.y], ['top', 'center', 776]);
  assert.equal(near.origin, '50% 100px');
});

test('a menu opened at a point starts 2px right of it, level with it', () => {
  const at = context(point(100, 200));
  assert.deepEqual([at.x, at.y, at.side, at.align], [102, 200, 'right', 'start']);
  assert.equal(at.origin, '0px 0%');
});

test('a menu opened at a point near the right edge opens to its left, and grows from its right edge', () => {
  const at = context(point(1200, 200));
  assert.deepEqual([at.x, at.y, at.side, at.align], [1018, 200, 'left', 'start']);
  assert.equal(at.origin, '180px 0%');
});

test('a menu opened at a point near the bottom slides up and stays in touch with the point', () => {
  assert.equal(context(point(100, 850)).y, 792);
  assert.equal(context(point(100, 899)).y, 792);
});

test('a menu that fits on neither side goes where it sticks out least, then is pulled into view', () => {
  const phone = { width: 390, height: 844 };
  const sub = place({ anchor: { x: 147, y: 300, width: 180, height: 32 }, size: { width: 190, height: 200 }, view: phone, side: 'right', align: 'start', pad: 8 });
  assert.deepEqual([sub.x, sub.y, sub.side], [8, 300, 'left']);
});

test('a menu taller than the room is given the room, and is placed again at that height', () => {
  const short = place({ anchor: { x: 100, y: 100, width: 30, height: 30 }, size: { width: 150, height: 500 }, view: { width: 400, height: 300 }, side: 'bottom', align: 'end', offset: 4, pad: 8 });
  assert.deepEqual([short.side, short.y, short.room], ['bottom', 134, 158]);
});

test('a menu that fits is given the whole height between its edge and the far edge of the view', () => {
  assert.equal(dropdown(button(300, 10)).room, 846);
  assert.equal(context(point(100, 200)).room, 884);
});

test('positions are rounded to a device pixel', () => {
  const anchor = { x: 300.3, y: 10.3, width: 32, height: 32 };
  assert.equal(dropdown(anchor).x, 152);
  assert.equal(dropdown(anchor, { dpr: 2 }).x, 152.5);
  assert.equal(dropdown(anchor, { dpr: 2 }).y, 46.5);
});

test('a view that does not start at the corner moves the room with it', () => {
  const zoomed = { x: 100, y: 50, width: 400, height: 300 };
  const at = place({ anchor: { x: 110, y: 60, width: 20, height: 20 }, size: { width: 150, height: 100 }, view: zoomed, side: 'bottom', align: 'start', offset: 4, pad: 8 });
  assert.deepEqual([at.x, at.y], [110, 84]);
  const left = place({ anchor: { x: 100, y: 60, width: 20, height: 20 }, size: { width: 150, height: 100 }, view: zoomed, side: 'bottom', align: 'end', offset: 4, pad: 8 });
  assert.equal(left.x, 108);
});

test('down and up step through the items and loop at either end', () => {
  assert.equal(stepIn(3, 0, 'ArrowDown'), 1);
  assert.equal(stepIn(3, 2, 'ArrowDown'), 0);
  assert.equal(stepIn(3, 1, 'ArrowUp'), 0);
  assert.equal(stepIn(3, 0, 'ArrowUp'), 2);
});

test('Home and Page Up go to the first item, End and Page Down to the last', () => {
  for (const key of ['Home', 'PageUp']) assert.equal(stepIn(4, 2, key), 0, key);
  for (const key of ['End', 'PageDown']) assert.equal(stepIn(4, 1, key), 3, key);
});

test('with no item focused, down lands on the first and up on the last', () => {
  assert.equal(stepIn(4, -1, 'ArrowDown'), 0);
  assert.equal(stepIn(4, -1, 'ArrowUp'), 3);
});

test('a key that is not a step, or a menu with no enabled item, goes nowhere', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'a', 'Tab']) assert.equal(stepIn(4, 1, key), -1, key);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.equal(stepIn(0, -1, key), -1, key);
});

const LABELS = ['Rename', 'Move to', 'Archive'];

test('a letter finds the first item that starts with it, whatever the case', () => {
  assert.equal(nextMatch(LABELS, 'a', -1), 2);
  assert.equal(nextMatch(LABELS, 'M', -1), 1);
  assert.equal(nextMatch(LABELS, 'x', -1), -1);
});

test('a letter looks on from the focused item and wraps round, and never finds the item it is on', () => {
  assert.equal(nextMatch(['Alpha', 'Beta', 'Apple'], 'a', 2), 0);
  assert.equal(nextMatch(['Alpha', 'Beta', 'Apple'], 'a', 0), 2);
  assert.equal(nextMatch(LABELS, 'r', 0), -1);
});

test('several letters find an item by its start, and stay on the focused item when it matches', () => {
  assert.equal(nextMatch(LABELS, 'mo', 0), 1);
  assert.equal(nextMatch(LABELS, 'mo', 1), -1);
  assert.equal(nextMatch(LABELS, 'ar', 0), 2);
});

test('one letter typed again and again counts as that letter, so it steps through the items that start with it', () => {
  const labels = ['Move to', 'Merge', 'Archive', 'Mute'];
  assert.equal(nextMatch(labels, 'mm', 0), 1);
  assert.equal(nextMatch(labels, 'mmm', 1), 3);
  assert.equal(nextMatch(labels, 'mmm', 3), 0);
});

test('an empty search or no items finds nothing', () => {
  assert.equal(nextMatch(LABELS, '', 0), -1);
  assert.equal(nextMatch([], 'a', -1), -1);
});

const SUB = { left: 105, right: 285, top: 40, bottom: 240 };

test('the grace area runs from the trigger to the sub-menu, so a pointer cutting the corner stays inside it', () => {
  const area = graceArea({ x: 100, y: 50 }, SUB, 'right');
  assert.deepEqual(area[0], { x: 95, y: 50 });
  for (const point of [{ x: 110, y: 60 }, { x: 200, y: 150 }, { x: 280, y: 235 }]) assert.equal(inside(point, area), true, JSON.stringify(point));
});

test('a pointer that goes back, or down past the sub-menu, is outside the grace area', () => {
  const area = graceArea({ x: 100, y: 50 }, SUB, 'right');
  for (const point of [{ x: 60, y: 120 }, { x: 100, y: 260 }, { x: 300, y: 100 }, { x: 150, y: 20 }]) assert.equal(inside(point, area), false, JSON.stringify(point));
});

test('a sub-menu on the left has the same area mirrored, with the bleed on the other side of the exit point', () => {
  const area = graceArea({ x: 300, y: 50 }, { left: 20, right: 195, top: 40, bottom: 240 }, 'left');
  assert.deepEqual(area[0], { x: 305, y: 50 });
  assert.deepEqual(area.slice(1, 3), [{ x: 195, y: 40 }, { x: 20, y: 40 }]);
  assert.equal(inside({ x: 150, y: 100 }, area), true);
  assert.equal(inside({ x: 320, y: 100 }, area), false);
});
