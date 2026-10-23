// Run with `npm test`. A software authenticator makes real P-256, Ed25519 and RSA keys and real attestation and assertion
// bytes, and the server side checks them with node:crypto alone. The clock is ours, so a challenge expires without waiting.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listedOrigins, makePasskeys, PasskeyError } from '../lib/passkeys.mjs';
import { verifyRegistration } from '../lib/webauthn.mjs';
import { AT, b64u, cbor, ED, makeAuthenticator, UP, UV } from './authenticator.mjs';

const LOCAL = 'http://localhost:4310';
const SECURE = 'https://capcom.example.test';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-passkeys-test-'));

function rig(opts = {}) {
  const dir = fs.mkdtempSync(path.join(base, 'state-'));
  let t = Date.UTC(2026, 9, 16, 9, 0, 0);
  const passkeys = makePasskeys(dir, { port: 4310, origins: [SECURE], now: () => t, ...opts });
  return { dir, file: path.join(dir, 'passkeys.json'), passkeys, tick: ms => { t += ms; }, now: () => new Date(t).toISOString() };
}

// The page's two steps: ask for options, then hand the authenticator's answer to that challenge back.
function add(r, a, origin = LOCAL, more = {}) {
  const { challenge } = r.passkeys.registrationOptions(origin);
  return r.passkeys.register(a.register({ challenge, origin, ...more }), 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36');
}

function signIn(r, a, { origin = LOCAL, ...more } = {}) {
  const { challenge } = r.passkeys.authenticationOptions(origin);
  return r.passkeys.authenticate(a.assert({ challenge, origin, ...more }));
}

const refuses = (fn, status, reason) => assert.throws(fn, e => {
  assert.ok(e instanceof PasskeyError, e.stack);
  assert.equal(e.status, status);
  if (reason) assert.match(e.cause?.message ?? e.message, reason);
  return true;
});

test('adds a passkey and signs in with it, for each algorithm', () => {
  for (const alg of [-7, -8, -257]) {
    const r = rig();
    const a = makeAuthenticator(alg);
    const added = add(r, a);
    assert.equal(added.id, a.id);
    assert.equal(added.rpId, 'localhost');
    assert.equal(r.passkeys.list().length, 1);
    const used = signIn(r, a);
    assert.equal(used.id, a.id);
    assert.equal(used.used, r.now());
  }
});

test('asks the browser for a discoverable credential with user verification and no attestation', () => {
  const r = rig();
  const options = r.passkeys.registrationOptions(LOCAL);
  assert.equal(options.rp.id, 'localhost');
  assert.equal(options.attestation, 'none');
  assert.deepEqual(options.authenticatorSelection, { residentKey: 'required', requireResidentKey: true, userVerification: 'required' });
  assert.deepEqual(options.pubKeyCredParams.map(p => p.alg), [-7, -8, -257]);
  assert.equal(Buffer.from(options.challenge, 'base64url').length, 32);
  assert.equal(Buffer.from(options.user.id, 'base64url').length, 32);
  assert.deepEqual(options.excludeCredentials, []);
  assert.notEqual(r.passkeys.registrationOptions(LOCAL).challenge, options.challenge);
});

test('shows a passkey manager the name GhostShell, while the RP ID stays the host name of the address', () => {
  const r = rig();
  for (const [origin, rpId] of [[LOCAL, 'localhost'], [SECURE, 'capcom.example.test']]) {
    const { rp, user } = r.passkeys.registrationOptions(origin);
    assert.deepEqual([rp.name, user.displayName, rp.id], ['GhostShell', 'GhostShell', rpId]);
  }
});

test('keeps one user handle per install and lists the passkeys already added to stop a second', () => {
  const r = rig();
  const first = r.passkeys.registrationOptions(LOCAL);
  const a = makeAuthenticator();
  add(r, a);
  const again = r.passkeys.registrationOptions(LOCAL);
  assert.equal(again.user.id, first.user.id);
  assert.deepEqual(again.excludeCredentials, [{ type: 'public-key', id: a.id }]);
  assert.deepEqual(r.passkeys.registrationOptions(SECURE).excludeCredentials, []);
  refuses(() => add(r, a), 409, undefined);
});

test('stores what it needs in a file only the owner can read', () => {
  const r = rig();
  const a = makeAuthenticator();
  add(r, a);
  assert.equal(fs.statSync(r.file).mode & 0o777, 0o600);
  const saved = JSON.parse(fs.readFileSync(r.file, 'utf8'));
  assert.equal(saved.user.length, 43);
  assert.deepEqual(Object.keys(saved.passkeys[0]).sort(), ['alg', 'created', 'device', 'id', 'publicKey', 'rpId', 'signCount', 'used']);
  assert.equal(saved.passkeys[0].device, 'Chrome 141 on macOS');
  assert.equal(saved.passkeys[0].publicKey.kty, 'EC');
  assert.equal(saved.passkeys[0].used, null);
  assert.equal(saved.passkeys[0].created, r.now());
});

test('only believes an origin it was told about, and takes the RP ID from that origin', () => {
  const r = rig();
  for (const origin of ['https://evil.example', 'http://127.0.0.1:4310', 'http://localhost:9999', 'http://capcom.example.test', 'https://localhost:4310', undefined, 42]) {
    refuses(() => r.passkeys.registrationOptions(origin), 400, /not set up/);
    refuses(() => r.passkeys.authenticationOptions(origin), 400, /not set up/);
  }
  assert.equal(r.passkeys.registrationOptions(SECURE).rp.id, 'capcom.example.test');
  assert.equal(r.passkeys.allowed(LOCAL), true);
  assert.equal(r.passkeys.allowed('http://127.0.0.1:4310'), false);
});

test('lists only https names for the passkey origins, never an IP address', () => {
  const warned = [];
  const kept = listedOrigins(['https://ok.example.test/path?x=1', 'https://127.0.0.1', 'https://[::1]', 'http://example.test', 'nonsense', 'https://other.example.test:8443'], m => warned.push(m));
  assert.deepEqual(kept, ['https://ok.example.test', 'https://other.example.test:8443']);
  assert.equal(warned.length, 4);
  assert.deepEqual(listedOrigins(undefined), []);
});

test('refuses an answer from another origin than the one the challenge was issued for', () => {
  const r = rig();
  const a = makeAuthenticator();
  const { challenge } = r.passkeys.registrationOptions(LOCAL);
  refuses(() => r.passkeys.register(a.register({ challenge, origin: SECURE }), 'ua'), 400, /Wrong origin/);
  add(r, a);
  const options = r.passkeys.authenticationOptions(LOCAL);
  refuses(() => r.passkeys.authenticate(a.assert({ challenge: options.challenge, origin: SECURE })), 401, /Wrong origin/);
});

test('refuses an answer for another RP ID', () => {
  const r = rig();
  const a = makeAuthenticator();
  const { challenge } = r.passkeys.registrationOptions(LOCAL);
  refuses(() => r.passkeys.register(a.register({ challenge, origin: LOCAL, rpId: 'example.test' }), 'ua'), 400, /Wrong relying party/);
  add(r, a);
  const options = r.passkeys.authenticationOptions(LOCAL);
  refuses(() => r.passkeys.authenticate(a.assert({ challenge: options.challenge, origin: LOCAL, rpId: 'example.test' })), 401, /Wrong relying party/);
});

test('spends a challenge on first use, and refuses one it never issued', () => {
  const r = rig();
  const a = makeAuthenticator();
  add(r, a);
  const { challenge } = r.passkeys.authenticationOptions(LOCAL);
  const answer = a.assert({ challenge, origin: LOCAL });
  r.passkeys.authenticate(answer);
  refuses(() => r.passkeys.authenticate(answer), 401, /unknown, used or expired/);
  const invented = b64u(Buffer.alloc(32, 9));
  refuses(() => r.passkeys.authenticate(a.assert({ challenge: invented, origin: LOCAL })), 401, /unknown, used or expired/);
});

test('spends the challenge even when the answer is wrong', () => {
  const r = rig();
  const a = makeAuthenticator();
  add(r, a);
  const { challenge } = r.passkeys.authenticationOptions(LOCAL);
  refuses(() => r.passkeys.authenticate(a.assert({ challenge, origin: LOCAL, tamper: true })), 401, /Signature/);
  refuses(() => r.passkeys.authenticate(a.assert({ challenge, origin: LOCAL })), 401, /unknown, used or expired/);
});

test('refuses a challenge after five minutes', () => {
  const r = rig();
  const a = makeAuthenticator();
  const { challenge } = r.passkeys.registrationOptions(LOCAL);
  r.tick(5 * 60_000 + 1);
  refuses(() => r.passkeys.register(a.register({ challenge, origin: LOCAL }), 'ua'), 400, /expired/);
  add(r, a);
  const options = r.passkeys.authenticationOptions(LOCAL);
  r.tick(4 * 60_000 + 59_000);
  r.passkeys.authenticate(a.assert({ challenge: options.challenge, origin: LOCAL }));
  const late = r.passkeys.authenticationOptions(LOCAL);
  r.tick(5 * 60_000 + 1);
  refuses(() => r.passkeys.authenticate(a.assert({ challenge: late.challenge, origin: LOCAL })), 401, /expired/);
});

test('does not take a challenge made for sign-in as one for adding a passkey', () => {
  const r = rig();
  const a = makeAuthenticator();
  add(r, a);
  const { challenge } = r.passkeys.authenticationOptions(LOCAL);
  refuses(() => r.passkeys.register(makeAuthenticator().register({ challenge, origin: LOCAL }), 'ua'), 400, /unknown, used or expired/);
});

test('needs user presence and user verification, when adding and when signing in', () => {
  const r = rig();
  const a = makeAuthenticator();
  const { challenge } = r.passkeys.registrationOptions(LOCAL);
  refuses(() => r.passkeys.register(a.register({ challenge, origin: LOCAL, flags: UP | AT }), 'ua'), 400, /verification is missing/);
  const second = r.passkeys.registrationOptions(LOCAL);
  refuses(() => r.passkeys.register(a.register({ challenge: second.challenge, origin: LOCAL, flags: UV | AT }), 'ua'), 400, /presence is missing/);
  add(r, a);
  refuses(() => signIn(r, a, { flags: UP }), 401, /verification is missing/);
  refuses(() => signIn(r, a, { flags: UV }), 401, /presence is missing/);
});

test('refuses a signature that does not match, or client data changed after signing', () => {
  const r = rig();
  const a = makeAuthenticator();
  add(r, a);
  refuses(() => signIn(r, a, { tamper: true }), 401, /Signature does not match/);
  const { challenge } = r.passkeys.authenticationOptions(LOCAL);
  const answer = a.assert({ challenge, origin: LOCAL });
  const changed = JSON.parse(Buffer.from(answer.response.clientDataJSON, 'base64url'));
  answer.response.clientDataJSON = b64u(JSON.stringify({ ...changed, extra: 'added' }));
  refuses(() => r.passkeys.authenticate(answer), 401, /Signature does not match/);
});

test('refuses a signature from a key that is not the one added', () => {
  const r = rig();
  const real = makeAuthenticator();
  add(r, real);
  const forger = makeAuthenticator();
  const { challenge } = r.passkeys.authenticationOptions(LOCAL);
  const answer = forger.assert({ challenge, origin: LOCAL });
  answer.id = real.id;
  refuses(() => r.passkeys.authenticate(answer), 401, /Signature does not match/);
});

test('refuses a counter that goes backwards, stands still or falls to zero, once the passkey has counted', () => {
  const r = rig();
  const a = makeAuthenticator();
  add(r, a);
  signIn(r, a, { signCount: 5 });
  refuses(() => signIn(r, a, { signCount: 3 }), 401, /counter did not increase/);
  refuses(() => signIn(r, a, { signCount: 5 }), 401, /counter did not increase/);
  refuses(() => signIn(r, a, { signCount: 0 }), 401, /counter did not increase/);
  assert.equal(JSON.parse(fs.readFileSync(r.file, 'utf8')).passkeys[0].signCount, 5);
  signIn(r, a, { signCount: 6 });
  assert.equal(JSON.parse(fs.readFileSync(r.file, 'utf8')).passkeys[0].signCount, 6);
});

test('accepts a passkey that never counts, and one that starts counting after signing in at zero', () => {
  const r = rig();
  const zero = makeAuthenticator();
  add(r, zero);
  for (let i = 0; i < 3; i++) signIn(r, zero, { signCount: 0 });
  signIn(r, zero, { signCount: 7 });
  refuses(() => signIn(r, zero, { signCount: 0 }), 401, /counter did not increase/);
  const counting = makeAuthenticator(-8);
  add(r, counting);
  signIn(r, counting, { signCount: 4 });
  refuses(() => signIn(r, counting, { signCount: 4 }), 401, /counter did not increase/);
  signIn(r, counting, { signCount: 5 });
});

test('refuses a passkey it does not know, or one made for another RP ID', () => {
  const r = rig();
  add(r, makeAuthenticator());
  refuses(() => signIn(r, makeAuthenticator()), 401, /No such passkey/);
  const remote = makeAuthenticator();
  add(r, remote, SECURE);
  const { challenge } = r.passkeys.authenticationOptions(LOCAL);
  refuses(() => r.passkeys.authenticate(remote.assert({ challenge, origin: LOCAL })), 401, /No such passkey/);
});

test('offers sign-in only for an address that has a passkey', () => {
  const r = rig();
  refuses(() => r.passkeys.authenticationOptions(LOCAL), 404, undefined);
  add(r, makeAuthenticator(), SECURE);
  refuses(() => r.passkeys.authenticationOptions(LOCAL), 404, undefined);
  assert.equal(r.passkeys.authenticationOptions(SECURE).rpId, 'capcom.example.test');
  assert.deepEqual(r.passkeys.authenticationOptions(SECURE).allowCredentials, []);
});

test('checks the user handle when the browser sends one', () => {
  const r = rig();
  const a = makeAuthenticator();
  const handle = r.passkeys.registrationOptions(LOCAL).user.id;
  add(r, a);
  signIn(r, a, { signCount: 1, userHandle: handle });
  signIn(r, a, { signCount: 2, userHandle: null });
  refuses(() => signIn(r, a, { signCount: 3, userHandle: b64u(Buffer.alloc(32, 1)) }), 401, /another install/);
});

test('refuses the wrong ceremony type and a request from inside another site', () => {
  const r = rig();
  const a = makeAuthenticator();
  const { challenge } = r.passkeys.registrationOptions(LOCAL);
  refuses(() => r.passkeys.register(a.register({ challenge, origin: LOCAL, type: 'webauthn.get' }), 'ua'), 400, /Wrong ceremony/);
  const second = r.passkeys.registrationOptions(LOCAL);
  refuses(() => r.passkeys.register(a.register({ challenge: second.challenge, origin: LOCAL, more: { crossOrigin: true } }), 'ua'), 400, /another site/);
  add(r, a);
  refuses(() => signIn(r, a, { type: 'webauthn.create' }), 401, /Wrong ceremony/);
});

test('checks the challenge inside the client data against the one the caller expected', () => {
  const a = makeAuthenticator();
  const { response } = a.register({ challenge: 'asked-for', origin: LOCAL });
  const made = { clientDataJSON: Buffer.from(response.clientDataJSON, 'base64url'), attestationObject: Buffer.from(response.attestationObject, 'base64url') };
  const expected = { challenge: 'asked-for', origin: LOCAL, rpId: 'localhost' };
  assert.equal(verifyRegistration(made, expected).id, a.id);
  assert.throws(() => verifyRegistration(made, { ...expected, challenge: 'something-else' }), /Wrong challenge/);
});

test('adds a passkey whatever attestation statement came with it, because none is trusted', () => {
  const r = rig();
  const a = makeAuthenticator();
  add(r, a, LOCAL, { fmt: 'packed', attStmt: new Map([['alg', -7], ['sig', Buffer.alloc(8)], ['x5c', [Buffer.alloc(4)]]]) });
  assert.equal(r.passkeys.list().length, 1);
});

test('reads a key that is followed by extension data', () => {
  const r = rig();
  const a = makeAuthenticator(-8);
  add(r, a, LOCAL, { flags: UP | UV | AT | ED, extra: cbor(new Map([['credProtect', 2]])) });
  signIn(r, a);
});

test('refuses a credential id that is not the one in the attestation', () => {
  const r = rig();
  const a = makeAuthenticator();
  const { challenge } = r.passkeys.registrationOptions(LOCAL);
  const body = a.register({ challenge, origin: LOCAL });
  body.id = b64u(Buffer.alloc(32, 3));
  refuses(() => r.passkeys.register(body, 'ua'), 400, /does not match/);
});

function refusesEachKey(refusedKeys) {
  const r = rig();
  const a = makeAuthenticator();
  for (const [name, [publicKey, reason]] of Object.entries(refusedKeys)) {
    const { challenge } = r.passkeys.registrationOptions(LOCAL);
    refuses(() => r.passkeys.register(a.register({ challenge, origin: LOCAL, publicKey }), 'ua'), 400, reason);
    assert.equal(r.passkeys.list().length, 0, name);
  }
}

test('refuses public keys of a kind or size it did not ask for', () => {
  refusesEachKey({
    'ES384': [new Map([[1, 2], [3, -35], [-1, 2], [-2, Buffer.alloc(48, 1)], [-3, Buffer.alloc(48, 2)]]), /not supported/],
    'a short coordinate': [new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(31, 1)], [-3, Buffer.alloc(32, 2)]]), /wrong size/],
    'a point that is not on the curve': [new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(32, 1)], [-3, Buffer.alloc(32, 2)]]), /JWK/],
    'a 1024 bit RSA key': [new Map([[1, 3], [3, -257], [-1, Buffer.alloc(128, 7)], [-2, Buffer.from([1, 0, 1])]]), /wrong size/],
    'a missing part': [new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(32, 1)]]), /missing a part/],
  });
});

