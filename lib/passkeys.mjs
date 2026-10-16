// Passkeys: the credentials this install accepts, kept in passkeys.json, and the one-use challenges that guard each ceremony.
// See docs/adr/20261016-passkeys-on-node-crypto.md.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { deviceLabel } from './device.mjs';
import { ALGORITHMS, b64u, fromB64u, readClientData, verifyAssertion, verifyRegistration } from './webauthn.mjs';

const CHALLENGE_MS = 5 * 60_000;
const MAX_CHALLENGES = 200;
const MAX_PASSKEYS = 25;

export class PasskeyError extends Error {
  constructor(status, message, cause) {
    super(message, { cause });
    this.status = status;
  }
}

// Only these origins are believed, and each one's hostname is its RP ID, so the Host header never picks the RP ID.
// An RP ID has to be a domain name, which rules out 127.0.0.1 and every other IP address.
export function listedOrigins(entries, warn = () => {}) {
  const origins = [];
  for (const entry of [].concat(entries || [])) {
    try {
      const url = new URL(entry);
      if (url.protocol !== 'https:' || net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('it needs https and a name, not an IP address');
      origins.push(url.origin);
    } catch (e) {
      warn(`Ignoring passkeyOrigins entry ${JSON.stringify(entry)}: ${e.message}`);
    }
  }
  return origins;
}

const summary = ({ id, device, rpId, created, used }) => ({ id, device, rpId, created, used });

export function makePasskeys(stateDir, { port, origins = [], now = Date.now, warn } = {}) {
  const file = path.join(stateDir, 'passkeys.json');
  const allowed = new Set([`http://localhost:${port}`, ...listedOrigins(origins, warn)]);
  const challenges = new Map();
  const iso = () => new Date(now()).toISOString();

  // An unreadable file is an error rather than an empty list, so the next write cannot wipe the passkeys.
  const read = () => {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { user: data.user || null, passkeys: Array.isArray(data.passkeys) ? data.passkeys : [] };
    } catch (e) {
      if (e.code === 'ENOENT') return { user: null, passkeys: [] };
      throw new Error(`Cannot read passkeys.json: ${e.message}`);
    }
  };
  const write = data => {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  };

  const rpIdFor = origin => {
    if (typeof origin !== 'string' || !allowed.has(origin)) throw new PasskeyError(400, 'Passkeys are not set up for this address.');
    return new URL(origin).hostname;
  };

  const issue = (kind, origin) => {
    const t = now();
    for (const [value, entry] of challenges) if (t - entry.at > CHALLENGE_MS) challenges.delete(value);
    while (challenges.size >= MAX_CHALLENGES) challenges.delete(challenges.keys().next().value);
    const value = b64u(crypto.randomBytes(32));
    challenges.set(value, { kind, origin, at: t });
    return value;
  };

  // A challenge is spent the moment it is looked up, whether or not the answer that follows is good.
  const spend = (value, kind) => {
    const entry = challenges.get(value);
    challenges.delete(value);
    if (!entry || entry.kind !== kind || now() - entry.at > CHALLENGE_MS) throw new Error('Challenge is unknown, used or expired');
    return entry;
  };

  // One handle per install, random and meaningless, so a passkey manager can tell Capcom's accounts apart.
  const userHandle = () => {
    const data = read();
    if (data.user) return data.user;
    const user = b64u(crypto.randomBytes(32));
    write({ ...data, user });
    return user;
  };

  const answer = body => {
    const response = body.response;
    const clientDataJSON = fromB64u(response.clientDataJSON);
    const { challenge } = readClientData(clientDataJSON);
    return { response, clientDataJSON, challenge };
  };

  return {
    allowed: origin => allowed.has(origin),

    list: () => read().passkeys.map(summary),

    registrationOptions(origin) {
      const rpId = rpIdFor(origin);
      const { passkeys } = read();
      if (passkeys.length >= MAX_PASSKEYS) throw new PasskeyError(409, `Capcom keeps at most ${MAX_PASSKEYS} passkeys. Remove one first.`);
      return {
        challenge: issue('create', origin),
        rp: { id: rpId, name: 'Capcom' },
        user: { id: userHandle(), name: new URL(origin).host, displayName: 'Capcom' },
        pubKeyCredParams: ALGORITHMS.map(alg => ({ type: 'public-key', alg })),
        timeout: CHALLENGE_MS,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        excludeCredentials: passkeys.filter(p => p.rpId === rpId).map(p => ({ type: 'public-key', id: p.id })),
      };
    },

    register(body, userAgent) {
      try {
        const { response, clientDataJSON, challenge } = answer(body);
        const { origin } = spend(challenge, 'create');
        const rpId = rpIdFor(origin);
        const made = verifyRegistration({ clientDataJSON, attestationObject: fromB64u(response.attestationObject) }, { challenge, origin, rpId });
        if (body.id !== made.id) throw new Error('Credential id does not match the one made');
        const data = read();
        if (data.passkeys.some(p => p.id === made.id)) throw new PasskeyError(409, 'That passkey is already added.');
        if (data.passkeys.length >= MAX_PASSKEYS) throw new PasskeyError(409, `Capcom keeps at most ${MAX_PASSKEYS} passkeys. Remove one first.`);
        const passkey = { id: made.id, publicKey: made.publicKey, alg: made.alg, rpId, signCount: made.signCount, created: iso(), used: null, device: deviceLabel(userAgent) };
        write({ ...data, passkeys: [...data.passkeys, passkey] });
        return summary(passkey);
      } catch (e) {
        throw e instanceof PasskeyError ? e : new PasskeyError(400, 'That passkey could not be added.', e);
      }
    },

    authenticationOptions(origin) {
      const rpId = rpIdFor(origin);
      if (!read().passkeys.some(p => p.rpId === rpId)) throw new PasskeyError(404, 'No passkeys are added for this address.');
      return { challenge: issue('get', origin), rpId, timeout: CHALLENGE_MS, userVerification: 'required', allowCredentials: [] };
    },

    authenticate(body) {
      try {
        const { response, clientDataJSON, challenge } = answer(body);
        const { origin } = spend(challenge, 'get');
        const rpId = rpIdFor(origin);
        const data = read();
        const passkey = data.passkeys.find(p => p.id === body.id && p.rpId === rpId);
        if (!passkey) throw new Error('No such passkey for this address');
        if (response.userHandle && response.userHandle !== data.user) throw new Error('Passkey belongs to another install');
        const assertion = { clientDataJSON, authenticatorData: fromB64u(response.authenticatorData), signature: fromB64u(response.signature) };
        const { signCount } = verifyAssertion(assertion, { challenge, origin, rpId }, passkey);
        passkey.signCount = Math.max(passkey.signCount, signCount);
        passkey.used = iso();
        write(data);
        return summary(passkey);
      } catch (e) {
        throw new PasskeyError(401, 'That passkey did not work.', e);
      }
    },

    remove(id) {
      const data = read();
      const passkeys = data.passkeys.filter(p => p.id !== id);
      if (passkeys.length === data.passkeys.length) return false;
      write({ ...data, passkeys });
      return true;
    },
  };
}
