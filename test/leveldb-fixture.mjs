// Builders for synthetic LevelDB folders: each table and log is built byte by byte, in the layouts LevelDB writes. Tables are prefix-compressed
// blocks with an index and a footer, and logs are 32 KB blocks. The keys and values are made up and nothing in them is real. The LevelDB
// test uses them to check the reader, and the server tests use them to give the fake Desktop a Local Storage folder.
import assert from 'node:assert/strict';
import { crc32c, maskCrc } from '../lib/leveldb.mjs';

export const ORIGIN = 'https://example.test';
export const BLOCK = 32768;
export const MAX_SEQ = (1n << 56n) - 1n;

export const varint = n => {
  const out = [];
  for (; n >= 128; n = Math.floor(n / 128)) out.push((n % 128) | 128);
  return Buffer.from([...out, n]);
};
export const u32 = n => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(n);
  return out;
};

// ---- keys, values and the changes that carry them ----------------------------------------------------------------------------

export const userKey = (key, origin = ORIGIN) => Buffer.from(`_${origin}\0\x01${key}`, 'latin1');
const latin1 = text => Buffer.concat([Buffer.from([1]), Buffer.from(text, 'latin1')]);
export const utf16 = text => Buffer.concat([Buffer.from([0]), Buffer.from(text, 'utf16le')]);
// A change to a key as [user key, stored value], with null for a deletion.
export const set = (key, value, origin = ORIGIN) => [userKey(key, origin), Buffer.isBuffer(value) ? value : latin1(value)];
export const del = (key, origin = ORIGIN) => [userKey(key, origin), null];
const tagOf = (seq, type) => {
  const tag = Buffer.alloc(8);
  tag.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(type));
  return tag;
};
// A table entry for a change: the internal key, which is the user key then the sequence number and type, and the value.
export const row = (seq, [user, value]) => [Buffer.concat([user, tagOf(seq, value ? 1 : 0)]), value ?? Buffer.alloc(0)];
const tagValue = key => key.readBigUInt64LE(key.length - 8);
// A table keeps its entries by user key, and the newest first within one key.
export const ordered = rows => [...rows].sort(([a], [b]) => Buffer.compare(a.subarray(0, -8), b.subarray(0, -8)) || (tagValue(b) > tagValue(a) ? 1 : -1));

// ---- tables ------------------------------------------------------------------------------------------------------------------

// A block as LevelDB's BlockBuilder writes it: each key is stored as what it shares with the one before and what differs, and every
// `every` entries a restart point starts a key afresh.
export function block(entries, every = 16) {
  const body = [];
  const restarts = [0];
  let size = 0;
  let last = Buffer.alloc(0);
  let since = 0;
  for (const [key, value] of entries) {
    let shared = 0;
    if (since < every) {
      while (shared < Math.min(last.length, key.length) && last[shared] === key[shared]) shared++;
    } else {
      restarts.push(size);
      since = 0;
    }
    const entry = Buffer.concat([varint(shared), varint(key.length - shared), varint(value.length), key.subarray(shared), value]);
    body.push(entry);
    size += entry.length;
    last = key;
    since++;
  }
  return Buffer.concat([...body, ...restarts.map(u32), u32(restarts.length)]);
}

// A block followed by its trailer: the compression type, then the masked CRC32C of the block and that byte.
function sealed(body, type = 0) {
  const covered = Buffer.concat([body, Buffer.from([type])]);
  return Buffer.concat([covered, u32(maskCrc(crc32c(covered)))]);
}

// A snappy stream for `plain`, made by hand around its first run of 8 or more equal bytes: the bytes up to the run's first, copies at
// offset 1 for the rest of the run (each reads what the one before wrote), then the bytes after the run.
export function squash(plain) {
  let from = 0;
  while (from + 8 <= plain.length && !plain.subarray(from, from + 8).equals(Buffer.alloc(8, plain[from]))) from++;
  assert.ok(from + 8 <= plain.length, 'the block holds a run to copy');
  let to = from + 8;
  while (plain[to] === plain[from]) to++;
  const literal = bytes => {
    const n = bytes.length - 1;
    return Buffer.concat([Buffer.from(n < 60 ? [n << 2] : n < 256 ? [60 << 2, n] : [61 << 2, n & 255, n >> 8]), bytes]);
  };
  const copies = [];
  for (let left = to - from - 1; left > 0; left -= 64) copies.push(Buffer.from([((Math.min(left, 64) - 1) << 2) | 2, 1, 0]));
  return Buffer.concat([varint(plain.length), literal(plain.subarray(0, from + 1)), ...copies, ...(to < plain.length ? [literal(plain.subarray(to))] : [])]);
}