test('refuses keys that anyone could sign for', () => {
  const modulus = bits => Buffer.from(crypto.generateKeyPairSync('rsa', { modulusLength: bits }).publicKey.export({ format: 'jwk' }).n, 'base64url');
  const rsaKey = (n, e) => new Map([[1, 3], [3, -257], [-1, n], [-2, Buffer.from(e)]]);
  const P = 2n ** 255n - 19n;
  const edKey = y => new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(y.toString(16).padStart(64, '0'), 'hex').reverse()]]);
  refusesEachKey({
    'an RSA key with exponent 1': [rsaKey(modulus(2048), [1]), /too weak/],
    'a 512 bit RSA key padded to look like 2048 bits': [rsaKey(Buffer.concat([Buffer.alloc(192), modulus(512)]), [1, 0, 1]), /too weak/],
    'the Ed25519 identity': [edKey(1n), /small order/],
    'the Ed25519 identity written with a y above p': [edKey(1n + P), /small order/],
    'the Ed25519 point of order two': [edKey(P - 1n), /small order/],
    'an Ed25519 point of order four': [edKey(0n), /small order/],
    'an Ed25519 point of order eight': [edKey(2707385501144840649318225287225658788936804267575313519463743609750303402022n), /small order/],
    'the other Ed25519 points of order eight': [edKey(55188659117513257062467267217118295137698188065244968500265048394206261417927n), /small order/],
  });
});

