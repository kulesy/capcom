// Run with `npm test`. Capcom's own keys: Ctrl+N anywhere and Cmd+N only in the installed app, Ctrl+K or Cmd+K and Ctrl+B or
// Cmd+B anywhere, Cmd+A on a Mac outside a text field, and the modifier the hints name. The page is a stand-in with just the
// display-mode media feature, set to what Chrome reports, the platform navigator reports, and an event target that says whether it
// is inside a text field.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { archiveHint, inApp, modifier, onAppChange, onMac, shortcut } from '../public/ui/shortcuts.js';

let mode = 'browser';
let platform = 'MacIntel';
// Node 20 has no navigator, and Node 22's cannot be assigned to.
Object.defineProperty(globalThis, 'navigator', { configurable: true, get: () => ({ platform }) });

// Each list the page asks for keeps its own listeners by type, and calls them when it starts or stops matching, as a
// MediaQueryList does.
const lists = [];
globalThis.matchMedia = query => {
  const on = new Map();
  const list = {
    get matches() { return query === `(display-mode: ${mode})`; },
    addEventListener(type, fn) {
      if (!on.has(type)) on.set(type, new Set());
      on.get(type).add(fn);
    },
    removeEventListener: (type, fn) => on.get(type)?.delete(fn),
    fire: () => [...(on.get('change') ?? [])].forEach(fn => fn({ type: 'change', matches: list.matches, media: query })),
    listening: () => [...on.values()].reduce((n, fns) => n + fns.size, 0),
  };
  lists.push(list);
  return list;
};
const moveTo = next => {
  const was = lists.map(l => l.matches);
  mode = next;
  lists.forEach((l, i) => l.matches !== was[i] && l.fire());
};

beforeEach(() => { mode = 'browser'; platform = 'MacIntel'; lists.length = 0; });

const press = (key, held = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...held });
const CTRL = { ctrlKey: true };
const CMD = { metaKey: true };
// A target answers closest() as the page does, with an element when the selector names the kind of element it is in.
const inside = kind => ({ closest: selector => (selector.split(',').map(part => part.trim()).includes(kind) ? {} : null) });
const FIELDS = ['input', 'textarea', 'select', '[contenteditable]'];

test('Ctrl+N starts a session in a tab, in the app and in full screen', () => {
  for (mode of ['browser', 'standalone', 'fullscreen']) {
    assert.equal(shortcut(press('n', CTRL)), 'new', mode);
    assert.equal(shortcut(press('N', CTRL)), 'new', `${mode}, caps lock`);
  }
});

test('Cmd+N starts a session only in the app, so a tab and a full-screen window keep their New Window', () => {
  mode = 'standalone';
  assert.equal(shortcut(press('n', CMD)), 'new');
  assert.equal(shortcut(press('N', CMD)), 'new', 'caps lock');
  for (mode of ['browser', 'fullscreen', 'minimal-ui']) assert.equal(shortcut(press('n', CMD)), null, mode);
});

test('Ctrl+K and Cmd+K open the search in a tab and in the app', () => {
  for (mode of ['browser', 'standalone']) {
    assert.equal(shortcut(press('k', CTRL)), 'find', mode);
    assert.equal(shortcut(press('k', CMD)), 'find', mode);
    assert.equal(shortcut(press('K', { ctrlKey: true, metaKey: true })), 'find', `${mode}, both held`);
  }
});

test('Ctrl+B and Cmd+B show or hide the projects sidebar in a tab, in the app and in full screen', () => {
  for (mode of ['browser', 'standalone', 'fullscreen']) {
    assert.equal(shortcut(press('b', CTRL)), 'projects', mode);
    assert.equal(shortcut(press('b', CMD)), 'projects', mode);
    assert.equal(shortcut(press('B', CMD)), 'projects', `${mode}, caps lock`);
    assert.equal(shortcut(press('b', { ctrlKey: true, metaKey: true })), 'projects', `${mode}, both held`);
    assert.equal(shortcut(press('b')), null, `${mode}, no modifier`);
  }
});

