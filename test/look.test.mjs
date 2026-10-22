// Run with `npm test`. The Ghost look's switch in a real page: first public/index.html with the app swapped for the switch alone, where the head sets the root
// attribute and the theme colours from the stored look before the body and a click flips them with the stored look and no reload, then the real app signed in to the real server.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChromium, launch, notFound, serve } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const INDEX = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const APP = '<script type="module" src="app.js"></script>';
const STANDARD = ['#ffffff', '#0a0a0a'];
const GHOST = ['#f6f6f6', '#181818'];

// Read as the head ends, before the body is parsed and before any module can set them.
const BOOTED = `<script>window.booted = { look: document.documentElement.dataset.look ?? null, colours: [...document.querySelectorAll('meta[name="theme-color"]')].map(meta => meta.content) }</script>`;
// The boot list is hidden so the switch sits at the top of the window, where a click reaches it.
const SWITCH = `<style>#boot { display: none }</style>
<script type="module">
import { h, render } from 'preact';
import { LookSwitch } from './ui/look.js';
render(h(LookSwitch), document.getElementById('root'));
</script>`;
const PAGE = INDEX.replace('</head>', () => `${BOOTED}</head>`).replace(APP, () => SWITCH);

const chromium = findChromium();
const skip = chromium ? false : notFound();
// A DevTools call has no deadline of its own, so without one a page that hangs would hold up the whole run.
const timeout = 20_000;
let site;
let app;
let browser;

