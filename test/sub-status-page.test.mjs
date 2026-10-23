// Run with `npm test`. The Sub sessions tab in the real page against the real server: the tab and the header button for a chat with sub sessions,
// its lines and what they read from the server, a line opened to its reply, a group's chat, a folded family in the list, and a server that
// cannot summarise sessions. It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { PASSWORD, start } from './harness.mjs';

const WORK = '3b1f6c0e-8a2d-4f57-9c14-d27e50a6b8c1';
//   top
//     kid (asks a question)
//       grand
//   loner
const SESSIONS = [
  { id: 'top', title: 'Top', ago: 5 },
  { id: 'kid', title: 'Kid', parent: 'top', ago: 4, verdict: 'need_input' },
  { id: 'grand', title: 'Grand', parent: 'kid', ago: 3 },
  { id: 'loner', title: 'Loner', ago: 9 },
  { id: 'member', title: 'Member', group: 'cg-work', ago: 6 },
  { id: WORK, title: 'Talk about the work', source: 'cli', ago: 1, group: 'cg-work' },
];
const GROUPS = [{ id: 'cg-work', name: 'Work', session: WORK }];
const REPLY = 'The tests pass. Merging next.\n\n```bash\nnpm run release\n```';

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 30_000;
let app;
let older;
let browser;

// The fake CLI's transcripts are in one folder, and a session that has said something has an assistant line at the end of its file.
const says = (id, text) => fs.appendFileSync(path.join(app.home, '.claude', 'projects', '-test-folder', `${id}.jsonl`),
  `${JSON.stringify({ type: 'assistant', message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'text', text }] } })}\n`);

// The server behind a proxy that leaves out the `subStatus` feature of the list, as a server that started before it existed does.
function withoutSubStatus(target) {
  const proxy = http.createServer((req, res) => {
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
      if (req.url.split('?')[0] !== '/api/sessions') {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
        return;
      }
      const chunks = [];
      reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => {
        const { features, ...index } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const { subStatus, ...left } = features;
        const body = JSON.stringify({ ...index, features: left });
        res.writeHead(reply.statusCode, { ...reply.headers, 'content-length': Buffer.byteLength(body) });
        res.end(body);
      });
    });
    req.pipe(forward);
  });
  return new Promise(resolve => proxy.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${proxy.address().port}`,
    close: () => new Promise(done => { proxy.closeAllConnections(); proxy.close(done); }),
  })));
}

before(async () => {
  if (skip) return;
  app = await start({ sessions: SESSIONS, groups: GROUPS, claude: true });
  says('kid', REPLY);
  older = await withoutSubStatus(app);
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
});

const LOGIN = `!!document.querySelector('#password')`;
const LIST = `!document.querySelector('#boot') && !!document.querySelector('.list-foot')`;
const KEPT = ['panels', 'folded', 'subsMore', 'groupMore', 'groupShut'];

// A page signed in through the login page of the server at `origin`, with the passkey offer sent away. The browser keeps its storage between pages,
// so what a test leaves is cleared first, and `keep` is put in after.
async function appPage(t, hash = '', { origin = app.origin, phone = false, keep = {} } = {}) {
  const setter = await browser.open(`${origin}/healthz`);
  await setter.evaluate(`${JSON.stringify(KEPT)}.forEach(key => localStorage.removeItem('capcom.' + key)); Object.entries(${JSON.stringify(keep)}).forEach(([key, value]) => localStorage.setItem('capcom.' + key, JSON.stringify(value)))`);
  await setter.close();
  const page = await browser.open(`${origin}/${hash}`, { phone });
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (${LOGIN} || ${LIST})`);
  if (await page.evaluate(LOGIN)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(LIST, 10_000);
    if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
      await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
      await page.until(`!document.querySelector('.offer')`);
    }
  }
  if (hash && (await page.evaluate('location.hash')) !== hash) await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  return page;
}