test('removes a passkey and keeps the handle for the next one', () => {
  const r = rig();
  const a = makeAuthenticator();
  const handle = r.passkeys.registrationOptions(LOCAL).user.id;
  add(r, a);
  assert.equal(r.passkeys.remove(a.id), true);
  assert.equal(r.passkeys.remove(a.id), false);
  assert.deepEqual(r.passkeys.list(), []);
  assert.equal(r.passkeys.registrationOptions(LOCAL).user.id, handle);
  refuses(() => signIn(r, a), 404, undefined);
});

test('lists a passkey without its key', () => {
  const r = rig();
  add(r, makeAuthenticator());
  const [item] = r.passkeys.list();
  assert.deepEqual(Object.keys(item).sort(), ['created', 'device', 'id', 'rpId', 'used']);
});

test('keeps the challenges it holds to a fixed number', () => {
  const r = rig();
  const a = makeAuthenticator();
  add(r, a);
  const first = r.passkeys.authenticationOptions(LOCAL).challenge;
  let last;
  for (let i = 0; i < 250; i++) last = r.passkeys.authenticationOptions(LOCAL).challenge;
  refuses(() => r.passkeys.authenticate(a.assert({ challenge: first, origin: LOCAL })), 401, /unknown, used or expired/);
  r.passkeys.authenticate(a.assert({ challenge: last, origin: LOCAL }));
});

