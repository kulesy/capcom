// Run with `npm test`. Lifting a row of the list: a finger that holds still after the long press asks for the row's menu and leaves the
// list where it is, and one that moves drags the row. The page is a small stand-in with just what drag.js touches.
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const HOLD_MS = 350;
const EDGE = 56;

// A target for events, which also forgets a listener whose signal aborts, as the page does.
const target = () => {
  const on = new Map();
  return {
    addEventListener(type, fn, options) {
      if (!on.has(type)) on.set(type, new Set());
      on.get(type).add(fn);
      options?.signal?.addEventListener('abort', () => on.get(type).delete(fn));
    },
    removeEventListener: (type, fn) => on.get(type)?.delete(fn),
    fire: (type, event) => [...(on.get(type) ?? [])].forEach(fn => fn({ type, preventDefault() {}, stopPropagation() {}, ...event })),
  };
};

// A list 600 pixels tall with one row near its bottom edge, scrolled down by 100, and the callbacks drag.js reports to.
async function mount() {
  mock.timers.enable({ apis: ['setTimeout'] });
  const frames = [];
  globalThis.requestAnimationFrame = fn => frames.push(fn);
  globalThis.cancelAnimationFrame = () => frames.length = 0;
  const drop = { over: null };
  globalThis.document = Object.assign(target(), {
    body: { append() {}, classList: { add() {}, remove() {} } },
    elementFromPoint: () => drop.over && { closest: () => ({ dataset: { drop: drop.over } }) },
  });
  globalThis.window = target();
  const copy = { classList: { add() {} }, removeAttribute() {}, setAttribute() {}, style: {}, remove() {} };
  const row = { dataset: { id: 'r1' }, getBoundingClientRect: () => ({ left: 0, top: 570, width: 300 }), cloneNode: () => copy };
  const box = Object.assign(target(), { scrollTop: 100, getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 600 }) });
  const log = [];
  const { dragRows } = await import('../public/ui/drag.js');
  const stop = dragRows(box, {
    onStart: id => log.push(['start', id]),
    onOver: over => log.push(['over', over]),
    onEnd: (id, section) => log.push(['end', id, section]),
    onMenu: (id, element, point) => log.push(['menu', id, element === row, point]),
  });
  const at = (clientX, clientY) => ({ isPrimary: true, clientX, clientY });
  return {
    box, log, drop, stop,
    down: (kind, x, y) => box.fire('pointerdown', { ...at(x, y), button: 0, ctrlKey: false, pointerType: kind, target: { closest: () => row } }),
    move: (x, y) => document.fire('pointermove', at(x, y)),
    up: (x, y) => document.fire('pointerup', at(x, y)),
    frame: () => frames.splice(0).forEach(fn => fn()),
  };
}

afterEach(() => mock.timers.reset());

test('a finger held still near the edge of the list leaves the list where it is, and letting go asks for the row menu', async () => {
  const t = await mount();
  t.down('touch', 100, 600 - EDGE / 2);
  mock.timers.tick(HOLD_MS);
  for (let i = 0; i < 5; i++) t.frame();
  assert.equal(t.box.scrollTop, 100);
  t.up(100, 600 - EDGE / 2);
  assert.deepEqual(t.log, [['start', 'r1'], ['end', 'r1', null], ['menu', 'r1', true, null]]);
  t.stop();
});

test('a finger that drifts a little while held still is still held still', async () => {
  const t = await mount();
  t.down('touch', 100, 590);
  mock.timers.tick(HOLD_MS);
  t.move(104, 593);
  t.frame();
  assert.equal(t.box.scrollTop, 100);
  t.up(104, 593);
  assert.deepEqual(t.log.map(([name]) => name), ['start', 'end', 'menu']);
  t.stop();
});

test('a finger that leaves the circle it was held in and comes back drags the row, and does not ask for the menu', async () => {
  const t = await mount();
  t.down('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.move(100, 340);
  t.move(100, 300);
  t.up(100, 300);
  assert.deepEqual(t.log.map(([name]) => name), ['start', 'end']);
  assert.deepEqual(t.log.at(-1), ['end', 'r1', null]);
  t.stop();
});

test('a finger that has moved and lets go over a section drops the row there, with no menu', async () => {
  const t = await mount();
  t.down('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.drop.over = 'pinned';
  t.move(100, 200);
  t.up(100, 200);
  assert.deepEqual(t.log.filter(([name]) => name !== 'over'), [['start', 'r1'], ['end', 'r1', 'pinned']]);
  t.stop();
});

test('a finger that has moved to the edge of the list scrolls it', async () => {
  const t = await mount();
  t.down('touch', 100, 300);
  mock.timers.tick(HOLD_MS);
  t.move(100, 590);
  t.frame();
  assert.ok(t.box.scrollTop > 100, String(t.box.scrollTop));
  t.up(100, 590);
  t.stop();
});

test('a mouse that has lifted the row scrolls the list at the edge at once', async () => {
  const t = await mount();
  t.down('mouse', 100, 590);
  t.move(110, 590);
  t.frame();
  assert.ok(t.box.scrollTop > 100, String(t.box.scrollTop));
  t.up(110, 590);
  assert.deepEqual(t.log.filter(([name]) => name === 'menu'), []);
  t.stop();
});
