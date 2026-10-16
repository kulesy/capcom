// WebAuthn on node:crypto alone, for a single owner with discoverable credentials and no attestation trust.
// The checks follow https://www.w3.org/TR/webauthn-2/#sctn-registering-a-new-credential and #sctn-verifying-assertion.
import crypto from 'node:crypto';
import { decode, decodeFirst } from './cbor.mjs';

// ES256, EdDSA and RS256, the COSE numbers the browser is asked to choose from.
export const ALGORITHMS = [-7, -8, -257];

const UP = 0x01;
const UV = 0x04;
const AT = 0x40;
const BASE64URL = /^[\w-]*$/;

const sha256 = data => crypto.createHash('sha256').update(data).digest();

export const b64u = bytes => Buffer.from(bytes).toString('base64url');

export function fromB64u(text, max = 20_000) {
  if (typeof text !== 'string' || text.length > max || !BASE64URL.test(text)) throw new Error('Not base64url');
  return Buffer.from(text, 'base64url');
}

export function readClientData(clientDataJSON) {
  let data;
  try { data = JSON.parse(clientDataJSON.toString('utf8')); } catch { throw new Error('Client data is not JSON'); }
  if (!data || typeof data !== 'object') throw new Error('Client data is not an object');
  return data;
}

function checkClientData(clientDataJSON, type, expected) {
  const data = readClientData(clientDataJSON);
  if (data.type !== type) throw new Error('Wrong ceremony type');
  if (data.challenge !== expected.challenge) throw new Error('Wrong challenge');
  if (data.origin !== expected.origin) throw new Error('Wrong origin');
  if (data.crossOrigin === true) throw new Error('Asked from another site');
}

export function parseAuthData(bytes) {
  if (bytes.length < 37) throw new Error('Authenticator data is too short');
  const flags = bytes[32];
  const data = { rpIdHash: bytes.subarray(0, 32), up: !!(flags & UP), uv: !!(flags & UV), signCount: bytes.readUInt32BE(33), credential: null };
  if (flags & AT) {
    if (bytes.length < 55) throw new Error('Authenticator data is too short');
    const idLength = bytes.readUInt16BE(53);
    if (idLength > 1023 || 55 + idLength > bytes.length) throw new Error('Credential id is the wrong length');
    data.credential = { id: bytes.subarray(55, 55 + idLength), key: decodeFirst(bytes, 55 + idLength).value };
  }
  return data;
}

function checkAuthData(data, rpId) {
  if (!crypto.timingSafeEqual(data.rpIdHash, sha256(rpId))) throw new Error('Wrong relying party');
  if (!data.up) throw new Error('User presence is missing');
  if (!data.uv) throw new Error('User verification is missing');
}

// The COSE key (RFC 9053) as a JWK, which is what crypto.createPublicKey takes.
export function coseToJwk(key) {
  if (!(key instanceof Map)) throw new Error('Public key is not a COSE key');
  const alg = key.get(3);
  const kty = key.get(1);
  const part = label => {
    const bytes = key.get(label);
    if (!Buffer.isBuffer(bytes)) throw new Error('Public key is missing a part');
    return bytes;
  };
  if (alg === -7 && kty === 2 && key.get(-1) === 1) {
    const [x, y] = [part(-2), part(-3)];
    if (x.length !== 32 || y.length !== 32) throw new Error('Public key is the wrong size');
    return { alg, jwk: { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) } };
  }
  if (alg === -8 && kty === 1 && key.get(-1) === 6) {
    const x = part(-2);
    if (x.length !== 32) throw new Error('Public key is the wrong size');
    return { alg, jwk: { kty: 'OKP', crv: 'Ed25519', x: b64u(x) } };
  }
  if (alg === -257 && kty === 3) {
    const [n, e] = [part(-1), part(-2)];
    if (n.length < 256 || n.length > 1024) throw new Error('Public key is the wrong size');
    return { alg, jwk: { kty: 'RSA', n: b64u(n), e: b64u(e) } };
  }
  throw new Error('Public key type is not supported');
}

const importKey = jwk => crypto.createPublicKey({ key: jwk, format: 'jwk' });

const P = 2n ** 255n - 19n;
// The y values of the eight Ed25519 points of small order. A key on one of them lets anyone forge a signature.
const SMALL_ORDER_Y = new Set([0n, 1n, P - 1n, 2707385501144840649318225287225658788936804267575313519463743609750303402022n, 55188659117513257062467267217118295137698188065244968500265048394206261417927n]);

// A key that anyone can sign for is a way in with no secret, so the weak keys an attacker might add are refused.
function refuseWeakKey(alg, jwk, key) {
  if (alg === -257) {
    const { modulusLength, publicExponent } = key.asymmetricKeyDetails;
    if (modulusLength < 2048 || publicExponent !== 65537n) throw new Error('RSA key is too weak');
  }
  if (alg === -8) {
    const y = BigInt(`0x${Buffer.from(jwk.x, 'base64url').reverse().toString('hex')}`) & (2n ** 255n - 1n);
    if (SMALL_ORDER_Y.has(y % P)) throw new Error('Ed25519 key has a small order');
  }
}

function signatureOk(jwk, alg, signed, signature) {
  try {
    return crypto.verify(alg === -8 ? null : 'sha256', signed, importKey(jwk), signature);
  } catch {
    return false;
  }
}

// `expected` is { challenge, origin, rpId }, all decided by the server. The attestation statement is not checked,
// because Capcom asks for none and trusts a passkey for being added by the signed-in owner.
export function verifyRegistration({ clientDataJSON, attestationObject }, expected) {
  checkClientData(clientDataJSON, 'webauthn.create', expected);
  const attestation = decode(attestationObject);
  const authData = attestation instanceof Map && attestation.get('authData');
  if (!Buffer.isBuffer(authData)) throw new Error('No authenticator data');
  const data = parseAuthData(authData);
  checkAuthData(data, expected.rpId);
  if (!data.credential) throw new Error('No credential was made');
  const { alg, jwk } = coseToJwk(data.credential.key);
  refuseWeakKey(alg, jwk, importKey(jwk));
  return { id: b64u(data.credential.id), publicKey: jwk, alg, signCount: data.signCount };
}

// WebAuthn says a counter that does not climb is the sign of a cloned authenticator, and that includes a fall back to 0.
export function verifyAssertion({ clientDataJSON, authenticatorData, signature }, expected, credential) {
  checkClientData(clientDataJSON, 'webauthn.get', expected);
  const data = parseAuthData(authenticatorData);
  checkAuthData(data, expected.rpId);
  const signed = Buffer.concat([authenticatorData, sha256(clientDataJSON)]);
  if (!signatureOk(credential.publicKey, credential.alg, signed, signature)) throw new Error('Signature does not match');
  if (credential.signCount && !(data.signCount > credential.signCount)) throw new Error('Signature counter did not increase');
  return { signCount: data.signCount };
}
