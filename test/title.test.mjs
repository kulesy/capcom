// Run with `npm test`. What the window's title reads: an installed app's window shows GhostShell once whatever is open, and a browser tab
// shows the session, the group or the page that is open.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_NAME, INSTALLED, windowTitle } from '../public/ui/title-rules.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));

test('an installed window is titled with the app\'s name alone, so Chrome adds no second copy in front of it', () => {
  for (const title of ['Fix the login · GhostShell', '👻 GhostShell · GhostShell', 'Group session · GhostShell', 'Passkeys · GhostShell', 'GhostShell']) {
    assert.equal(windowTitle(title, true), APP_NAME);
  }
  assert.equal(APP_NAME, manifest.short_name);
  assert.equal(APP_NAME, manifest.name);
});

test('a browser tab keeps the title of what is open', () => {
  assert.equal(windowTitle('Fix the login · GhostShell', false), 'Fix the login · GhostShell');
});

test('the app counts as installed in its own window, with or without its controls drawn over the page', () => {
  assert.match(INSTALLED, /\(display-mode: standalone\)/);
  assert.match(INSTALLED, /\(display-mode: window-controls-overlay\)/);
  assert.doesNotMatch(INSTALLED, /browser/);
});
