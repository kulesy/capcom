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
