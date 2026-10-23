// Run with `npm test`. The terminal in the real page against the real server and a fake Mac: Run on a code block, the panel that shows it, a
// command typed after `!` in the prompt box, and a page next to a server that does not say it has a terminal. Commands are harmless echoes.
// It needs Playwright's Chromium headless shell, and every test skips with a reason that names where it looked when there is none.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { findChromium, launch, notFound } from './browser.mjs';
import { as, cliCalls, PASSWORD, request, signIn, start, until } from './harness.mjs';

const ID = 'one';
const REPLY = [
  'Two to try, and one with a hidden character.',
  '```bash\necho from the block\n```',
  '```\necho hid​den\n```',
].join('\n\n');

const chromium = findChromium();
const skip = chromium ? false : notFound();
const timeout = 40_000;
let app;
let older;
let browser;
let token;

// The server behind a proxy that leaves out what its messages answer says of the terminal, as a server that started before there was one does.
function withoutTerminal(target) {
  const proxy = http.createServer((req, res) => {
    const forward = http.request({ host: 'localhost', port: target.port, method: req.method, path: req.url, headers: req.headers }, reply => {
      if (!/^\/api\/sessions\/[^/]+\/messages/.test(req.url)) {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
        return;
      }
      const chunks = [];
      reply.on('data', chunk => chunks.push(chunk));
      reply.on('end', () => {
        const { terminal, ...answer } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const body = JSON.stringify(answer);
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
  app = await start({ sessions: [{ id: ID, title: 'One' }], claude: true });
  const transcript = path.join(app.home, '.claude', 'projects', '-test-folder', `${ID}.jsonl`);
  fs.appendFileSync(transcript, `${JSON.stringify({ type: 'assistant', timestamp: '2026-10-16T01:00:02.000Z', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: REPLY }] } })}\n`);
  ({ token } = await signIn(app));
  older = await withoutTerminal(app);
  browser = await launch(chromium);
});

after(async () => {
  await browser?.close();
  await older?.close();
});

const runs = async () => (await request(app, 'GET', `/api/sessions/${ID}/terminal`, { headers: as(token) })).body().runs;

// A page signed in through the login page of the server at `origin`, on the chat.
async function chatPage(t, origin = app.origin) {
  const page = await browser.open(`${origin}/`);
  t.after(() => page.close());
  await page.until(`document.readyState === 'complete' && (!!document.querySelector('#password') || !!document.querySelector('.list-foot'))`);
  if (await page.evaluate(`!!document.querySelector('#password')`)) {
    await page.evaluate(`document.querySelector('#password').value = ${JSON.stringify(PASSWORD)}`);
    await page.click('.gate-actions button[type=submit]');
    await page.until(`!document.querySelector('#boot') && !!document.querySelector('.list-foot')`, 10_000);
    if (await page.until(`!!document.querySelector('.offer')`, 3000).then(() => true, () => false)) {
      await page.evaluate(`[...document.querySelectorAll('.offer .btn')].find(button => button.textContent === 'Not now').click()`);
      await page.until(`!document.querySelector('.offer')`);
    }
  }
  await page.evaluate(`localStorage.removeItem('capcom.panels'); location.hash = '#/s/${ID}'`);
  await page.until(`document.querySelectorAll('.code-block').length === 2`, 15_000);
  return page;
}

const visible = (selector, within = '') => `[...document.querySelectorAll(${JSON.stringify(`${within} ${selector}`.trim())})].filter(el => el.getClientRects().length).length`;
const tag = (page, n) => page.evaluate(`document.querySelectorAll('[data-code=run]')[${n}].id = 'run-${n}'`);
const type = (page, text) => page.evaluate(`(() => {
  const box = document.getElementById('text');
  box.focus();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)});
  box.dispatchEvent(new Event('input', { bubbles: true }));
})()`);

test('loading the chat starts no command, and its code blocks offer Run only where the text can be seen', { skip, timeout }, async t => {
  const page = await chatPage(t);
  assert.equal(await page.evaluate(visible('[data-code=copy]')), 2);
  assert.equal(await page.evaluate(visible('[data-code=run]')), 2);
  assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('[data-code=run]')].map(b => b.getAttribute('aria-disabled'))`), [null, 'true']);
  assert.match(await page.evaluate(`document.querySelectorAll('[data-code=run]')[1].dataset.tip`), /hidden characters/);
  assert.deepEqual(await runs(), []);
  assert.deepEqual(page.problems, []);
});

test('Run on a block opens the panel, runs that block\'s own text, and the output shows; a block with a hidden character does nothing', { skip, timeout }, async t => {
  const page = await chatPage(t);
  await tag(page, 0);
  await page.click('#run-0');
  await page.until(`!!document.querySelector('#panel .run[data-state=ok]')`, 15_000);
  assert.equal(await page.evaluate(`document.activeElement?.id`), 'term-input');
  assert.match(await page.evaluate(`document.querySelector('#panel .term-out').innerText`), /from the block/);
  const first = await runs();
  assert.deepEqual(first.map(r => [r.command, r.source]), [['echo from the block', 'block']]);
  await tag(page, 1);
  await page.click('#run-1');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal((await runs()).length, 1);
  assert.deepEqual(page.problems, []);
});

test('a command typed after ! in the prompt box runs in the terminal as a ! command, and is never sent to Claude as text', { skip, timeout }, async t => {
  const page = await chatPage(t);
  const before = (await runs()).length;
  await type(page, '!echo from bang');
  await page.until(`document.getElementById('composer').hasAttribute('data-bang')`);
  assert.equal(await page.evaluate(`document.getElementById('send').getAttribute('aria-label')`), 'Run command');
  await page.press('Enter');
  await until(async () => (await runs()).some(r => r.command === 'echo from bang' && !r.running), 15_000);
  const run = (await runs()).find(r => r.command === 'echo from bang');
  assert.equal(run.source, 'bang');
  assert.equal(await page.evaluate(`document.getElementById('text').value`), '');
  await until(() => cliCalls(app).some(call => typeof call.user === 'string' && call.user.includes('<bash-input>echo from bang</bash-input>')), 15_000);
  assert.equal(cliCalls(app).some(call => call.user === '!echo from bang'), false);
  assert.equal((await runs()).length, before + 1);
  assert.deepEqual(page.problems, []);
});

test('a page next to a server that does not say it has a terminal shows no Run, no terminal button and no ! mode, and Copy remains', { skip, timeout }, async t => {
  const page = await chatPage(t, older.origin);
  assert.equal(await page.evaluate(visible('[data-code=copy]')), 2);
  assert.equal(await page.evaluate(visible('[data-code=run]')), 0);
  assert.equal(await page.evaluate(`!!document.getElementById('terminalButton') || !!document.getElementById('panel')`), false);
  await type(page, '!echo not a command');
  assert.equal(await page.evaluate(`document.getElementById('composer').hasAttribute('data-bang') || !!document.getElementById('bang-hint')`), false);
  assert.equal(await page.evaluate(`document.getElementById('send').getAttribute('aria-label')`), 'Send');
  assert.deepEqual(page.problems, []);
});
