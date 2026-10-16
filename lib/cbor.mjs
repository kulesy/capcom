// A small CBOR reader (RFC 8949) for the two things WebAuthn sends as CBOR: the attestation object and the COSE public key.
// It takes definite lengths and the types those two use, and throws on anything else.
const MAX_DEPTH = 8;

// Reads one item starting at `start` and says where it ended, because the COSE key sits inside authenticator data with other bytes after it.
export function decodeFirst(buf, start = 0) {
  let at = start;

  const take = n => {
    if (n > buf.length - at) throw new Error('CBOR ends early');
    at += n;
    return buf.subarray(at - n, at);
  };

  const length = info => {
    if (info < 24) return info;
    const width = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
    if (!width) throw new Error('CBOR length not supported');
    const bytes = take(width);
    const n = width === 8 ? Number(bytes.readBigUInt64BE()) : bytes.readUIntBE(0, width);
    if (!Number.isSafeInteger(n)) throw new Error('CBOR number too large');
    return n;
  };

  const item = depth => {
    if (depth > MAX_DEPTH) throw new Error('CBOR nests too deeply');
    const head = take(1)[0];
    const major = head >> 5;
    const info = head & 31;
    if (major === 7) {
      if (info === 20 || info === 21) return info === 21;
      if (info === 22) return null;
      throw new Error('CBOR simple value not supported');
    }
    const n = length(info);
    if (major === 0) return n;
    if (major === 1) return -1 - n;
    if (major === 2) return Buffer.from(take(n));
    if (major === 3) return take(n).toString('utf8');
    if (major === 6) throw new Error('CBOR tags not supported');
    // Every element takes a byte at least, so a count beyond what is left is a lie that would otherwise loop.
    if (n > buf.length - at) throw new Error('CBOR ends early');
    if (major === 4) return Array.from({ length: n }, () => item(depth + 1));
    const map = new Map();
    for (let i = 0; i < n; i++) {
      const key = item(depth + 1);
      if (typeof key !== 'number' && typeof key !== 'string') throw new Error('CBOR map key not supported');
      if (map.has(key)) throw new Error('CBOR map repeats a key');
      map.set(key, item(depth + 1));
    }
    return map;
  };

  const value = item(0);
  return { value, end: at };
}

export function decode(buf) {
  const { value, end } = decodeFirst(buf);
  if (end !== buf.length) throw new Error('CBOR has bytes after the item');
  return value;
}
