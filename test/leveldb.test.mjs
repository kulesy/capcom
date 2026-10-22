// Run with `npm test`. Each store is built byte by byte in a temp folder, in the layouts LevelDB writes: tables of prefix-compressed
// blocks with an index and a footer, and logs of 32 KB blocks. The keys and values are made up and nothing in them is real.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32c, maskCrc, readLocalStorage, snappyDecode } from '../lib/leveldb.mjs';
import { batch, BLOCK, block, del, FIRST, FULL, kinds, LAST, logOf, MAX_SEQ, MIDDLE, ordered, ORIGIN, padded, physical, row, set, shortened, small, squash, table, u32, userKey, utf16, varint } from './leveldb-fixture.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-leveldb-test-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const OTHER = 'https://other.test';
const KEY = 'test-key';
const NOON = 1_700_000_000;

const hex = text => Buffer.from(text.replace(/\s/g, ''), 'hex');

// ---- folders -----------------------------------------------------------------------------------------------------------------

const folder = () => fs.mkdtempSync(path.join(base, 'store-'));
const write = (dir, name, bytes, at = NOON) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  fs.utimesSync(file, at, at);
  return file;
};
const read = (dir, keys = [KEY], origin = ORIGIN) => readLocalStorage(dir, origin, keys);
const got = (...args) => Object.fromEntries(read(...args));
const gone = name => Object.assign(new Error(`${name}: no such file`), { code: 'ENOENT' });

// ---- the checksum and snappy -------------------------------------------------------------------------------------------------

test('the checksum is CRC32C at the standard check values, and the mask is the rotation and offset LevelDB stores', () => {
  assert.equal(crc32c(Buffer.from('123456789')), 0xe3069283);
  assert.equal(crc32c(Buffer.alloc(32, 0)), 0x8a9136aa);
  assert.equal(crc32c(Buffer.alloc(32, 0xff)), 0x62a8ab43);
  assert.equal(crc32c(Buffer.from(Array.from({ length: 32 }, (_, i) => i))), 0x46dd794e);
  assert.equal(crc32c(Buffer.from(Array.from({ length: 32 }, (_, i) => 31 - i))), 0x113fdb5c);
  assert.equal(crc32c(Buffer.from('xx123456789yy'), 2, 11), 0xe3069283, 'a range of a buffer');
  assert.equal(crc32c(Buffer.alloc(0)), 0);
  assert.equal(maskCrc(0xe3069283), 0xc78ab0e5);
  assert.equal(maskCrc(0), 0xa282ead8);
  assert.equal(maskCrc(0xffffffff), 0xa282ead7, 'it wraps at 32 bits');
});

test('snappy reads a literal of every length form and a copy of every offset form', () => {
  const ramp = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 251));
  const cases = {
    'a short literal': ['05 10 68656c6c6f', Buffer.from('hello')],
    'a literal with a one byte length': [`46 f0 45 ${'61'.repeat(70)}`, Buffer.alloc(70, 'a')],
    'a literal with a two byte length': [`ac02 f4 2b01 ${ramp.toString('hex')}`, ramp],
    'a literal with a three byte length': ['03 f8 020000 616263', Buffer.from('abc')],
    'a literal with a four byte length': ['03 fc 02000000 616263', Buffer.from('abc')],
    'a copy with a one byte offset': ['08 0c 61626364 01 04', Buffer.from('abcdabcd')],
    'a copy with a one byte offset and the high bits of a longer one': [`b102 f4 2b01 ${ramp.toString('hex')} 25 2c`, Buffer.concat([ramp, ramp.subarray(0, 5)])],
    'a copy with a two byte offset': ['0c 14 616263646566 16 0600', Buffer.from('abcdefabcdef')],
    'a copy with a four byte offset': ['08 0c 61626364 0f 04000000', Buffer.from('abcdabcd')],
    'a copy that reads the byte it just wrote': ['08 00 61 1a 0100', Buffer.from('aaaaaaaa')],
    'a copy that reads the two bytes it just wrote': ['08 04 6162 16 0200', Buffer.from('abababab')],
    'nothing': ['00', Buffer.alloc(0)],
  };
  for (const [name, [bytes, want]] of Object.entries(cases)) assert.deepEqual(snappyDecode(hex(bytes)), want, name);
});

