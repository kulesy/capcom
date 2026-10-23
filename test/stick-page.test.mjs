// Run with `npm test`. A scroll box that follows its end, in a real page with real wheel input: a scroll up from the end stays up
// while the page draws on every scroll event, even as rows stream in or the wheel goes to an iframe, content that grows is followed
// only while the box is at its end, and a wheel over an inner scroll box that can still scroll up is not a scroll up of the outer one.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { findChromium, launch, notFound, serve } from './browser.mjs';

const GAP = `(b => b.scrollHeight - b.scrollTop - b.clientHeight)(document.getElementById('box'))`;
const TOP = `document.getElementById('box').scrollTop`;
const HEIGHT = `document.getElementById('box').scrollHeight`;

// A box of rows with a scroll box of its own at the end, or under #frame a short iframe there instead, drawn again on every scroll
// event as Transcript draws on its away state.
const PAGE = `<!doctype html>
<meta charset="utf-8">
<style>
  body { margin: 0 }
  #box { height: 300px; overflow-y: auto }
  #inner { height: 100px; overflow-y: auto }
  .row { height: 20px }
</style>
<script type="importmap">{ "imports": { "preact": "/vendor/preact.mjs", "preact/hooks": "/vendor/hooks.mjs", "htm": "/vendor/htm.mjs" } }</script>
<div id="root"></div>
<script type="module">
import { h, render } from 'preact';
import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { usePin, useStick } from '/ui/hooks.js';

window.wheels = 0;
const rows = (count, prefix) => Array.from({ length: count }, (_, n) => h('div', { class: 'row', key: prefix + n }, n));

function Page() {
  const box = useRef(null);
  const pin = usePin(box);
  const [count, setCount] = useState(60);
  const [, draw] = useReducer(n => n + 1, 0);
  useStick(box, pin);
  useEffect(() => {
    box.current.addEventListener('scroll', draw, { passive: true });
    return () => box.current.removeEventListener('scroll', draw);
  }, []);
  window.pinned = () => pin.current;
  window.growEvery = ms => setInterval(() => setCount(n => n + 1), ms);
  const framed = location.hash === '#frame';
  return h('div', { id: 'box', ref: box, onWheel: () => window.wheels++ }, rows(count, 'row'),
    framed ? h('iframe', { id: 'frame', srcdoc: '<p>Shorter than its frame</p>', style: 'display: block; position: sticky; bottom: 0; width: 100%; height: 100px; border: 0' })
      : h('div', { id: 'inner' }, rows(20, 'inner')));
}
render(h(Page), document.getElementById('root'));
</script>`;

const chromium = findChromium();
const skip = chromium ? false : notFound();
// A DevTools call has no deadline of its own, so without one a page that hangs would hold up the whole run.
const timeout = 20_000;
let site;
let browser;

before(async () => {
  if (skip) return;
  site = await serve({ '/': PAGE });
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await site?.close();
});