// A table: data blocks, an empty metaindex, the index and the footer. A block is a list of entries or the bytes of a block. The index
// names each block by a separator, which is its last key unless `separators` gives a shortened one, and `packed` lists the blocks that
// are stored snappy compressed. It returns the file, the [offset, size] of each data block and of the index.
export function table(blocks, { separators = [], packed = [] } = {}) {
  const parts = [];
  let end = 0;
  const add = (body, type = 0) => {
    const raw = sealed(body, type);
    parts.push(raw);
    end += raw.length;
    return [end - raw.length, body.length];
  };
  const at = blocks.map((entries, i) => {
    const body = Buffer.isBuffer(entries) ? entries : block(entries);
    return packed.includes(i) ? add(squash(body), 1) : add(body);
  });
  const meta = add(block([]));
  const handle = ([offset, size]) => Buffer.concat([varint(offset), varint(size)]);
  const index = add(block(blocks.map((entries, i) => [separators[i] ?? entries.at(-1)[0], handle(at[i])]), 1));
  const footer = Buffer.alloc(48);
  Buffer.concat([handle(meta), handle(index)]).copy(footer);
  Buffer.from('57fb808b247547db', 'hex').copy(footer, 40);
  return { bytes: Buffer.concat([...parts, footer]), blocks: at, index };
}

// A table of one block holding the changes at the sequence numbers given.
export const small = (...rows) => table([ordered(rows)]).bytes;
// What an index holds for a block whose keys were cut short: the shortened user key, then the highest sequence number.
export const shortened = key => Buffer.concat([userKey(key), tagOf(MAX_SEQ, 1)]);

// ---- logs --------------------------------------------------------------------------------------------------------------------

// A write batch: its first sequence number, a count, and each change as a tag (1 to put, 0 to delete), a key and for a put a value.
export function batch(seq, ...changes) {
  const head = Buffer.alloc(12);
  head.writeBigUInt64LE(BigInt(seq));
  head.writeUInt32LE(changes.length, 8);
  return Buffer.concat([head, ...changes.map(([user, value]) => Buffer.concat(value
    ? [Buffer.from([1]), varint(user.length), user, varint(value.length), value]
    : [Buffer.from([0]), varint(user.length), user]))]);
}

// A batch of exactly `size` bytes, made by lengthening the value of one change.
export function padded(seq, key, size) {
  let n = size;
  while (batch(seq, set(key, 'p'.repeat(n))).length > size) n--;
  const out = batch(seq, set(key, 'p'.repeat(n)));
  assert.equal(out.length, size);
  return out;
}

export const FULL = 1;
export const FIRST = 2;
export const MIDDLE = 3;
export const LAST = 4;

// A physical record: the masked CRC32C of the type and data, the length, the type, then the data.
export function physical(type, data) {
  const head = Buffer.alloc(7);
  head.writeUInt32LE(maskCrc(crc32c(Buffer.concat([Buffer.from([type]), data]))));
  head.writeUInt16LE(data.length, 4);
  head[6] = type;
  return Buffer.concat([head, data]);
}

// A log as LevelDB's writer lays it out: a record that does not fit in what is left of a block is split, and fewer than 7 bytes left
// in a block are zeros.
export function logOf(records) {
  const out = [];
  let used = 0;
  for (const data of records) {
    let rest = data;
    let first = true;
    do {
      if (BLOCK - used < 7) {
        out.push(Buffer.alloc(BLOCK - used));
        used = 0;
      }
      const take = Math.min(rest.length, BLOCK - used - 7);
      const last = take === rest.length;
      out.push(physical(first && last ? FULL : first ? FIRST : last ? LAST : MIDDLE, rest.subarray(0, take)));
      used = (used + 7 + take) % BLOCK;
      rest = rest.subarray(take);
      first = false;
    } while (rest.length);
  }
  return Buffer.concat(out);
}

// The type of each physical record in a log, to check that a fixture is cut the way a test says.
export function kinds(log) {
  const out = [];
  for (let at = 0; at < log.length;) {
    const room = BLOCK - (at % BLOCK);
    if (room < 7) {
      at += room;
      continue;
    }
    out.push(log[at + 6]);
    at += 7 + log.readUInt16LE(at + 4);
  }
  return out;
}