test('snappy refuses a stream that does not add up', () => {
  const refused = {
    'a copy at offset 0': ['08 00 61 1a 0000', /out of range/],
    'a copy from before the start of the output': ['08 00 61 1a 0200', /out of range/],
    'a copy that runs past the declared length': ['05 00 61 1a 0100', /out of range/],
    'a literal that runs past the declared length': ['03 10 68656c6c6f', /past its length/],
    'a stream shorter than its declared length': ['06 10 68656c6c6f', /does not match/],
    'a literal cut short': ['05 10 6865', /ends early/],
    'a copy cut short': ['08 00 61 1a 01', /ends early/],
    'a length no stream could expand to': ['ffffffff0f 00 61', /impossible/],
    'no bytes at all': ['', /ends early/],
  };
  for (const [name, [bytes, message]] of Object.entries(refused)) assert.throws(() => snappyDecode(hex(bytes)), message, name);
});

// ---- tables ------------------------------------------------------------------------------------------------------------------

test('a value in a table with an uncompressed block is found, among keys that share prefixes and restart every sixteen entries', () => {
  const dir = folder();
  const filler = Array.from({ length: 40 }, (_, i) => row(100 + i, set(`key-${String(i).padStart(2, '0')}`, `value ${i}`)));
  write(dir, '000005.ldb', small(row(7, set(KEY, '{"a":1}')), ...filler));
  const found = read(dir, [KEY, 'key-00', 'key-17', 'key-39', 'key-40']);
  assert.ok(found instanceof Map);
  assert.deepEqual(Object.fromEntries(found), { [KEY]: '{"a":1}', 'key-00': 'value 0', 'key-17': 'value 17', 'key-39': 'value 39' });
});

test('a value in a snappy block is found, through copies that read their own output', () => {
  const text = `{"a":"${'x'.repeat(150)}"}`;
  const rows = ordered([row(7, set(KEY, text)), row(3, set('other-key', 'x'))]);
  const plain = block(rows);
  const packed = squash(plain);
  assert.ok(packed.length < plain.length - 100, 'the run is stored as copies');
  assert.deepEqual(snappyDecode(packed), plain);

  const dir = folder();
  const built = table([rows], { packed: [0] });
  const [offset, size] = built.blocks[0];
  assert.equal(built.bytes[offset + size], 1, 'the block is marked compressed');
  write(dir, '000005.ldb', built.bytes);
  assert.deepEqual(got(dir, [KEY, 'other-key']), { [KEY]: text, 'other-key': 'x' });
});

test('the index skips the blocks below a key and reads on while a key can straddle two blocks, and only those blocks are read', t => {
  const rows = ordered([
    row(1, set('alpha', 'a')), row(2, set('bravo', 'b')),
    row(3, set('charlie', 'c')), row(9, set(KEY, '{"v":9}')),
    row(5, set(KEY, '{"v":5}')), row(2, set(KEY, '{"v":2}')),
    row(4, set('uniform', 'u')), row(6, set('victor', 'v')),
  ]);
  const built = table([rows.slice(0, 2), rows.slice(2, 4), rows.slice(4, 6), rows.slice(6)], { separators: [undefined, undefined, shortened('test-kf'), shortened('w')] });
  const dir = folder();
  write(dir, '000005.ldb', built.bytes);

  const reads = [];
  const real = fs.readSync;
  t.mock.method(fs, 'readSync', (fd, buf, offset, length, position) => {
    reads.push([position, length]);
    return real(fd, buf, offset, length, position);
  });
  assert.equal(read(dir).get(KEY), '{"v":9}');
  const withTrailer = ([offset, size]) => [offset, size + 5];
  assert.deepEqual(reads, [[built.bytes.length - 48, 48], withTrailer(built.index), withTrailer(built.blocks[1]), withTrailer(built.blocks[2])],
    'the footer, the index, then the block that ends at the key and the block that ends past it');

  reads.length = 0;
  assert.equal(read(dir).get(KEY), '{"v":9}');
  assert.deepEqual(reads, [], 'a second read of the same key comes from the cache');
  assert.deepEqual(got(dir, ['alpha', 'zulu']), { alpha: 'a' });
  assert.deepEqual(reads, [withTrailer(built.blocks[0])], 'a new key is found through the index already read, and a key above them all reads no block');
});

test('a deletion in the first block of a straddling key hides the older values in the next', () => {
  const rows = ordered([row(3, set('charlie', 'c')), row(9, del(KEY)), row(5, set(KEY, '{"v":5}')), row(4, set('uniform', 'u'))]);
  const dir = folder();
  write(dir, '000005.ldb', table([rows.slice(0, 2), rows.slice(2, 3), rows.slice(3)], { separators: [undefined, shortened('test-kf')] }).bytes);
  assert.deepEqual(got(dir, [KEY, 'charlie']), { charlie: 'c' });
});