// A new page with the box at its end, where the first draw leaves it.
async function stickPage(t, hash = '') {
  const page = await browser.open(`${site.origin}/${hash}`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && !!document.getElementById('box') && ${GAP} <= 8 && ${TOP} > 0`);
  return page;
}

// Waits until scrollTop has stayed put across three samples, and returns it. Gives up after 3s so a box that keeps moving fails the
// assertions that follow and does not hang.
async function rest(page) {
  let top = await page.evaluate(TOP);
  for (let still = 0, start = Date.now(); still < 3 && Date.now() - start < 3000;) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const now = await page.evaluate(TOP);
    still = now === top ? still + 1 : 0;
    top = now;
  }
  return top;
}

// Turns the wheel `steps` times and returns the box's scrollTop after each one and again once its scrolling has come to rest.
async function wheelSteps(page, selector, steps, deltaY) {
  const tops = [];
  for (let step = 0; step < steps; step++) {
    await page.wheel(selector, deltaY);
    tops.push(await page.evaluate(TOP));
  }
  tops.push(await rest(page));
  return tops;
}

// Samples `read` while a row is added every 20ms, until the box has grown 200px, so a slow machine takes longer and not fewer samples.
async function whileGrowing(page, read) {
  const height = await page.evaluate(HEIGHT);
  await page.evaluate('window.growEvery(20)');
  const seen = [];
  do {
    await new Promise(resolve => setTimeout(resolve, 25));
    seen.push(await page.evaluate(read));
  } while (await page.evaluate(HEIGHT) < height + 200 && seen.length < 200);
  assert.ok(await page.evaluate(HEIGHT) >= height + 200, 'rows were not added');
  return seen;
}

// Asserts the view only went up from sample `lead` on, and ended `far` px below its peak and above the end. While rows stream in, the
// first samples can still be following those that arrived before the first wheel step reached the page.
function movedUp(tops, lead, far, gap) {
  const peak = Math.max(...tops.slice(0, lead + 1));
  assert.ok(peak - tops.at(-1) >= far, `the view moved up ${peak - tops.at(-1)}px, not ${far}px or more: ${tops}`);
  tops.slice(lead).reduce((last, now) => {
    assert.ok(now <= last, `scrollTop went from ${last} up to ${now}: ${tops}`);
    return now;
  });
  assert.ok(gap >= far, `the view ended ${gap}px from the end, not ${far}px or more`);
}

test('small wheel steps up from the end move the view up and never back down, though the page draws on every scroll', { skip, timeout }, async t => {
  const page = await stickPage(t);
  const start = await page.evaluate(TOP);
  const tops = await wheelSteps(page, '#box', 30, -6);
  movedUp([start, ...tops], 0, 120, await page.evaluate(GAP));
  assert.deepEqual(page.problems, []);
});

test('a box at its end stays within 8px of it while rows are added', { skip, timeout }, async t => {
  const page = await stickPage(t);
  const gaps = await whileGrowing(page, GAP);
  assert.ok(gaps.every(gap => gap <= 8), `the gap below the view reached ${Math.max(...gaps)}px: ${gaps}`);
  assert.deepEqual(page.problems, []);
});

test('after a scroll up, rows added below do not pull the view back down', { skip, timeout }, async t => {
  const page = await stickPage(t);
  const held = (await wheelSteps(page, '#box', 30, -6)).at(-1);
  assert.equal(await page.evaluate('window.pinned()'), false);
  const tops = await whileGrowing(page, TOP);
  assert.ok(tops.every(top => Math.abs(top - held) <= 1), `scrollTop was ${held} and moved: ${tops}`);
  assert.deepEqual(page.problems, []);
});

test('scrolling back to the end holds the box there again, so rows added after it are followed', { skip, timeout }, async t => {
  const page = await stickPage(t);
  await wheelSteps(page, '#box', 30, -6);
  assert.equal(await page.evaluate('window.pinned()'), false);
  await page.wheel('#box', 400);
  await page.until(`${GAP} <= 8 && window.pinned()`);
  const gaps = await whileGrowing(page, GAP);
  assert.ok(gaps.every(gap => gap <= 8), `the gap below the view reached ${Math.max(...gaps)}px: ${gaps}`);
  assert.deepEqual(page.problems, []);
});

test('a wheel up over an inner scroll box that is scrolled down scrolls that box and does not let go of the outer one', { skip, timeout }, async t => {
  const page = await stickPage(t);
  await page.evaluate(`document.getElementById('inner').scrollTop = 200`);
  const tops = await wheelSteps(page, '#inner', 5, -6);
  assert.ok(await page.evaluate(`document.getElementById('inner').scrollTop`) < 200, 'the inner box did not take the wheel');
  assert.ok(tops.every(top => top === tops[0]), `the outer box moved: ${tops}`);
  assert.equal(await page.evaluate('window.pinned()'), true);
  const gaps = await whileGrowing(page, GAP);
  assert.ok(gaps.every(gap => gap <= 8), `the gap below the view reached ${Math.max(...gaps)}px: ${gaps}`);
  assert.deepEqual(page.problems, []);
});

test('small wheel steps up while a reply streams in stay up, though a row arrives every 16ms', { skip, timeout }, async t => {
  const page = await stickPage(t);
  await page.evaluate('window.growEvery(16)');
  const tops = await wheelSteps(page, '#box', 30, -6);
  movedUp(tops, 4, 120, await page.evaluate(GAP));
  assert.deepEqual(page.problems, []);
});

test('the same over an iframe too short to scroll, where the box gets no wheel event and only its scroll event can let go', { skip, timeout }, async t => {
  const page = await stickPage(t, '#frame');
  await page.until(`document.getElementById('frame').contentDocument?.body?.textContent`);
  await page.evaluate('window.growEvery(16)');
  const tops = await wheelSteps(page, '#frame', 30, -6);
  assert.equal(await page.evaluate('window.wheels'), 0, 'the wheel reached the box');
  movedUp(tops, 4, 120, await page.evaluate(GAP));
  assert.deepEqual(page.problems, []);
});
