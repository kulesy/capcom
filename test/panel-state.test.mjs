// Run with `npm test`. Which tabs a chat's panel can be saved on, and what the buttons that open and close it do to what is saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hidePanel, openQuietly, panelOf, panels, selectTab, takeWant, toggleTab, valid } from '../public/ui/panel-state.js';

const now = id => panelOf(panels.get(), id);

test('a saved panel is kept on the sub sessions, terminal or file tab and on no other', () => {
  const kept = valid({
    a: { open: true, tab: 'subs' }, b: { open: false, tab: 'terminal' }, c: { open: true, tab: 'file' },
    d: { open: true, tab: 'map' }, e: { open: 'yes', tab: 'subs' }, f: null, g: { tab: 'subs' },
  });
  assert.deepEqual(kept, { a: { open: true, tab: 'subs' }, b: { open: false, tab: 'terminal' }, c: { open: true, tab: 'file' } });
  assert.deepEqual(valid(null), {});
  assert.deepEqual(valid('subs'), {});
});

test('a panel that opens by itself saves its tab and leaves the focus alone, and one opened by a button asks for the focus', () => {
  openQuietly('quiet', 'subs');
  assert.deepEqual(now('quiet'), { open: true, tab: 'subs' });
  assert.equal(takeWant('quiet'), null);
  toggleTab('asked', 'subs', null, null);
  assert.deepEqual(now('asked'), { open: true, tab: 'subs' });
  assert.equal(takeWant('asked')?.tab, 'subs');
});

test('the button for a tab opens the panel on it, switches to it from another tab, and closes the panel from it', () => {
  toggleTab('toggled', 'subs', null, null);
  assert.deepEqual(now('toggled'), { open: true, tab: 'subs' });
  toggleTab('toggled', 'terminal', null, 'subs');
  assert.deepEqual(now('toggled'), { open: true, tab: 'terminal' });
  toggleTab('toggled', 'terminal', null, 'terminal');
  assert.deepEqual(now('toggled'), { open: false, tab: 'terminal' });
  toggleTab('toggled', 'subs', null, null);
  assert.deepEqual(now('toggled'), { open: true, tab: 'subs' });
  hidePanel('toggled');
  selectTab('toggled', 'file');
  assert.deepEqual(now('toggled'), { open: false, tab: 'file' });
});