test('a block that is valid but makes no sense is skipped, and so is a block with an unknown compression', () => {
  const dir = folder();
  // An entry whose key claims to share 3 bytes with a key before it, when there is none.
  const [key, value] = row(5, set('lima', 'l'));
  const nonsense = Buffer.concat([varint(3), varint(key.length), varint(value.length), key, value, u32(0), u32(1)]);
  const lopsided = table([nonsense, ordered([row(5, set('zulu', 'z'))])], { separators: [key, undefined] });
  write(dir, '000005.ldb', lopsided.bytes);
  const [offset, size] = lopsided.blocks[1];
  const unknown = Buffer.from(lopsided.bytes);
  unknown[offset + size] = 7;
  unknown.writeUInt32LE(maskCrc(crc32c(unknown, offset, offset + size + 1)), offset + size + 1);
  write(dir, '000006.ldb', unknown);
  assert.deepEqual(got(dir, ['lima', 'zulu']), { zulu: 'z' }, 'the second block reads in one file and is unknown in the other');
  fs.rmSync(path.join(dir, '000005.ldb'));
  assert.deepEqual(got(dir, ['lima', 'zulu']), {});
});

// ---- logs --------------------------------------------------------------------------------------------------------------------

test('a log with a record in one piece is read', () => {
  const dir = folder();
  const log = logOf([batch(10, set('other-key', 'x'), set(KEY, '{"a":1}'))]);
  assert.deepEqual(kinds(log), [FULL]);
  write(dir, '000007.log', log);
  assert.deepEqual(got(dir, [KEY, 'other-key']), { [KEY]: '{"a":1}', 'other-key': 'x' });
});

test('a record split first, middle and last across 32 KB blocks is joined and read', () => {
  const dir = folder();
  const big = `{"big":"${'a'.repeat(70_000)}"}`;
  const log = logOf([batch(10, set('other-key', 'x')), batch(11, set(KEY, big))]);
  assert.deepEqual(kinds(log), [FULL, FIRST, MIDDLE, LAST]);
  assert.ok(log.length > 2 * BLOCK);
  write(dir, '000007.log', log);
  assert.deepEqual(got(dir, [KEY, 'other-key']), { [KEY]: big, 'other-key': 'x' });
});

test('fewer than 7 bytes left in a block are padding, and the record after them starts the next block', () => {
  const dir = folder();
  const log = logOf([padded(10, 'pad-key', BLOCK - 7 - 3), batch(11, set(KEY, '{"a":1}'))]);
  assert.deepEqual(kinds(log), [FULL, FULL]);
  assert.equal(log[BLOCK + 6], FULL, 'the second record starts the second block');
  write(dir, '000007.log', log);
  const found = read(dir, [KEY, 'pad-key']);
  assert.equal(found.get(KEY), '{"a":1}');
  assert.match(found.get('pad-key'), /^p{32000,}$/, 'the record before the padding is read too');
});

test('a chain that breaks is dropped, and the records around it are read', () => {
  const dir = folder();
  const lost = batch(20, set(KEY, 'lost'));
  const log = Buffer.concat([
    physical(FULL, batch(1, set('first-key', 'one'))),
    physical(FIRST, lost.subarray(0, 20)),
    physical(FULL, batch(3, set('third-key', 'three'))),
    physical(MIDDLE, lost.subarray(20, 25)),
    physical(LAST, lost.subarray(25)),
    physical(LAST, Buffer.from('stray')),
    physical(FIRST, lost.subarray(0, 10)),
    physical(FIRST, batch(7, set('seventh-key', 'seven'))),
  ]);
  write(dir, '000007.log', log);
  assert.deepEqual(got(dir, [KEY, 'first-key', 'third-key', 'seventh-key']), { 'first-key': 'one', 'third-key': 'three' });
});

test('a batch that does not add up is dropped whole, and its sequence numbers are not used', () => {
  const dir = folder();
  const short = batch(30, set(KEY, 'short'), set('other-key', 'x'));
  const cases = {
    'a count of more changes than it holds': Buffer.concat([short.subarray(0, 8), u32(3), short.subarray(12)]),
    'bytes after its last change': Buffer.concat([short, Buffer.from([0])]),
    'a change of an unknown kind, which would read as a deletion of the key': Buffer.concat([short.subarray(0, 8), u32(1), Buffer.from([9]), varint(userKey(KEY).length), userKey(KEY)]),
    'a value cut short': short.subarray(0, short.length - 2),
    'fewer bytes than its header': short.subarray(0, 9),
  };
  for (const [name, bad] of Object.entries(cases)) {
    write(dir, '000007.log', logOf([batch(1, set(KEY, 'before')), bad, batch(2, set('third-key', 'after'))]), NOON + Object.keys(cases).indexOf(name));
    assert.deepEqual(got(dir, [KEY, 'other-key', 'third-key']), { [KEY]: 'before', 'third-key': 'after' }, name);
  }
});