test('keeps at most 25 passkeys', () => {
  const r = rig();
  for (let i = 0; i < 25; i++) add(r, makeAuthenticator());
  refuses(() => r.passkeys.registrationOptions(LOCAL), 409, /^GhostShell keeps at most 25 passkeys\. Remove one first\.$/);
});

test('works again after a restart, because passkeys live in the file and challenges do not', () => {
  const r = rig();
  const a = makeAuthenticator();
  add(r, a);
  const { challenge } = r.passkeys.authenticationOptions(LOCAL);
  const restarted = makePasskeys(r.dir, { port: 4310, origins: [SECURE], now: () => Date.UTC(2026, 9, 16, 9, 1, 0) });
  refuses(() => restarted.authenticate(a.assert({ challenge, origin: LOCAL })), 401, /unknown, used or expired/);
  const fresh = restarted.authenticationOptions(LOCAL);
  restarted.authenticate(a.assert({ challenge: fresh.challenge, origin: LOCAL }));
});

test('will not write over a passkeys file it cannot read', () => {
  const r = rig();
  fs.writeFileSync(r.file, '{ not json');
  assert.throws(() => r.passkeys.list(), /Cannot read passkeys.json/);
  assert.throws(() => r.passkeys.registrationOptions(LOCAL), /Cannot read passkeys.json/);
  assert.equal(fs.readFileSync(r.file, 'utf8'), '{ not json');
});

test('answers a malformed body with a refusal, not a crash', () => {
  const r = rig();
  add(r, makeAuthenticator());
  for (const body of [{}, { response: null }, { response: { clientDataJSON: '!!' } }, { id: 'x', response: { clientDataJSON: b64u('not json') } }, null]) {
    refuses(() => r.passkeys.authenticate(body), 401, undefined);
    refuses(() => r.passkeys.register(body, 'ua'), 400, undefined);
  }
});
