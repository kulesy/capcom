// Run with `npm test`. Accounts in the real page: the account in a session's header and its row, and the picker beside the permission mode on a new
// session, which shows the home folder's account until it is used. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, cliCalls, start } from './harness.mjs';

const ACCOUNTS = [{ name: 'Default', configDir: '~/.claude' }, { name: 'SSW', configDir: '~/.claude-ssw', folders: ['~/ssw'] }];
const SESSIONS = [{ id: 'plain', title: 'Plain session' }, { id: 'work', title: 'Work session', account: 'SSW' }, { id: 'member', title: 'Member', group: 'cg-work', account: 'SSW' }];
const GROUPS = [{ id: 'cg-work', name: 'Work', session: '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1' }];

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let single;
let missing;
let browser;

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, groups: GROUPS, accounts: ACCOUNTS, claude: true });
  fs.mkdirSync(path.join(app.home, 'ssw'));
  single = await start({ sessions: SESSIONS.slice(0, 1), claude: true });
  missing = await start({ accounts: [ACCOUNTS[0], { ...ACCOUNTS[1], absent: true }], claude: true });
  fs.mkdirSync(path.join(missing.home, 'ssw'));
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const READY = `!document.querySelector('#boot') && (!!document.querySelector('.list-foot') || !!document.querySelector('.chat-head'))`;

// A page signed in through the login page of server `s`, with the passkey offer sent away.
async function appPage(t, s, hash = '') {
  const page = await browser.open(`${s.origin}/${hash}`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${READY})`);
  if (await page.evaluate(LOGIN)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(READY, 10_000);
    if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
      await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
      await page.until(`!document.querySelector('.offer')`);
    }
  }
  if (hash && (await page.evaluate('location.hash')) !== hash) await go(page, hash);
  return page;
}

const go = (page, hash) => page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const fire = (page, selector, value, ...events) => page.evaluate(`(el => {
  el.value = ${JSON.stringify(value)};
  for (const type of ${JSON.stringify(events)}) el.dispatchEvent(new Event(type, { bubbles: true }));
})(document.querySelector(${JSON.stringify(selector)}))`);

test('a session says which account it is on in its header and in the tip of its row', { skip, timeout }, async t => {
  const page = await appPage(t, app, '#/s/work');
  await page.until(`/SSW/.test(document.querySelector('#meta')?.textContent || '')`);
  await go(page, '#/s/plain');
  await page.until(`/Default/.test(document.querySelector('#meta')?.textContent || '')`);
  await go(page, '#/');
  await page.until(`!!document.querySelector('.row[data-id="work"]')`);
  assert.match(await page.evaluate(`document.querySelector('.row[data-id="work"]').dataset.tip`), /\bSSW\b/);
  assert.match(await page.evaluate(`document.querySelector('.row[data-id="plain"]').dataset.tip`), /\bDefault\b/);
  assert.deepEqual(page.problems, []);
});

test('a group\'s chat says which account it is on in its header, beside the kind', { skip, timeout }, async t => {
  const page = await appPage(t, app, '#/g/cg-work');
  await page.until(`/^Group session\\s+SSW/.test(document.querySelector('.chat-head .chat-meta')?.textContent.trim() || '')`);
  assert.deepEqual(page.problems, []);
});

test('a new session offers the accounts beside the permission mode, shows the home folder\'s account until one is picked, then starts on the pick', { skip, timeout }, async t => {
  const page = await appPage(t, app, '#/new');
  await page.until(`!!document.querySelector('#account')`);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#account option')].map(o => o.value)`), ['Default', 'SSW']);
  assert.equal(await page.evaluate(`document.querySelector('#account').value`), 'Default');
  assert.equal(await page.evaluate(`(a => a.closest('.composer-left') !== null && a.closest('.composer-left') === document.querySelector('#mode').closest('.composer-left'))(document.querySelector('#account'))`), true, 'it sits in the prompt box beside the mode');
  assert.equal(await page.evaluate(`document.querySelector('#account').closest('label').firstElementChild.textContent`), 'Account');
  assert.equal(await page.evaluate(`document.querySelector('#account').closest('label').querySelector('[aria-hidden]').textContent`), 'Default');

  await fire(page, '#account', 'SSW', 'change');
  await page.until(`document.querySelector('#account').closest('label').querySelector('[aria-hidden]').textContent === 'SSW'`);

  await page.evaluate(`window.sent = []; const was = window.fetch; window.fetch = (url, options) => { window.sent.push([String(url), options?.body]); return was(url, options); }`);
  await fire(page, '#text', 'begin a saved session', 'input');
  await page.until(`!document.querySelector('#send').disabled`);
  await page.click('#send');
  await page.until(`location.hash === '#/s/begun-by-the-fake'`, 10_000);
  const [, body] = await page.evaluate(`window.sent.find(([url]) => url.endsWith('api/new'))`);
  assert.deepEqual(JSON.parse(body).account, 'SSW');
  assert.equal(JSON.parse(body).cwd, app.home);
  assert.equal(cliCalls(app).find(c => c.started).configDir, path.join(app.home, '.claude-ssw'));
  await page.until(`/SSW/.test(document.querySelector('#meta')?.textContent || '')`);
  assert.equal(await page.evaluate(`document.querySelector('#account')`), null, 'a session that has started cannot change account');
  assert.deepEqual(page.problems, []);
});

test('the defaults for the account last picked are the ones used, however late an earlier answer comes', { skip, timeout }, async t => {
  for (const [dir, model] of [['.claude', 'claude-sonnet-5-5'], ['.claude-ssw', 'claude-haiku-5-5']]) {
    fs.mkdirSync(path.join(app.home, dir), { recursive: true });
    fs.writeFileSync(path.join(app.home, dir, 'settings.json'), JSON.stringify({ model }));
  }
  const page = await appPage(t, app, '#/new');
  await page.until(`!!document.querySelector('#account') && /Sonnet/.test(document.querySelector('#model').getAttribute('aria-label'))`);
  await page.evaluate(`(was => { window.fetch = (url, options) => {
    const slow = String(url).includes('api/defaults') && String(url).includes('account=SSW');
    return slow ? new Promise(resolve => setTimeout(() => resolve(was(url, options)), 1500)) : was(url, options);
  }; })(window.fetch)`);
  await fire(page, '#account', 'SSW', 'change');
  await fire(page, '#account', 'Default', 'change');
  await new Promise(resolve => setTimeout(resolve, 2200));
  assert.equal(await page.evaluate(`document.querySelector('#account').value`), 'Default');
  assert.match(await page.evaluate(`document.querySelector('#model').getAttribute('aria-label')`), /Sonnet/, 'the answer for SSW came last and was dropped');
  assert.deepEqual(page.problems, []);
});

test('the / list of an account never logged in says so on the new session page', { skip, timeout }, async t => {
  const page = await appPage(t, missing, '#/new');
  await page.until(`!!document.querySelector('#account')`);
  await fire(page, '#account', 'SSW', 'change');
  await page.click('#text');
  await fire(page, '#text', '/', 'input');
  await page.until(`/is not logged in yet/.test(document.querySelector('.slash-menu .quiet')?.textContent || '')`);
  assert.deepEqual(cliCalls(missing).filter(c => c.started), []);
});

test('with one account there is no picker', { skip, timeout }, async t => {
  const page = await appPage(t, single, '#/new');
  await page.until(`!!document.querySelector('#mode')`);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await page.evaluate(`document.querySelector('#account')`), null);
  assert.deepEqual(page.problems, []);
});