// ---- which entry wins --------------------------------------------------------------------------------------------------------

test('the highest sequence wins across a table and a log, whichever holds it, and a newer deletion hides an older value', () => {
  const cases = [
    ['a newer value in the log', [row(5, set(KEY, 'table'))], batch(9, set(KEY, 'log')), 'log'],
    ['a newer value in the table', [row(9, set(KEY, 'table'))], batch(5, set(KEY, 'log')), 'table'],
    ['a newer deletion in the log', [row(5, set(KEY, 'table'))], batch(9, del(KEY)), undefined],
    ['a newer deletion in the table', [row(9, del(KEY))], batch(5, set(KEY, 'log')), undefined],
    ['an older deletion in the log', [row(8, set(KEY, 'table'))], batch(3, del(KEY)), 'table'],
    ['an older deletion in the table', [row(3, del(KEY))], batch(8, set(KEY, 'log')), 'log'],
    ['a value after a deletion in the log', [row(1, set(KEY, 'table'))], batch(9, del(KEY), set(KEY, 'log')), 'log'],
    ['a deletion after a value in the log', [row(1, set(KEY, 'table'))], batch(9, set(KEY, 'log'), del(KEY)), undefined],
  ];
  for (const [name, rows, log, want] of cases) {
    const dir = folder();
    write(dir, '000005.ldb', small(...rows));
    write(dir, '000007.log', logOf([log]));
    assert.equal(read(dir).get(KEY), want, name);
  }
});

test('the newest version of a key wins among several tables and logs, whatever order their files are in', () => {
  const dir = folder();
  write(dir, '000004.ldb', small(row(40, set(KEY, 'newest'))));
  write(dir, '000005.ldb', small(row(10, set(KEY, 'oldest'))));
  write(dir, '000006.ldb', small(row(30, set(KEY, 'older'))));
  write(dir, '000007.log', logOf([batch(20, set(KEY, 'old'))]));
  write(dir, '000009.log', logOf([batch(5, set(KEY, 'ancient'))]));
  assert.equal(read(dir).get(KEY), 'newest');
  fs.rmSync(path.join(dir, '000004.ldb'));
  assert.equal(read(dir).get(KEY), 'older');
  fs.rmSync(path.join(dir, '000006.ldb'));
  assert.equal(read(dir).get(KEY), 'old');
});

test('a sequence number is compared whole, past 32 bits', () => {
  const cases = [
    ['a table above a log', row(2n ** 34n + 1n, set(KEY, 'table')), batch(2n ** 33n + 5n, set(KEY, 'log')), 'table'],
    ['a log above a table', row(2n ** 33n + 5n, set(KEY, 'table')), batch(2n ** 34n + 1n, set(KEY, 'log')), 'log'],
    ['a table at the top of the 56 bits', row(MAX_SEQ, set(KEY, 'table')), batch(MAX_SEQ - 1n, set(KEY, 'log')), 'table'],
    ['a log at the top of the 56 bits', row(MAX_SEQ - 1n, set(KEY, 'table')), batch(MAX_SEQ, set(KEY, 'log')), 'log'],
  ];
  for (const [name, entry, log, want] of cases) {
    const dir = folder();
    write(dir, '000005.ldb', small(entry));
    write(dir, '000007.log', logOf([log]));
    assert.equal(read(dir).get(KEY), want, name);
  }
});

test('the nth change in a batch is at the batch\'s sequence number plus n, and the last change to a key in a batch wins', () => {
  const dir = folder();
  write(dir, '000005.ldb', small(row(100, set(KEY, 'table'))));
  write(dir, '000007.log', logOf([batch(100, set('other-key', 'x'), set(KEY, 'log'))]));
  assert.equal(read(dir).get(KEY), 'log', 'the second change is at 101, past the table\'s 100');

  const same = folder();
  write(same, '000007.log', logOf([batch(10, set(KEY, 'a'), set(KEY, 'b')), batch(20, set(KEY, 'c'), del(KEY)), batch(30, del(KEY), set(KEY, 'd'))]));
  assert.equal(read(same).get(KEY), 'd');
  write(same, '000007.log', logOf([batch(10, set(KEY, 'a'), set(KEY, 'b')), batch(20, set(KEY, 'c'), del(KEY))]), NOON + 1);
  assert.equal(read(same).has(KEY), false);
});

