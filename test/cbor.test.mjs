// Run with `npm test`. The vectors are from RFC 8949 appendix A, plus the malformed input a passkey reader must refuse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, decodeFirst } from '../lib/cbor.mjs';
import { cbor } from './authenticator.mjs';

const hex = text => Buffer.from(text.replace(/\s/g, ''), 'hex');

test('reads integers of every width, positive and negative', () => {
  const cases = [
    ['00', 0], ['01', 1], ['0a', 10], ['17', 23], ['1818', 24], ['1819', 25], ['1864', 100], ['1903e8', 1000],
    ['1a000f4240', 1_000_000], ['1b000000e8d4a51000', 1_000_000_000_000],
    ['20', -1], ['29', -10], ['3863', -100], ['3903e7', -1000],
  ];
  for (const [bytes, value] of cases) assert.equal(decode(hex(bytes)), value, bytes);
});

test('reads byte strings, text and the simple values', () => {
  assert.deepEqual(decode(hex('44 01020304')), Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(decode(hex('40')), Buffer.alloc(0));
  assert.equal(decode(hex('60')), '');
  assert.equal(decode(hex('64 49455446')), 'IETF');
  assert.equal(decode(hex('62 c3bc')), 'ü');
  assert.equal(decode(hex('f4')), false);
  assert.equal(decode(hex('f5')), true);
  assert.equal(decode(hex('f6')), null);
});

test('reads arrays and maps, with integer keys kept as numbers', () => {
  assert.deepEqual(decode(hex('80')), []);
  assert.deepEqual(decode(hex('83 010203')), [1, 2, 3]);
  assert.deepEqual(decode(hex('82 01 82 0203')), [1, [2, 3]]);
  assert.deepEqual(decode(hex('a0')), new Map());
  assert.deepEqual(decode(hex('a2 0102 0304')), new Map([[1, 2], [3, 4]]));
  assert.deepEqual(decode(hex('a2 6161 01 6162 82 0203')), new Map([['a', 1], ['b', [2, 3]]]));
});

test('reads one item and says where it ended, for a key followed by other bytes', () => {
  const { value, end } = decodeFirst(hex('a1 0102 ffff'));
  assert.deepEqual(value, new Map([[1, 2]]));
  assert.equal(end, 3);
  assert.deepEqual(decodeFirst(hex('00 a0'), 1), { value: new Map(), end: 2 });
});

test('round-trips a COSE-shaped key through the encoder the tests use', () => {
  const key = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(32, 1)], [-3, Buffer.alloc(32, 2)]]);
  assert.deepEqual(decode(cbor(key)), key);
});

test('refuses what a passkey never sends', () => {
  const refused = {
    'indefinite byte string': '5f 4101 ff',
    'indefinite array': '9f 01 ff',
    'a tag': 'c0 6161',
    'a half float': 'f9 0000',
    'a double': 'fb 3ff0000000000000',
    undefined: 'f7',
    'a byte string as a map key': 'a1 4101 02',
    'a repeated map key': 'a2 01 02 01 03',
    'a number beyond 2^53': '1b ffffffffffffffff',
  };
  for (const [name, bytes] of Object.entries(refused)) assert.throws(() => decode(hex(bytes)), /CBOR/, name);
});

test('refuses input that ends early or runs on', () => {
  assert.throws(() => decode(hex('1a 000f42')), /ends early/);
  assert.throws(() => decode(hex('45 0102')), /ends early/);
  assert.throws(() => decode(hex('99 ffff')), /ends early/);
  assert.throws(() => decode(hex('')), /ends early/);
  assert.throws(() => decode(hex('00 00')), /bytes after/);
});

test('refuses nesting that goes too deep', () => {
  assert.deepEqual(decode(hex('81'.repeat(5) + '01')), [[[[[1]]]]]);
  assert.throws(() => decode(hex('81'.repeat(20) + '01')), /too deeply/);
});