before(async () => {
  if (skip) return;
  site = await serve({ '/': PAGE, '/storage': '<!doctype html>' });
  app = await start();
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

// A new page with `stored` in capcom.look as it is written to storage, or none for null. Every page shares the browser's storage, so each test sets it first.
async function lookPage(t, stored) {
  const setter = await browser.open(`${site.origin}/storage`);
  await setter.until(`document.readyState === 'complete'`);
  await setter.evaluate(stored === null ? `localStorage.removeItem('capcom.look')` : `localStorage.setItem('capcom.look', ${JSON.stringify(stored)})`);
  await setter.close();
  const page = await browser.open(`${site.origin}/`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && !!document.querySelector('#root .look')`);
  return page;
}

const LOGIN = `!!document.querySelector('#password')`;
// The list the app draws, which has taken the place of the static copy of it in #boot.
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;

// A page on the real server, signed in through its login page with the passkey offer sent away by its Not now button. The browser keeps the cookie and the
// answer to the offer, so only the first page has either to do.
async function appPage(t) {
  const page = await browser.open(`${app.origin}/`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST})`);
  if (!(await page.evaluate(LOGIN))) return page;
  await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
  await page.click('.gate-actions button[type=submit]');
  await page.until(LIST, 10_000);
  // The offer comes a moment after the sign-in lands, and only where passkeys work, so a browser that cannot use them is not offered one.
  if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
    await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
    await page.until(`!document.querySelector('.offer')`);
  }
  return page;
}

const shown = page => page.evaluate(`({
  look: document.documentElement.dataset.look ?? null,
  pressed: document.querySelector('#root .look').getAttribute('aria-pressed'),
  colours: [...document.querySelectorAll('meta[name="theme-color"]')].map(meta => meta.content),
  stored: localStorage.getItem('capcom.look'),
})`);
const booted = page => page.evaluate('window.booted');
const pressed = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')`);
// The width and height the brand mark and the emblem take in the page, which are zero while the standard look hides them.
const sizes = page => page.evaluate(`['.brand-mark', '.emblem'].map(selector => (r => [r.width, r.height])(document.querySelector(selector).getBoundingClientRect()))`);

test('the test page is index.html with a snapshot at the end of its head and the switch where the app script was', () => {
  assert.ok(INDEX.includes(APP) && INDEX.includes('</head>'));
  assert.ok(PAGE.includes(BOOTED) && PAGE.includes(SWITCH) && !PAGE.includes(APP));
});

test('a stored ghost sets the root attribute and both theme colours as the head ends, and the switch comes up pressed', { skip, timeout }, async t => {
  const page = await lookPage(t, '"ghost"');
  assert.deepEqual(await booted(page), { look: 'ghost', colours: GHOST });
  assert.deepEqual(await shown(page), { look: 'ghost', pressed: 'true', colours: GHOST, stored: '"ghost"' });
  assert.deepEqual(page.problems, []);
});

test('with no look stored the root has no attribute, the theme colours are the standard ones and the switch is not pressed', { skip, timeout }, async t => {
  const page = await lookPage(t, null);
  assert.deepEqual(await booted(page), { look: null, colours: STANDARD });
  assert.deepEqual(await shown(page), { look: null, pressed: 'false', colours: STANDARD, stored: null });
  assert.deepEqual(page.problems, []);
});

for (const stored of ['"standard"', '"neon"', '"Ghost"', 'ghost', '{', 'true', 'null']) {
  test(`${stored} stored means the standard look, at boot and once the switch is up`, { skip, timeout }, async t => {
    const page = await lookPage(t, stored);
    assert.deepEqual(await booted(page), { look: null, colours: STANDARD });
    assert.deepEqual(await shown(page), { look: null, pressed: 'false', colours: STANDARD, stored });
    assert.deepEqual(page.problems, []);
  });
}

test('a click turns Ghost on and a second turns it off, each flipping the root attribute, aria-pressed, both theme colours and the stored look with no reload', { skip, timeout }, async t => {
  const page = await lookPage(t, null);
  await page.evaluate('window.sameDocument = true');
  await page.click('#root .look');
  await page.until(`document.documentElement.dataset.look === 'ghost'`);
  assert.deepEqual(await shown(page), { look: 'ghost', pressed: 'true', colours: GHOST, stored: '"ghost"' });
  await page.click('#root .look');
  await page.until(`!document.documentElement.dataset.look`);
  assert.deepEqual(await shown(page), { look: null, pressed: 'false', colours: STANDARD, stored: '"standard"' });
  assert.equal(await page.evaluate('window.sameDocument'), true);
  assert.deepEqual(page.problems, []);
});

test('a click from a stored value that is not ghost turns Ghost on, and the next page boots in it', { skip, timeout }, async t => {
  const page = await lookPage(t, '"neon"');
  await page.click('#root .look');
  await page.until(`document.documentElement.dataset.look === 'ghost'`);
  assert.equal(await page.evaluate(`localStorage.getItem('capcom.look')`), '"ghost"');
  const next = await browser.open(`${site.origin}/`);
  t.after(() => next.close());
  await next.until(`document.readyState === 'complete'`);
  assert.deepEqual(await booted(next), { look: 'ghost', colours: GHOST });
  assert.deepEqual(page.problems, []);
});

test('the boot list holds the brand mark first in the brand and a disabled Ghost button between Passkeys and Sign out', { skip, timeout }, async t => {
  const page = await lookPage(t, null);
  assert.deepEqual(await page.evaluate(`[...document.querySelector('#boot .brand').children].map(el => el.className || el.tagName)`), ['brand-mark', 'H1', 'station']);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#boot .list-foot .btn')].map(el => [el.textContent, !!el.disabled])`), [['Passkeys', false], ['Ghost', true], ['Sign out', false]]);
});

for (const [stored, expected] of [['"ghost"', 'true'], [null, 'false'], ['"neon"', 'false']]) {
  test(`the boot list's Ghost switch reads aria-pressed ${expected} with ${stored === null ? 'no look' : stored} stored`, { skip, timeout }, async t => {
    const page = await lookPage(t, stored);
    assert.equal(await pressed(page, '#boot .look'), expected);
    assert.deepEqual(page.problems, []);
  });
}

test('the real list draws the shell as the brand mark first in the brand and an enabled, unpressed Ghost button between Passkeys and Sign out', { skip, timeout }, async t => {
  const page = await appPage(t);
  assert.deepEqual(await page.evaluate(`[...document.querySelector('.brand').children].map(el => el.getAttribute('class') ?? el.localName)`), ['shell brand-mark', 'h1', 'station']);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.list-foot .btn')].map(el => [el.textContent, !!el.disabled, el.getAttribute('aria-pressed')])`), [['Passkeys', false, null], ['Ghost', false, 'false'], ['Sign out', false, null]]);
  assert.deepEqual(page.problems, []);
});

test('in the real app the brand mark and the emblem take no space in the standard look, take some once Ghost is on, and none again once it is off', { skip, timeout }, async t => {
  const page = await appPage(t);
  assert.deepEqual(await sizes(page), [[0, 0], [0, 0]]);
  await page.click('.list-foot .look');
  await page.until(`document.documentElement.dataset.look === 'ghost'`);
  assert.equal(await pressed(page, '.list-foot .look'), 'true');
  for (const [width, height] of await sizes(page)) assert.ok(width > 0 && height > 0, `a shell drawing is ${width} by ${height}`);
  await page.click('.list-foot .look');
  await page.until(`!document.documentElement.dataset.look`);
  assert.equal(await pressed(page, '.list-foot .look'), 'false');
  assert.deepEqual(await sizes(page), [[0, 0], [0, 0]]);
  assert.deepEqual(page.problems, []);
});