// ---- values and origins ------------------------------------------------------------------------------------------------------

test('a value is read as Latin-1 or UTF-16LE by its first byte, from a table and from a log', () => {
  const latin = 'café ñ ÿ';
  const wide = '{"a":"日本語 ✓ 😀"}';
  const dir = folder();
  write(dir, '000005.ldb', small(row(5, set('latin-table', latin)), row(6, set('wide-table', utf16(wide))), row(7, set('marker-only', ''))));
  write(dir, '000007.log', logOf([batch(10, set('latin-log', latin), set('wide-log', utf16(wide)), set('wide-empty', utf16('')))]));
  assert.deepEqual(got(dir, ['latin-table', 'wide-table', 'marker-only', 'latin-log', 'wide-log', 'wide-empty']), {
    'latin-table': latin, 'wide-table': wide, 'marker-only': '', 'latin-log': latin, 'wide-log': wide, 'wide-empty': '',
  });
});

test('a value with a first byte that is neither encoding is not returned', () => {
  const dir = folder();
  write(dir, '000005.ldb', small(row(5, set(KEY, Buffer.from([2, 0x61, 0x62])))));
  write(dir, '000007.log', logOf([batch(10, set('other-key', Buffer.from([0xff, 0x61])))]));
  assert.deepEqual(got(dir, [KEY, 'other-key']), {});
});

test('another origin\'s entry for the same script key is not returned, nor is a longer origin, a longer key or another scheme', () => {
  const dir = folder();
  write(dir, '000005.ldb', small(
    row(5, set(KEY, 'mine')),
    row(6, set(KEY, 'theirs', OTHER)),
    row(7, set(KEY, 'evil', `${ORIGIN}.evil.test`)),
    row(8, set(`${KEY}2`, 'sibling')),
    row(9, set(KEY, 'plain', 'http://example.test')),
  ));
  write(dir, '000007.log', logOf([batch(20,
    set(KEY, 'third', 'https://third.test'),
    del(KEY, OTHER),
    set(`${KEY}-more`, 'log-sibling'),
    set(KEY, 'log-evil', `${ORIGIN}.evil.test`),
  )]));
  assert.deepEqual(got(dir), { [KEY]: 'mine' });
  assert.deepEqual(got(dir, [KEY, `${KEY}2`, `${KEY}-more`]), { [KEY]: 'mine', [`${KEY}2`]: 'sibling', [`${KEY}-more`]: 'log-sibling' });
  assert.deepEqual(got(dir, [KEY], OTHER), {}, 'a deletion by that origin hides its own value');
  assert.deepEqual(got(dir, [KEY], 'https://third.test'), { [KEY]: 'third' });
  assert.deepEqual(got(dir, [KEY], 'https://nowhere.test'), {});
});

// ---- failing soft ------------------------------------------------------------------------------------------------------------

test('a torn record at the end of a log is dropped and the records before it are read', () => {
  const first = logOf([batch(10, set(KEY, 'first'))]);
  const log = logOf([batch(10, set(KEY, 'first')), batch(11, set(KEY, 'second'))]);
  const cuts = {
    'inside the data': log.length - 1,
    'after the header': first.length + 7,
    'inside the header': first.length + 3,
    'a byte into the header': first.length + 1,
    'none of it': first.length,
  };
  for (const [name, end] of Object.entries(cuts)) {
    const dir = folder();
    write(dir, '000007.log', log.subarray(0, end));
    assert.equal(read(dir).get(KEY), 'first', name);
  }
  const dir = folder();
  write(dir, '000007.log', Buffer.concat([first, physical(FIRST, batch(11, set(KEY, 'second')).subarray(0, 9))]));
  assert.equal(read(dir).get(KEY), 'first', 'a first piece with no last');
});

