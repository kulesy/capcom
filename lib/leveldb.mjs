// Reads values out of Chromium's Local Storage, which Claude Desktop keeps as a LevelDB folder. The folder's tables and write-ahead
// logs are read as plain files with positioned reads, so nothing is written, locked or left open.
// NOTE: [22 Oct 2026] EK - Desktop has this folder open. A LevelDB library would take its LOCK and may write to it, so keep reading
// the files by hand. The key layout and file formats are Chromium's own, not a documented API, checked on Desktop 3.1623.0.
import fs from 'node:fs';
import path from 'node:path';

const BLOCK = 32768;
const HEADER = 7;
const FOOTER = 48;
const TRAILER = 5;
const MAGIC = Buffer.from('57fb808b247547db', 'hex');
const EMPTY = Buffer.alloc(0);
const DELETE = 0;
const PUT = 1;
const FULL = 1;
const FIRST = 2;
const MIDDLE = 3;
const LAST = 4;

// A read position in a buffer. Every read throws when the buffer ends before it is complete.
function cursor(buf, at = 0) {
  const byte = () => {
    if (at >= buf.length) throw new Error('data ends early');
    return buf[at++];
  };
  const take = n => {
    if (n > buf.length - at) throw new Error('data ends early');
    at += n;
    return buf.subarray(at - n, at);
  };
  const varint = () => {
    let value = 0;
    for (let shift = 0; shift < 64; shift += 7) {
      const next = byte();
      value += (next & 0x7f) * 2 ** shift;
      if (next < 0x80) {
        if (!Number.isSafeInteger(value)) break;
        return value;
      }
    }
    throw new Error('number is too large');
  };
  return { byte, take, varint, uint: width => take(width).readUIntLE(0, width), left: () => buf.length - at };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
  return c >>> 0;
});

