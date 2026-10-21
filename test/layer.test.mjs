// Run with `npm test`. What a menu and a dialog share: the locks they hold on the page while open, the aria-hidden they put on the rest
// of it, the press outside that closes them, Escape for the layer on top, and the Tab key's loop. The page is a stand-in with just the
// parts these read: a body whose style and attributes can be seen, a tree of nodes, and a document that takes listeners.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { counted, isSecondary, tabTarget } from '../public/ui/layer-rules.js';
import { enter, hideOthers, holdPointer, holdScroll, onPressOutside, topmost } from '../public/ui/layer.js';

class Node {
  constructor(tag, ...children) {
    this.tagName = tag;
    this.children = children;
    this.attrs = new Map();
    children.forEach(c => { c.parent = this; });
  }
  contains(other) { return this === other || this.children.some(c => c.contains(other)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
}

let listeners;
let regions = [];
const page = () => {
  const body = new Node('BODY');
  body.style = { pointerEvents: '' };
  return {
    body,
    querySelectorAll: () => regions,
    addEventListener: (type, fn, options) => listeners.push({ type, fn, once: !!options?.once }),
    removeEventListener: (type, fn) => { listeners = listeners.filter(l => l.type !== type || l.fn !== fn); },
  };
};
const fire = (type, event) => {
  for (const l of [...listeners]) {
    if (l.type !== type) continue;
    if (l.once) listeners = listeners.filter(x => x !== l);
    l.fn(event);
  }
};

beforeEach(() => {
  listeners = [];
  regions = [];
  globalThis.document = page();
});

test('a lock is taken by the first layer and let go by the last, and a second let-go does nothing', () => {
  const log = [];
  const hold = counted(() => log.push('on'), () => log.push('off'));
  const a = hold();
  const b = hold();
  a();
  a();
  assert.deepEqual(log, ['on']);
  b();
  assert.deepEqual(log, ['on', 'off']);
  hold()();
  assert.deepEqual(log, ['on', 'off', 'on', 'off']);
});

test('an open layer stops the body taking the pointer and gives back what the body had', () => {
  document.body.style.pointerEvents = 'auto';
  const menu = holdPointer();
  assert.equal(document.body.style.pointerEvents, 'none');
  const dialog = holdPointer();
  menu();
  assert.equal(document.body.style.pointerEvents, 'none', 'the dialog still holds it');
  dialog();
  assert.equal(document.body.style.pointerEvents, 'auto');
});

test('an open dialog locks the page from scrolling until the last one has gone', () => {
  const a = holdScroll();
  const b = holdScroll();
  assert.equal(document.body.getAttribute('data-scroll-locked'), '');
  a();
  assert.equal(document.body.getAttribute('data-scroll-locked'), '');
  b();
  assert.equal(document.body.getAttribute('data-scroll-locked'), null);
});

test('a right click, and a left click with Ctrl held, are the presses that open a context menu', () => {
  assert.equal(isSecondary({ button: 2, ctrlKey: false }), true);
  assert.equal(isSecondary({ button: 0, ctrlKey: true }), true);
  assert.equal(isSecondary({ button: 0, ctrlKey: false }), false);
  assert.equal(isSecondary({ button: 1, ctrlKey: false }), false);
});

test('Tab wraps at either end of a layer, leaves the middle to the browser and stays put with nothing to reach', () => {
  assert.equal(tabTarget(3, 2, false), 0);
  assert.equal(tabTarget(3, 0, true), 2);
  assert.equal(tabTarget(3, 1, false), null);
  assert.equal(tabTarget(3, 1, true), null);
  assert.equal(tabTarget(3, -1, false), 0);
  assert.equal(tabTarget(3, -1, true), 2);
  assert.equal(tabTarget(1, 0, false), 0);
  assert.equal(tabTarget(0, -1, false), 'stay');
});

test('a dialog hides the rest of the page from a screen reader but keeps live regions and the way down to the dialog', () => {
  const dialog = new Node('DIV');
  const toasts = new Node('SECTION');
  const app = new Node('DIV');
  const script = new Node('SCRIPT');
  const root = new Node('DIV', app, dialog, toasts);
  document.body.children.push(root, script);
  root.parent = document.body;
  regions = [toasts];
  const show = hideOthers(dialog);
  assert.equal(app.getAttribute('aria-hidden'), 'true');
  for (const kept of [dialog, toasts, root, script]) assert.equal(kept.getAttribute('aria-hidden'), null);
  show();
  assert.equal(app.getAttribute('aria-hidden'), null);
});

test('what was hidden before a dialog opened stays hidden after it closes, and two dialogs show the page once the last has closed', () => {
  const dialog = new Node('DIV');
  const already = new Node('DIV');
  already.setAttribute('aria-hidden', 'true');
  const app = new Node('DIV');
  const root = new Node('DIV', app, already, dialog);
  document.body.children.push(root);
  root.parent = document.body;
  const first = hideOthers(dialog);
  const other = new Node('DIV');
  root.children.push(other);
  const second = hideOthers(other);
  assert.equal(dialog.getAttribute('aria-hidden'), 'true', 'the dialog under the new one');
  first();
  assert.equal(app.getAttribute('aria-hidden'), 'true', 'the second dialog is still open');
  second();
  assert.equal(app.getAttribute('aria-hidden'), null);
  assert.equal(dialog.getAttribute('aria-hidden'), null);
  assert.equal(already.getAttribute('aria-hidden'), 'true');
});

test('a press outside closes a layer at once for a mouse and on the click for a touch, and a press inside closes nothing', () => {
  const inner = {};
  const outer = {};
  const closed = [];
  const stop = onPressOutside(target => target === inner, e => closed.push(e.id));
  fire('pointerdown', { target: inner, pointerType: 'mouse', id: 'inside' });
  assert.deepEqual(closed, []);
  fire('pointerdown', { target: outer, pointerType: 'mouse', id: 'mouse' });
  assert.deepEqual(closed, ['mouse']);
  fire('pointerdown', { target: outer, pointerType: 'touch', id: 'touch' });
  assert.deepEqual(closed, ['mouse'], 'a touch might be a scroll');
  fire('click', {});
  assert.deepEqual(closed, ['mouse', 'touch']);
  fire('click', {});
  assert.deepEqual(closed, ['mouse', 'touch'], 'one click closes it once');
  fire('pointerdown', { target: outer, pointerType: 'touch', id: 'dragged' });
  fire('pointerdown', { target: inner, pointerType: 'touch', id: 'inside again' });
  fire('click', {});
  assert.deepEqual(closed, ['mouse', 'touch'], 'a touch that went on to land inside takes the wait back');
  stop();
  fire('pointerdown', { target: outer, pointerType: 'mouse', id: 'after' });
  assert.deepEqual(closed, ['mouse', 'touch']);
  assert.equal(listeners.length, 0);
});

test('only the layer opened last answers to Escape, and the one below answers once it has gone', () => {
  const first = {};
  const second = {};
  const leaveFirst = enter(first);
  const leaveSecond = enter(second);
  assert.equal(topmost(second), true);
  assert.equal(topmost(first), false);
  leaveSecond();
  assert.equal(topmost(first), true);
  leaveFirst();
  assert.equal(topmost(first), false);
});