test('a log record whose checksum does not match is dropped with the rest of its block, and the next block is read', () => {
  const dir = folder();
  const records = [batch(10, set(KEY, 'first')), batch(11, set(KEY, 'second')), batch(12, set('same-block', 'x'))];
  const used = records.reduce((sum, r) => sum + 7 + r.length, 0);
  const log = logOf([...records, padded(13, 'pad-key', BLOCK - used - 7), batch(14, set('next-block', 'y'))]);
  assert.deepEqual(kinds(log), [FULL, FULL, FULL, FULL, FULL]);
  assert.equal(log[BLOCK + 6], FULL, 'the last record starts the second block');
  const flipped = at => {
    const copy = Buffer.from(log);
    copy[at] ^= 0xff;
    return copy;
  };
  const asked = [KEY, 'same-block', 'pad-key', 'next-block'];

  // One letter of the second record's value is changed, so that the record still reads as a batch and only its checksum gives it away.
  write(dir, '000007.log', flipped(log.indexOf('second')));
  assert.deepEqual(got(dir, asked), { [KEY]: 'first', 'next-block': 'y' }, 'a damaged second record: the first is read, the rest of its block is not');

  const sum = folder();
  write(sum, '000007.log', flipped(2));
  assert.deepEqual(got(sum, asked), { 'next-block': 'y' }, 'a damaged stored checksum on the first record');
});

test('a block whose checksum does not match is skipped, and the blocks beside it and the other files still count', () => {
  const dir = folder();
  const built = table([ordered([row(1, set('alpha', 'a')), row(2, set('bravo', 'b'))]), ordered([row(9, set(KEY, 'lost')), row(8, set('zulu', 'z'))])]);
  // One letter of the value is changed, so that the block still parses and only its checksum gives it away.
  built.bytes[built.bytes.indexOf('lost')] ^= 1;
  write(dir, '000005.ldb', built.bytes);
  write(dir, '000004.ldb', small(row(3, set(KEY, 'older'))));
  assert.deepEqual(got(dir, [KEY, 'alpha', 'bravo', 'zulu']), { [KEY]: 'older', alpha: 'a', bravo: 'b' });
});

test('a table with a wrong magic, a bad index checksum or an index past the end of the file is skipped, and the other files still count', () => {
  const good = table([ordered([row(9, set(KEY, 'lost'))])]);
  const cases = {
    'a wrong magic': bytes => { bytes[bytes.length - 1] ^= 0xff; },
    // The last letter of the one separator in the index is raised, so the index still parses and still points at the block.
    'a bad index checksum': bytes => { bytes[bytes.indexOf(KEY, good.index[0]) + KEY.length - 1]++; },
    'an index handle past the end': bytes => { Buffer.concat([varint(0), varint(0), varint(1e9), varint(10)]).copy(bytes, bytes.length - 48); },
  };
  for (const [name, spoil] of Object.entries(cases)) {
    const dir = folder();
    const bytes = Buffer.from(good.bytes);
    spoil(bytes);
    write(dir, '000005.ldb', bytes);
    write(dir, '000004.ldb', small(row(3, set(KEY, 'older'))));
    assert.equal(read(dir).get(KEY), 'older', name);
  }
});

test('files that are empty, too short or full of nonsense are skipped, and the other files still count', () => {
  const dir = folder();
  write(dir, '000001.ldb', Buffer.alloc(0));
  write(dir, '000002.ldb', Buffer.from('short'));
  write(dir, '000003.ldb', Buffer.alloc(200, 7));
  write(dir, '000004.ldb', Buffer.alloc(48, 0));
  write(dir, '000005.log', Buffer.alloc(0));
  write(dir, '000006.log', Buffer.alloc(100, 0));
  write(dir, '000008.log', Buffer.alloc(5000, 0xab));
  write(dir, '000009.log', Buffer.from(Array.from({ length: 70_000 }, (_, i) => (i * 7919) % 256)));
  write(dir, '000010.ldb', small(row(5, set(KEY, 'good'))));
  assert.deepEqual(got(dir), { [KEY]: 'good' });
});