// LevelDB checksums with CRC32C (Castagnoli), which node:zlib does not have. `end` is exclusive.
export function crc32c(buf, start = 0, end = buf.length) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// What LevelDB stores in place of a CRC, so that data which holds a stored CRC does not checksum to itself.
export const maskCrc = crc => (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0;

// Snappy's raw format, which LevelDB uses for a block with compression type 1. Throws on anything that does not add up.
export function snappyDecode(src) {
  const cur = cursor(src);
  const size = cur.varint();
  // The densest element is a 64 byte copy in 3 bytes, so a longer length is corrupt and must not size a buffer.
  if (size > src.length * 22) throw new Error('snappy length is impossible');
  const out = Buffer.allocUnsafe(size);
  let n = 0;
  while (cur.left()) {
    const tag = cur.byte();
    const kind = tag & 3;
    if (kind === 0) {
      const length = (tag >> 2 < 60 ? tag >> 2 : cur.uint((tag >> 2) - 59)) + 1;
      if (n + length > size) throw new Error('snappy literal runs past its length');
      cur.take(length).copy(out, n);
      n += length;
      continue;
    }
    const length = kind === 1 ? ((tag >> 2) & 7) + 4 : (tag >> 2) + 1;
    const offset = kind === 1 ? ((tag >> 5) << 8) | cur.byte() : cur.uint(kind === 2 ? 2 : 4);
    if (offset === 0 || offset > n || n + length > size) throw new Error('snappy copy is out of range');
    // A copy can read what it has just written, so it goes a byte at a time.
    for (let i = 0; i < length; i++, n++) out[n] = out[n - offset];
  }
  if (n !== size) throw new Error('snappy length does not match');
  return out;
}

function readAt(fd, position, length) {
  const buf = Buffer.allocUnsafe(length);
  for (let got = 0; got < length;) {
    const n = fs.readSync(fd, buf, got, length - got, position + got);
    if (n === 0) throw new Error('file ends early');
    got += n;
  }
  return buf;
}

// ---- tables (.ldb) ----------------------------------------------------------------------------------------------------------

// The [key, value] pairs of one block. A key is stored as how much it shares with the key before, then what differs.
function blockEntries(block) {
  if (block.length < 4) throw new Error('block is too short');
  const restarts = block.readUInt32LE(block.length - 4);
  const end = block.length - 4 - 4 * restarts;
  if (end < 0) throw new Error('block has more restarts than room');
  const cur = cursor(block.subarray(0, end));
  const entries = [];
  let key = EMPTY;
  while (cur.left()) {
    const shared = cur.varint();
    const extra = cur.varint();
    const size = cur.varint();
    if (shared > key.length) throw new Error('block key shares more than the key before it has');
    key = Buffer.concat([key.subarray(0, shared), cur.take(extra)]);
    entries.push([key, cur.take(size)]);
  }
  return entries;
}

// Reads the block that the handle at the cursor names: a varint offset and a varint size, then a 5 byte trailer in the file.
function readBlock(fd, fileSize, handle) {
  const offset = handle.varint();
  const size = handle.varint();
  if (offset + size + TRAILER > fileSize) throw new Error('block is past the end of the file');
  const raw = readAt(fd, offset, size + TRAILER);
  if (maskCrc(crc32c(raw, 0, size + 1)) !== raw.readUInt32LE(size + 1)) throw new Error('block checksum does not match');
  if (raw[size] === 0) return raw.subarray(0, size);
  if (raw[size] === 1) return snappyDecode(raw.subarray(0, size));
  throw new Error('block compression is unknown');
}

// The index in file order: for each data block, the user key it ends at and the bytes of its handle.
function readIndex(fd, fileSize) {
  if (fileSize < FOOTER) throw new Error('file is too small to be a table');
  const footer = readAt(fd, fileSize - FOOTER, FOOTER);
  if (!footer.subarray(FOOTER - MAGIC.length).equals(MAGIC)) throw new Error('file is not a table');
  // The footer names the metaindex block, which is not needed, and then the index block.
  const handle = cursor(footer);
  handle.varint();
  handle.varint();
  return blockEntries(readBlock(fd, fileSize, handle)).map(([separator, bytes]) => {
    if (separator.length < 8) throw new Error('index key is too short');
    return { ends: separator.subarray(0, -8), bytes };
  });
}

// The newest entry for a user key in one table. Every key in a block is at or below its separator and below the next block's first
// key, so blocks below the key are skipped. A key's versions can straddle two blocks, so reading goes on until a separator passes it.
function findInTable(fd, fileSize, index, user) {
  let newest = null;
  for (const { ends, bytes } of index) {
    const order = Buffer.compare(ends, user);
    if (order < 0) continue;
    try {
      for (const [key, value] of blockEntries(readBlock(fd, fileSize, cursor(bytes)))) {
        if (key.length < 8 || !key.subarray(0, -8).equals(user)) continue;
        // The last 8 bytes of a key hold the sequence number and then the type, in 56 bits and 8, so a sequence needs a BigInt.
        const tag = key.readBigUInt64LE(key.length - 8);
        const type = Number(tag & 0xffn);
        const seq = tag >> 8n;
        if ((type === PUT || type === DELETE) && (!newest || seq > newest.seq)) newest = { seq, type, value };
      }
    } catch {
      // A bad block costs the versions in it. The blocks beside it still count.
    }
    if (order > 0) break;
  }
  return newest && { ...newest, value: Buffer.from(newest.value) };
}

function scanTable(fd, fileSize, state, missing) {
  state.index ??= readIndex(fd, fileSize);
  for (const { id, user } of missing) state.found.set(id, findInTable(fd, fileSize, state.index, user));
}

// ---- write-ahead logs (.log) ------------------------------------------------------------------------------------------------

// The logical records of a log, which is cut into 32 KB blocks of physical records. A bad checksum drops the rest of its block,
// as in LevelDB's own reader, because the length that bounded the record cannot be trusted.
function* logRecords(buf) {
  let chain = null;
  let at = 0;
  while (buf.length - at >= HEADER) {
    const room = BLOCK - (at % BLOCK);
    if (room < HEADER) {
      at += room;
      continue;
    }
    const length = buf.readUInt16LE(at + 4);
    const type = buf[at + 6];
    const end = at + HEADER + length;
    if (HEADER + length > room || (type === 0 && length === 0)) {
      chain = null;
      at += room;
      continue;
    }
    // The writer may be part way through this record.
    if (end > buf.length) break;
    if (maskCrc(crc32c(buf, at + 6, end)) !== buf.readUInt32LE(at)) {
      chain = null;
      at += room;
      continue;
    }
    const data = buf.subarray(at + HEADER, end);
    at = end;
    if (type === FULL) {
      chain = null;
      yield data;
    } else if (type === FIRST) {
      chain = [data];
    } else if (type === MIDDLE) {
      chain?.push(data);
    } else if (type === LAST && chain) {
      chain.push(data);
      const whole = Buffer.concat(chain);
      chain = null;
      yield whole;
    } else {
      chain = null;
    }
  }
}

// What a write batch does to the wanted keys, as [id, entry] pairs. It applies as a whole, so one that does not add up is refused.
function batchHits(record, wanted) {
  const cur = cursor(record);
  const base = cur.take(8).readBigUInt64LE();
  const count = cur.uint(4);
  const hits = [];
  for (let n = 0; n < count; n++) {
    const type = cur.byte();
    if (type !== PUT && type !== DELETE) throw new Error('batch entry is unknown');
    const key = cur.take(cur.varint());
    const value = type === PUT ? cur.take(cur.varint()) : EMPTY;
    const want = wanted.find(w => w.user.equals(key));
    if (want) hits.push([want.id, { seq: base + BigInt(n), type, value }]);
  }
  if (cur.left()) throw new Error('batch has bytes after its entries');
  return hits;
}

function scanLog(fd, fileSize, state, missing) {
  const found = new Map(missing.map(w => [w.id, null]));
  for (const record of logRecords(readAt(fd, 0, fileSize))) {
    let hits;
    try {
      hits = batchHits(record, missing);
    } catch {
      continue;
    }
    for (const [id, hit] of hits) if (!found.get(id) || hit.seq > found.get(id).seq) found.set(id, hit);
  }
  for (const [id, entry] of found) state.found.set(id, entry && { ...entry, value: Buffer.from(entry.value) });
}

// ---- the folder -------------------------------------------------------------------------------------------------------------

// What was read from each file of each folder. A table never changes once written and a log only grows, so a file whose size and
// time match the last read gives the same answers and is not opened again.
const dirs = new Map();

// Brings what a file holds for the wanted keys up to date and returns it: each key's newest entry there, or null for none.
// A file that cannot be read gives nothing, and a file that has gone is forgotten.
function entriesIn(dir, files, name, wanted) {
  try {
    const file = path.join(dir, name);
    const { size, mtimeMs } = fs.statSync(file);
    let state = files.get(name);
    if (state?.size !== size || state.mtimeMs !== mtimeMs) {
      state = { size, mtimeMs, index: null, found: new Map() };
      files.set(name, state);
    }
    const missing = wanted.filter(w => !state.found.has(w.id));
    if (missing.length) {
      const fd = fs.openSync(file, 'r');
      try {
        (name.endsWith('.ldb') ? scanTable : scanLog)(fd, fs.fstatSync(fd).size, state, missing);
      } finally {
        fs.closeSync(fd);
      }
    }
    return state.found;
  } catch {
    files.delete(name);
    return new Map();
  }
}

// A stored value starts with a byte for how the rest is encoded: 1 for Latin-1 and 0 for UTF-16LE.
function decodeValue(value) {
  if (value.length === 0) return '';
  if (value[0] === 1) return value.toString('latin1', 1);
  if (value[0] === 0) return value.toString('utf16le', 1);
  return null;
}

const isLatin1 = text => typeof text === 'string' && !/[^\0-\xff]/.test(text);

// Each requested key's current value as a string. A key with no value, or whose newest entry is a deletion, is left out.
// It never throws: what cannot be read is skipped and the rest still counts.
export function readLocalStorage(dir, origin, keys) {
  const out = new Map();
  try {
    // An entry's user key is "_", the origin, a NUL, then 1 for a Latin-1 script key and the key itself.
    const wanted = [...new Set(keys)].filter(isLatin1).map(key => {
      const user = Buffer.concat([Buffer.from(`_${origin}`), Buffer.from([0, 1]), Buffer.from(key, 'latin1')]);
      return { key, user, id: user.toString('latin1') };
    });
    const names = fs.readdirSync(dir).filter(name => /\.(ldb|log)$/.test(name)).sort();
    const files = dirs.get(dir) ?? new Map();
    dirs.set(dir, files);
    const newest = new Map();
    for (const name of names) {
      const found = entriesIn(dir, files, name, wanted);
      for (const { id } of wanted) {
        const entry = found.get(id);
        if (entry && (!newest.has(id) || entry.seq > newest.get(id).seq)) newest.set(id, entry);
      }
    }
    const listed = new Set(names);
    for (const name of files.keys()) if (!listed.has(name)) files.delete(name);
    for (const { key, id } of wanted) {
      const entry = newest.get(id);
      const value = entry?.type === PUT ? decodeValue(entry.value) : null;
      if (value !== null) out.set(key, value);
    }
  } catch {
    dirs.delete(dir);
  }
  return out;
}