const text = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const all = (page, selector, read) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(el => ${read})`);
// The ids each request for summaries named, in order, with whether it asked for the whole reply.
const asked = page => page.evaluate(`performance.getEntriesByType('resource').filter(e => e.name.includes('api/summaries')).map(e => { const q = new URL(e.name).searchParams; return [q.get('ids'), q.get('detail')]; })`);

test('a chat with sub sessions has the Sub sessions tab, open and first, and a header button that names how many there are', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`!!document.querySelector('#panel .subs')`);
  assert.equal((await all(page, '#panel .panel-tab', 'el.textContent.trim()'))[0], 'Sub sessions');
  assert.equal(await page.evaluate(`document.querySelector('#tab-subs').getAttribute('aria-selected')`), 'true');
  assert.equal(await page.evaluate(`document.querySelector('#tab-subs') === document.querySelector('.panel-tab')`), true, 'it is the first tab');
  assert.equal(await page.evaluate(`document.querySelector('#panel').getAttribute('aria-label').startsWith('Sub sessions')`), true);
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-label')`), 'Sub sessions: 2');
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-expanded')`), 'true');
  assert.equal(await page.evaluate(`!!document.querySelector('#subsButton .subs-mark')`), false, 'nothing waits on you');
  assert.equal(await page.evaluate(`document.activeElement?.closest('#panel') === null`), true, 'opening by itself leaves the focus where it was');
  assert.equal(await text(page, '.subs-sum'), '2 sub sessions');
  assert.deepEqual(page.problems, []);
});

test('a line has its title as a link, when it last moved, the first sentence of its reply and its roll-up, and the page asks for the lines on screen only', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`document.querySelector('.sub .sub-said')?.textContent === 'The tests pass.'`);
  assert.deepEqual(await all(page, '#panel .sub-title', 'el.getAttribute("href") + " " + el.firstChild.textContent'), ['#/s/kid Kid']);
  assert.equal(await text(page, '.sub .sub-roll'), '1 sub session');
  assert.equal(await page.evaluate(`!!document.querySelector('.sub .status-time')?.textContent`), true);
  assert.equal(await page.evaluate(`document.querySelector('.sub .row-dot')?.dataset.dot`), 'awaiting');
  assert.deepEqual(await asked(page), [['kid', null]], 'one request, for the one line drawn');
  assert.deepEqual(page.problems, []);
});

test('a line opens to its whole reply and the sessions under it, and closes again, and a reply from another session has no Run', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`!!document.querySelector('.sub .sub-fold')`);
  assert.equal(await page.evaluate(`document.querySelector('.sub-fold').getAttribute('aria-expanded')`), 'false');
  assert.equal(await page.evaluate(`document.querySelector('.sub-fold').hasAttribute('aria-controls')`), false);
  await page.click('.sub-fold');
  await page.until(`!!document.querySelector('.sub-open .sub-reply')`);
  assert.equal(await page.evaluate(`document.querySelector('.sub-fold').getAttribute('aria-expanded')`), 'true');
  assert.equal(await page.evaluate(`document.getElementById(document.querySelector('.sub-fold').getAttribute('aria-controls')) === document.querySelector('.sub-open')`), true);
  assert.match(await text(page, '.sub-reply'), /^The tests pass\. Merging next\./);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.sub-reply [data-code="run"]')).display`), 'none', 'a block of another session\'s reply cannot be run here');
  assert.equal(await page.evaluate(`!!document.querySelector('.sub-reply [data-code="copy"]')`), true);
  await page.until(`document.querySelectorAll('.sub-open .sub-title').length === 1`);
  assert.equal(await text(page, '.sub-open .sub-title'), 'Grand');
  const requests = await asked(page);
  assert.deepEqual(requests.filter(([, detail]) => detail === '1'), [['kid', '1']], 'the reply is read for the one line that was opened');
  assert.deepEqual(requests.flatMap(([ids]) => ids.split(',')).sort(), ['grand', 'kid', 'kid']);
  await page.click('.sub-fold');
  await page.until(`!document.querySelector('.sub-open')`);
  assert.deepEqual(page.problems, []);
});

test('the header button closes the tab, opens it again, and a chat remembers that it was closed', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top');
  await page.until(`!!document.querySelector('#panel .subs')`);
  await page.click('#subsButton');
  await page.until(`!document.querySelector('#panel')`);
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-expanded')`), 'false');
  await page.evaluate(`location.reload()`);
  await page.until(`document.readyState === 'complete' && !!document.querySelector('#subsButton')`);
  assert.equal(await page.evaluate(`!!document.querySelector('#panel')`), false, 'a panel the owner closed stays closed');
  await page.click('#subsButton');
  await page.until(`!!document.querySelector('#panel #tab-subs[aria-selected="true"]')`);
  assert.equal(await page.evaluate(`document.activeElement?.closest('#panel') !== null`), true, 'a button takes the focus into the panel');
  assert.deepEqual(page.problems, []);
});

