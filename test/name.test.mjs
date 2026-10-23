// Run with `npm test`. The name a person reads is GhostShell: on the app page, the sign-in page, the set-up page, the manifest an installed
// app takes its name from, and the heading the list draws. Internal names such as the capcom storage keys are not shown to anyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const [index, login, setup] = ['index.html', 'login.html', 'setup.html'].map(read);
const manifest = JSON.parse(read('manifest.webmanifest'));

const titleOf = html => /<title>([^<]*)<\/title>/.exec(html)?.[1];
const headingOf = html => /<h1>([^<]*)<\/h1>/.exec(html)?.[1];

test('the app page is titled GhostShell, in the tab, on a home screen, in its heading and in its message for an old browser', () => {
  assert.equal(titleOf(index), 'GhostShell');
  assert.match(index, /<meta name="apple-mobile-web-app-title" content="GhostShell">/);
  assert.equal(headingOf(index), 'GhostShell');
  assert.match(index, /<p id="unsupported"[^>]*>GhostShell\b/);
});

test('the sign-in page and the set-up page are titled and headed GhostShell', () => {
  for (const html of [login, setup]) {
    assert.equal(titleOf(html), 'GhostShell');
    assert.equal(headingOf(html), 'GhostShell');
  }
});

test('an installed app is named GhostShell, in full and short', () => {
  assert.equal(manifest.name, 'GhostShell');
  assert.equal(manifest.short_name, 'GhostShell');
});

test('the heading the list draws once the app is running is GhostShell too', () => {
  assert.match(read('ui/sessions-list.js'), /<div class="brand">[^\n]*<h1>GhostShell<\/h1>/);
});

test('no page or manifest still says Capcom to a person', () => {
  for (const text of [index, login, setup, JSON.stringify(manifest)]) assert.doesNotMatch(text, /Capcom/);
});