test('a file that is listed and then gone, a name that is not a file, and a read that fails are skipped, and the rest is read', t => {
  const dir = folder();
  write(dir, '000004.ldb', small(row(5, set(KEY, 'older'))));
  write(dir, '000006.ldb', small(row(9, set(KEY, 'newer'))));
  fs.symlinkSync(path.join(dir, 'no-such-file'), path.join(dir, '000008.ldb'));
  fs.mkdirSync(path.join(dir, '000009.log'));
  fs.mkdirSync(path.join(dir, '000010.ldb'));
  assert.equal(read(dir).get(KEY), 'newer', 'a dangling link and two folders');

  const vanished = folder();
  write(vanished, '000004.ldb', small(row(5, set(KEY, 'older'))));
  write(vanished, '000006.ldb', small(row(9, set(KEY, 'newer'))));
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (file, ...rest) => {
    if (String(file).endsWith('000006.ldb')) throw gone(file);
    return open(file, ...rest);
  });
  assert.equal(read(vanished).get(KEY), 'older', 'a file that goes between the listing and the open');
  t.mock.restoreAll();

  const failing = folder();
  write(failing, '000004.ldb', small(row(9, set(KEY, 'newer'))));
  write(failing, '000006.ldb', small(row(5, set(KEY, 'older'))));
  const readSync = fs.readSync;
  const closeSync = fs.closeSync;
  const opened = [];
  const closed = [];
  let calls = 0;
  t.mock.method(fs, 'openSync', (...args) => {
    const fd = open(...args);
    opened.push(fd);
    return fd;
  });
  t.mock.method(fs, 'closeSync', fd => {
    closed.push(fd);
    closeSync(fd);
  });
  t.mock.method(fs, 'readSync', (...args) => {
    if (calls++ === 0) throw Object.assign(new Error('input/output error'), { code: 'EIO' });
    return readSync(...args);
  });
  assert.equal(read(failing).get(KEY), 'older', 'a read that fails in the first file');
  assert.equal(read(failing).get(KEY), 'newer', 'and the file is tried again, not remembered as empty');
  assert.equal(opened.length, 3, 'both files, then the first again');
  assert.deepEqual(closed, opened, 'every file that was opened was closed, the one whose read failed too');
  t.mock.restoreAll();

  const blocky = folder();
  write(blocky, '000004.ldb', small(row(9, set(KEY, 'newer'))));
  write(blocky, '000006.ldb', small(row(5, set(KEY, 'older'))));
  let failed = false;
  t.mock.method(fs, 'readSync', (...args) => {
    // A table's first data block starts at the top of its file.
    if (failed || args[4] !== 0) return readSync(...args);
    failed = true;
    throw Object.assign(new Error('input/output error'), { code: 'EIO', syscall: 'read' });
  });
  assert.equal(read(blocky).get(KEY), 'older', 'a data block whose read fails');
  assert.equal(read(blocky).get(KEY), 'newer', 'and its table is read again, not remembered as holding nothing');
  t.mock.restoreAll();

  const odd = folder();
  write(odd, '000005.ldb', small(row(5, set(KEY, 'good'))));
  const fifo = write(odd, '000007.log', Buffer.alloc(0));
  const stat = fs.statSync;
  const named = [];
  t.mock.method(fs, 'statSync', (file, ...rest) => (file === fifo ? { ...stat(file, ...rest), isFile: () => false } : stat(file, ...rest)));
  t.mock.method(fs, 'openSync', (file, ...rest) => {
    named.push(path.basename(String(file)));
    return open(file, ...rest);
  });
  assert.equal(read(odd).get(KEY), 'good', 'a FIFO, whose open would wait for a writer');
  assert.deepEqual(named, ['000005.ldb'], 'and it is never opened');
});

test('a folder that is missing, a path that is not a folder and arguments of the wrong kind read as nothing and never throw', () => {
  const dir = folder();
  write(dir, '000005.ldb', small(row(5, set(KEY, 'good'))));
  const file = write(folder(), 'plain.txt', 'text');
  const call = (...args) => Object.fromEntries(readLocalStorage(...args));
  assert.deepEqual(call(path.join(base, 'missing-folder'), ORIGIN, [KEY]), {});
  assert.deepEqual(call(file, ORIGIN, [KEY]), {});
  assert.deepEqual(call(undefined, ORIGIN, [KEY]), {});
  assert.deepEqual(call(null, null, null), {});
  assert.deepEqual(call(), {});
  assert.deepEqual(call(dir, ORIGIN, undefined), {});
  assert.deepEqual(call(dir, ORIGIN, 5), {});
  assert.deepEqual(call(dir, ORIGIN, []), {});
  assert.deepEqual(call(dir, undefined, [KEY]), {});
  assert.deepEqual(call(dir, ORIGIN, ['日本']), {}, 'a key that is not Latin-1 is not asked for');
  assert.deepEqual(call(dir, ORIGIN, [5, null, {}, KEY, KEY]), { [KEY]: 'good' });
  assert.deepEqual(call(dir, ORIGIN, [KEY, 'absent']), { [KEY]: 'good' });
});

// ---- the cache ---------------------------------------------------------------------------------------------------------------

test('a table is parsed once: while its name, size and time hold a second read comes from the cache, and a change to either is read afresh', () => {
  const dir = folder();
  const file = write(dir, '000005.ldb', small(row(7, set(KEY, '{"a":1}'))));
  const size = fs.statSync(file).size;
  assert.equal(read(dir).get(KEY), '{"a":1}');

  write(dir, '000005.ldb', small(row(7, set(KEY, '{"a":2}'))));
  assert.equal(fs.statSync(file).size, size);
  assert.equal(read(dir).get(KEY), '{"a":1}', 'other bytes with the same size and time are not noticed');

  write(dir, '000005.ldb', small(row(7, set(KEY, '{"a":2}'))), NOON + 60);
  assert.equal(read(dir).get(KEY), '{"a":2}', 'a new time');

  write(dir, '000005.ldb', small(row(7, set(KEY, '{"a":22}'))), NOON + 60);
  assert.equal(read(dir).get(KEY), '{"a":22}', 'a new size');
});

