// A software authenticator for the tests. It makes real keys and real CBOR, and returns the same strings a browser would send.
import crypto from 'node:crypto';

export const UP = 0x01;
export const UV = 0x04;
export const AT = 0x40;
export const ED = 0x80;

export const sha256 = data => crypto.createHash('sha256').update(data).digest();
export const b64u = bytes => Buffer.from(bytes).toString('base64url');

function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) {
    const out = Buffer.alloc(3);
    out[0] = (major << 5) | 25;
    out.writeUInt16BE(n, 1);
    return out;
  }
  const out = Buffer.alloc(5);
  out[0] = (major << 5) | 26;
  out.writeUInt32BE(n, 1);
  return out;
}

export function cbor(value) {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value);
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  if (typeof value === 'boolean') return Buffer.from([value ? 0xf5 : 0xf4]);
  if (value === null) return Buffer.from([0xf6]);
  throw new Error('The test encoder cannot write that');
}

export function authData({ rpId, flags, signCount = 0, credential, extra }) {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(signCount);
  const parts = [sha256(rpId), Buffer.from([flags]), counter];
  if (credential) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(credential.id.length);
    parts.push(Buffer.alloc(16), length, credential.id, cbor(credential.key));
  }
  if (extra) parts.push(extra);
  return Buffer.concat(parts);
}

const clientData = (type, challenge, origin, more = {}) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false, ...more }));

export function makeAuthenticator(alg = -7) {
  const pair = alg === -7 ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    : alg === -8 ? crypto.generateKeyPairSync('ed25519')
    : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const part = name => Buffer.from(jwk[name], 'base64url');
  const key = alg === -7 ? new Map([[1, 2], [3, -7], [-1, 1], [-2, part('x')], [-3, part('y')]])
    : alg === -8 ? new Map([[1, 1], [3, -8], [-1, 6], [-2, part('x')]])
    : new Map([[1, 3], [3, -257], [-1, part('n')], [-2, part('e')]]);
  const id = crypto.randomBytes(32);
  const sign = data => crypto.sign(alg === -8 ? null : 'sha256', data, pair.privateKey);

  return {
    alg,
    id: b64u(id),
    key,

    // The answer to navigator.credentials.create, as the page forwards it.
    register({ challenge, origin, rpId = new URL(origin).hostname, flags = UP | UV | AT, signCount = 0, type = 'webauthn.create', fmt = 'none', attStmt = new Map(), more, extra, publicKey = key } = {}) {
      const json = clientData(type, challenge, origin, more);
      const data = authData({ rpId, flags, signCount, credential: { id, key: publicKey }, extra });
      const attestationObject = cbor(new Map([['fmt', fmt], ['attStmt', attStmt], ['authData', data]]));
      return { id: b64u(id), response: { clientDataJSON: b64u(json), attestationObject: b64u(attestationObject) } };
    },

    // The answer to navigator.credentials.get.
    assert({ challenge, origin, rpId = new URL(origin).hostname, flags = UP | UV, signCount = 1, type = 'webauthn.get', userHandle = null, tamper = false, more } = {}) {
      const json = clientData(type, challenge, origin, more);
      const data = authData({ rpId, flags, signCount });
      const signature = sign(Buffer.concat([data, sha256(json)]));
      if (tamper) signature[signature.length - 1] ^= 1;
      return { id: b64u(id), response: { clientDataJSON: b64u(json), authenticatorData: b64u(data), signature: b64u(signature), userHandle } };
    },
  };
}