test('a chat with no sub sessions has no tab and no button', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/loner');
  await page.until(`!!document.querySelector('.chat-head') && document.querySelector('#title')?.textContent === 'Loner'`);
  assert.equal(await page.evaluate(`document.querySelectorAll('#subsButton, #tab-subs, .subs').length`), 0);
  assert.deepEqual(page.problems, []);
});

test('a phone is shown the tab when the button is pressed and not before', { skip, timeout }, async t => {
  const page = await appPage(t, '#/s/top', { phone: true });
  await page.until(`!!document.querySelector('#subsButton')`);
  assert.equal(await page.evaluate(`!!document.querySelector('#panel')`), false);
  await page.click('#subsButton');
  await page.until(`document.querySelector('#panel')?.getAttribute('role') === 'dialog' && !!document.querySelector('#panel .subs')`);
  assert.deepEqual(page.problems, []);
});

test('a group\'s chat has its sessions in the Sub sessions tab, in place of the status over its transcript, and its button opens it on a phone', { skip, timeout }, async t => {
  const page = await appPage(t, '#/g/cg-work');
  await page.until(`!!document.querySelector('#panel .subs')`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.group-status').length`), 0);
  assert.deepEqual(await all(page, '#panel .panel-tab', 'el.textContent.trim()'), ['Sub sessions'], 'the group has no terminal');
  assert.equal(await page.evaluate(`document.querySelector('#subsButton').getAttribute('aria-label')`), 'Sub sessions: 1');
  assert.deepEqual(await all(page, '#panel .sub-title', 'el.getAttribute("href")'), ['#/s/member']);
  assert.match(await text(page, '.subs-sum'), /^1 recent/);
  const phone = await appPage(t, '#/g/cg-work', { phone: true });
  await phone.until(`!!document.querySelector('#subsButton')`);
  assert.equal(await phone.evaluate(`!!document.querySelector('#panel')`), false);
  await phone.click('#subsButton');
  await phone.until(`!!document.querySelector('#panel .subs')`);
  assert.deepEqual(page.problems, []);
  assert.deepEqual(phone.problems, []);
});

test('a server that cannot summarise sessions keeps the status over a group\'s transcript and gives a chat no tab', { skip, timeout }, async t => {
  const group = await appPage(t, '#/g/cg-work', { origin: older.origin });
  await group.until(`!!document.querySelector('.group-status .status-sum')`);
  assert.equal(await group.evaluate(`document.querySelectorAll('#panel, #subsButton').length`), 0);
  const chat = await appPage(t, '#/s/top', { origin: older.origin });
  await chat.until(`document.querySelector('#title')?.textContent === 'Top'`);
  assert.equal(await chat.evaluate(`document.querySelectorAll('#subsButton, #tab-subs, .subs').length`), 0);
  assert.deepEqual(group.problems, []);
  assert.deepEqual(chat.problems, []);
});

test('a folded family shows the mark of the most urgent session under it, and says so on its arrow, on a server that cannot summarise too', { skip, timeout }, async t => {
  for (const origin of [app.origin, older.origin]) {
    const page = await appPage(t, '', { origin, keep: { folded: { top: true } } });
    await page.until(`!!document.querySelector('#sections a.row[data-id="top"]')`);
    assert.equal(await page.evaluate(`document.querySelector('a.row[data-id="top"] .row-dot')?.dataset.dot`), 'awaiting', origin);
    assert.equal(await page.evaluate(`document.querySelector('#sections li.has-fold .fold').getAttribute('aria-label')`), '2 nested sessions, some need input');
    await page.click('#sections li.has-fold .fold');
    await page.until(`document.querySelector('#sections li.has-fold .fold')?.getAttribute('aria-expanded') === 'true'`);
    assert.equal(await page.evaluate(`document.querySelector('a.row[data-id="top"] .row-dot')?.dataset.dot ?? null`), null, 'open, the head shows its own mark');
    assert.equal(await page.evaluate(`document.querySelector('#sections li.has-fold .fold').getAttribute('aria-label')`), '2 nested sessions');
    assert.deepEqual(page.problems, []);
  }
});