test('a log is read again when its size or its time has changed, and not otherwise', () => {
  const dir = folder();
  write(dir, '000007.log', logOf([batch(10, set(KEY, 'one'))]));
  assert.equal(read(dir).get(KEY), 'one');

  write(dir, '000007.log', logOf([batch(10, set(KEY, 'two'))]));
  assert.equal(read(dir).get(KEY), 'one', 'other bytes with the same size and time are not noticed');

  write(dir, '000007.log', logOf([batch(10, set(KEY, 'two'))]), NOON + 1);
  assert.equal(read(dir).get(KEY), 'two', 'a new time');

  write(dir, '000007.log', logOf([batch(10, set(KEY, 'two')), batch(11, set(KEY, 'three'))]), NOON + 1);
  assert.equal(read(dir).get(KEY), 'three', 'a record added');

  fs.appendFileSync(path.join(dir, '000007.log'), physical(FULL, batch(12, del(KEY))));
  assert.equal(read(dir).has(KEY), false, 'a record appended in place');
});

test('a file that is deleted is forgotten, so a new file of the same name, size and time is read afresh', () => {
  const dir = folder();
  const file = write(dir, '000005.ldb', small(row(7, set(KEY, 'aaa'))));
  assert.equal(read(dir).get(KEY), 'aaa');
  fs.rmSync(file);
  assert.equal(read(dir).has(KEY), false);
  write(dir, '000005.ldb', small(row(7, set(KEY, 'bbb'))));
  assert.equal(read(dir).get(KEY), 'bbb');
});

test('a key asked for after a file was cached is found in it, and the keys asked for before stay as they were', () => {
  const dir = folder();
  write(dir, '000005.ldb', small(row(5, set(KEY, 'table')), row(6, set('other-key', 'x'))));
  write(dir, '000007.log', logOf([batch(10, set('third-key', 'y'))]));
  assert.deepEqual(got(dir, [KEY]), { [KEY]: 'table' });
  assert.deepEqual(got(dir, [KEY, 'other-key', 'third-key', 'absent']), { [KEY]: 'table', 'other-key': 'x', 'third-key': 'y' });
  assert.deepEqual(got(dir, ['third-key']), { 'third-key': 'y' });
});

// ---- leaving the folder alone ------------------------------------------------------------------------------------------------

test('the folder is left as it was found: files are opened to read, and the lock and the other files are never opened', t => {
  const dir = folder();
  write(dir, '000005.ldb', small(row(5, set(KEY, 'table'))));
  write(dir, '000007.log', logOf([batch(10, set('other-key', 'log'))]));
  write(dir, 'CURRENT', 'MANIFEST-000002\n');
  write(dir, 'LOCK', '');
  write(dir, 'LOG', 'a text log\n');
  write(dir, 'LOG.old', 'an older text log\n');
  write(dir, 'MANIFEST-000002', Buffer.from('not a manifest'));
  write(dir, '000009.dbtmp', Buffer.from('half a table'));
  const snapshot = () => fs.readdirSync(dir).sort().map(name => [name, fs.statSync(path.join(dir, name)).mtimeMs, fs.readFileSync(path.join(dir, name)).toString('hex')]);
  const before = snapshot();

  const opened = [];
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (file, flags, ...rest) => {
    opened.push([path.basename(String(file)), flags]);
    return open(file, flags, ...rest);
  });
  const changes = ['writeFileSync', 'appendFileSync', 'unlinkSync', 'renameSync', 'rmSync', 'mkdirSync', 'truncateSync', 'utimesSync', 'chmodSync', 'copyFileSync', 'symlinkSync']
    .map(name => [name, t.mock.method(fs, name)]);
  assert.deepEqual(got(dir, [KEY, 'other-key']), { [KEY]: 'table', 'other-key': 'log' });
  const used = [...opened];
  t.mock.restoreAll();

  assert.deepEqual(used, [['000005.ldb', 'r'], ['000007.log', 'r']]);
  assert.deepEqual(changes.filter(([, spy]) => spy.mock.callCount() > 0).map(([name]) => name), []);
  assert.deepEqual(snapshot(), before);
});
