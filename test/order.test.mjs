// Run with `npm test`. The order a group lists its sessions in, which the server and the page share.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { byRecent, byTitle, startsWithEmoji } from '../public/ui/order.js';

const sorted = titles => titles.map((title, i) => ({ title, lastActivityAt: i })).sort(byTitle).map(r => r.title);

test('a title starts with an emoji when its first symbol is a picture, a flag or a keycap', () => {
  const emoji = ['🟨 Review', '⏳ Waiting', '🛢️ Pump', '🛢 Pump', '⬆️ Up', '✏️ Draft', '👩‍💻 Dev', '👨‍👩‍👧 Family', '🇦🇺 Sydney', '1️⃣ First', '#️⃣ Tag', '  ✅ Padded'];
  const text = ['Review', '1 First', '#tag', '*bold*', 'a🟨 b', 'Fix 🛢️ leak', '', '   '];
  assert.deepEqual(emoji.filter(t => !startsWithEmoji(t)), []);
  assert.deepEqual(text.filter(startsWithEmoji), []);
});

test('emoji titles come first, whatever kind of emoji they start with, and the rest follow A to Z', () => {
  const emoji = ['🇳🇿 Auckland', '🛢️ Pump', '👩‍💻 Dev', '🇦🇺 Sydney', '1️⃣ First'];
  const out = sorted(['Zebra', ...emoji.slice(0, 2), 'apple', ...emoji.slice(2), 'Mango']);
  assert.deepEqual([...out.slice(0, emoji.length)].sort(), [...emoji].sort());
  assert.deepEqual(out.slice(emoji.length), ['apple', 'Mango', 'Zebra']);
});

test('titles that start with the same emoji sit together and run A to Z', () => {
  const out = sorted(['🟨 b', '🛢️ b', '🟨 a', '🛢️ a', '🟨 c']);
  const yellow = ['🟨 a', '🟨 b', '🟨 c'];
  const oil = ['🛢️ a', '🛢️ b'];
  assert.ok([[...yellow, ...oil], [...oil, ...yellow]].some(want => isDeepStrictEqual(want, out)), out.join(' | '));
});

test('an emoji with or without its variation selector is the same emoji, so the rest of the title decides', () => {
  assert.deepEqual(sorted(['🛢️ b', '🛢 a', '🛢️ c']), ['🛢 a', '🛢️ b', '🛢️ c']);
});

test('case does not matter and numbers run in number order', () => {
  assert.deepEqual(sorted(['banana', 'Apple', 'cherry', 'apple 10', 'apple 9', 'Apple 2']), ['Apple', 'Apple 2', 'apple 9', 'apple 10', 'banana', 'cherry']);
});

test('an untitled session is placed as the Untitled session it is shown as', () => {
  assert.deepEqual(sorted(['Zed', '', 'Apple', 'Valid']), ['Apple', '', 'Valid', 'Zed']);
});

test('titles that differ only in case go newest first', () => {
  const same = [{ id: 'old', title: 'Notes', lastActivityAt: 1 }, { id: 'new', title: 'NOTES', lastActivityAt: 3 }, { id: 'mid', title: 'notes', lastActivityAt: 2 }];
  assert.deepEqual([...same].sort(byTitle).map(r => r.id), ['new', 'mid', 'old']);
  assert.deepEqual([...same].sort(byRecent).map(r => r.id), ['new', 'mid', 'old']);
});
