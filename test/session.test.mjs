// Run with `npm test`. A chat's controller is plain functions on plain data, so it runs here against a fake page,
// event stream and server, with no browser.
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
globalThis.fetch = async url => {
  const body = String(url).endsWith('/chips') ? { chips: [] } : { items: [], start: 0, end: 0, hasEarlier: false };
  return { status: 200, ok: true, json: async () => body };
};
// The page reads the document as the module loads, so the fake has to be in place first.
const { createChat } = await import('../public/ui/session.js');

async function openChat(id) {
  const chat = createChat({ id, refreshIndex() {} });
  await chat.open();
  return { chat, stream: streams.at(-1) };
}
const undelivered = id => ({ id, from: 'Worker', state: 'dropped', outcome: 'expired' });
const cards = chat => chat.store.get().holdsEnded.map(d => d.id);

test('the grey cards of a chat are still there when the owner opens another chat and comes back', async () => {
  const one = await openChat('chat-switch');
  one.stream.emit('hold-ended', undelivered('a'));
  one.stream.emit('hold-ended', { id: 'r', from: 'Worker', state: 'released', outcome: '' });
  one.stream.emit('hold-ended', undelivered('b'));
  one.chat.close();
  const other = await openChat('chat-elsewhere');
  assert.deepEqual(cards(other.chat), [], 'another chat has none of them');
  other.chat.close();
  assert.deepEqual(cards(createChat({ id: 'chat-switch', refreshIndex() {} })), ['a', 'b'], 'there as the pane is built, and a released hold left none');
});

test('a card goes when the owner dismisses it, and stays gone the next time the chat is opened', async () => {
  const one = await openChat('chat-dismiss');
  for (const id of ['a', 'b', 'c']) one.stream.emit('hold-ended', undelivered(id));
  one.chat.dismissHold(['a', 'b']);
  assert.deepEqual(cards(one.chat), ['c']);
  one.chat.close();
  assert.deepEqual(cards(createChat({ id: 'chat-dismiss', refreshIndex() {} })), ['c']);
});

test('a chat keeps its 100 newest undelivered messages and drops the oldest first', async () => {
  const one = await openChat('chat-many');
  for (let n = 0; n < 105; n++) one.stream.emit('hold-ended', undelivered(`m${n}`));
  one.chat.close();
  const kept = cards(createChat({ id: 'chat-many', refreshIndex() {} }));
  assert.equal(kept.length, 100);
  assert.deepEqual([kept[0], kept.at(-1)], ['m5', 'm104']);
});

// A fake server for one test: the chat opens on `starts[0]`, each Load earlier moves to the next start, and `pictures` answers the list of pictures.
async function withServer({ starts, pictures }, run) {
  const real = globalThis.fetch;
  const asked = [];
  let moved = 0;
  const reply = body => ({ status: 200, ok: true, json: async () => body });
  globalThis.fetch = async url => {
    const address = String(url);
    if (address.includes('/images?')) { asked.push(address); return pictures(address); }
    if (address.endsWith('/chips')) return reply({ chips: [] });
    const start = starts[address.includes('/messages?before=') ? ++moved : 0];
    return reply({ items: [], start, end: 900, hasEarlier: start > 0 });
  };
  try { await run(asked); } finally { globalThis.fetch = real; }
}
const failure = error => ({ status: 500, ok: false, json: async () => ({ error }) });
const listing = ref => ({ status: 200, ok: true, json: async () => ({ items: [{ kind: 'user', images: [{ ref, type: 'image/png' }] }] }) });

test('the viewer asks for the pictures before the loaded messages once for each start, again after Load earlier, and again after a failed answer', async () => {
  let failing = false;
  const pictures = address => (failing ? failure('Could not list the pictures.') : listing(`${/before=(\d+)/.exec(address)[1]}.0.u`));
  await withServer({ starts: [600, 200, 100], pictures }, async asked => {
    const { chat } = await openChat('chat-pictures');
    const refs = async () => (await chat.earlierImages()).map(item => item.images[0].ref);
    assert.deepEqual(await refs(), ['600.0.u']);
    assert.deepEqual(await refs(), ['600.0.u']);
    assert.deepEqual(asked, ['api/sessions/chat-pictures/images?before=600'], 'once for the start the chat opened with');

    await chat.loadEarlier();
    assert.deepEqual(await refs(), ['200.0.u']);
    assert.deepEqual(await refs(), ['200.0.u']);
    assert.deepEqual(asked.slice(1), ['api/sessions/chat-pictures/images?before=200'], 'and once more now that the start has moved');

    await chat.loadEarlier();
    failing = true;
    await assert.rejects(chat.earlierImages(), /Could not list the pictures/);
    failing = false;
    assert.deepEqual(await refs(), ['100.0.u'], 'a failed answer is not kept');
    assert.deepEqual(await refs(), ['100.0.u']);
    assert.equal(asked.length, 4);
    chat.close();
  });
});

test('an answer that fails after the start has moved on is dropped without taking away the answer for the new start', async () => {
  let failSlow;
  const pictures = address => (address.endsWith('before=600')
    ? new Promise(resolve => { failSlow = () => resolve(failure('Too slow.')); })
    : listing('200.0.u'));
  await withServer({ starts: [600, 200], pictures }, async asked => {
    const { chat } = await openChat('chat-moved-on');
    const slow = assert.rejects(chat.earlierImages(), /Too slow/);
    await chat.loadEarlier();
    const fresh = await chat.earlierImages();
    failSlow();
    await slow;
    assert.equal(await chat.earlierImages(), fresh, 'the answer for the new start is still the one kept');
    assert.equal(asked.length, 2);
    chat.close();
  });
});