test('Alt, Shift or a composition under way turns Ctrl or Cmd with N, K, B or A into nothing', () => {
  for (mode of ['browser', 'standalone']) {
    for (const key of ['n', 'k', 'b', 'a']) {
      for (const [name, held] of [['Ctrl', CTRL], ['Cmd', CMD]]) {
        for (const extra of ['altKey', 'shiftKey', 'isComposing']) {
          assert.equal(shortcut(press(key, { ...held, [extra]: true })), null, `${mode}, ${name}+${key} with ${extra}`);
        }
      }
    }
  }
});

test('N with both Ctrl and Cmd, N alone or another letter asks for nothing', () => {
  for (mode of ['browser', 'standalone']) {
    assert.equal(shortcut(press('n', { ctrlKey: true, metaKey: true })), null, mode);
    assert.equal(shortcut(press('n')), null, `${mode}, no modifier`);
    assert.equal(shortcut(press('j', CMD)), null, `${mode}, another letter`);
  }
});

test('Cmd+A asks to archive on a Mac in a tab, in the app and in full screen', () => {
  for (mode of ['browser', 'standalone', 'fullscreen']) {
    assert.equal(shortcut(press('a', CMD)), 'archive', mode);
    assert.equal(shortcut(press('A', CMD)), 'archive', `${mode}, caps lock`);
    assert.equal(shortcut(press('a', { ...CMD, target: inside('a.row') })), 'archive', `${mode}, in a list row`);
    assert.equal(shortcut(press('a', { ...CMD, target: {} })), 'archive', `${mode}, a target that cannot say where it is`);
  }
});

test('Cmd+A in a text field asks for nothing, so the field keeps Select All', () => {
  for (mode of ['browser', 'standalone']) {
    for (const kind of FIELDS) {
      assert.equal(shortcut(press('a', { ...CMD, target: inside(kind) })), null, `${mode}, ${kind}`);
      assert.equal(shortcut(press('A', { ...CMD, target: inside(kind) })), null, `${mode}, ${kind}, caps lock`);
    }
  }
});

test('Ctrl+A, Ctrl and Cmd together, A alone and Cmd+A off a Mac ask for nothing', () => {
  for (mode of ['browser', 'standalone']) {
    assert.equal(shortcut(press('a', CTRL)), null, `${mode}, Ctrl+A`);
    assert.equal(shortcut(press('a', { ctrlKey: true, metaKey: true })), null, `${mode}, Ctrl+Cmd+A`);
    assert.equal(shortcut(press('a')), null, `${mode}, no modifier`);
    for (platform of ['Win32', 'Linux x86_64']) assert.equal(shortcut(press('a', CMD)), null, `${mode}, Cmd+A on ${platform}`);
    platform = 'MacIntel';
  }
});

test('a key press with no key, as Chrome autofill sends, asks for nothing', () => {
  mode = 'standalone';
  assert.equal(shortcut(press(undefined, CMD)), null);
});

test('the hints name Cmd in the app on a Mac, and Ctrl in a tab, in full screen or on another system', () => {
  mode = 'standalone';
  assert.equal(inApp(), true);
  assert.equal(modifier(), 'Cmd');
  for (platform of ['Win32', 'Linux x86_64']) assert.equal(modifier(), 'Ctrl', platform);
  platform = 'MacIntel';
  for (mode of ['browser', 'fullscreen']) {
    assert.equal(inApp(), false, mode);
    assert.equal(modifier(), 'Ctrl', mode);
  }
});

test('the archive hint is Cmd A on a Mac in a tab, in the app and in full screen, and is nothing on another system', () => {
  for (mode of ['browser', 'standalone', 'fullscreen']) assert.equal(archiveHint(), 'Cmd A', mode);
  assert.equal(onMac(), true);
  for (platform of ['Win32', 'Linux x86_64']) {
    assert.equal(archiveHint(), null, platform);
    assert.equal(onMac(), false, platform);
  }
});

test('a move between a tab, the app and full screen calls back with the new modifier until it is undone', () => {
  const seen = [];
  const undo = onAppChange(() => seen.push(modifier()));
  moveTo('standalone');
  moveTo('fullscreen');
  moveTo('browser');
  undo();
  moveTo('standalone');
  assert.deepEqual(seen, ['Cmd', 'Ctrl']);
  assert.equal(lists.reduce((n, l) => n + l.listening(), 0), 0);
});
