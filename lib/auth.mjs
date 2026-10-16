// One password, set from the Mac with `npm run set-password`, kept only as a scrypt hash.
// A browser that signs in gets a random token in an HttpOnly cookie, good for a year after it was last used.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deviceLabel } from './device.mjs';

const DAY = 24 * 3600_000;
export const LIFETIME_S = 365 * 24 * 3600;
const LIFETIME_MS = LIFETIME_S * 1000;
const LOCK_AFTER = 10;
const LOCK_WINDOW = 15 * 60_000;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// NOTE: [16 Oct 2026] EK - Lax sends the cookie on a link from another site, which Strict withheld (Chrome 155 then showed the sign-in
// page). That is safe only while every GET stays read-only and every write stays a POST behind sameOrigin in server.mjs.
export const sessionCookie = (token, seconds, secure) => `capcom=${token}; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;

// A proxy that ends TLS says so in X-Forwarded-Proto. It is believed only from a loopback peer, so a client that reaches
// Capcom directly cannot ask for a Secure cookie that its own http page would then refuse to send back.
export function overHttps(req) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return false;
  return String(req.headers['x-forwarded-proto'] || '').split(',').pop().trim().toLowerCase() === 'https';
}

const iso = t => new Date(t).toISOString();

// Written beside the file and renamed over it, so a running server never reads half of a file that set-password is replacing.
function replaceFile(file, text) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text, { mode: 0o600 });
  fs.renameSync(temp, file);
}

// Tokens used to be { token: expiry in ms }. The old 30 day lifetime puts the issue time 30 days before the expiry.
function migrate(raw) {
  const tokens = {};
  for (const [token, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (typeof value === 'number') tokens[token] = { created: iso(value - 30 * DAY), used: null, expires: iso(value), device: null };
    else if (value && typeof value.expires === 'string') tokens[token] = value;
  }
  return tokens;
}

export function makeAuth(stateDir, { now = Date.now } = {}) {
  const authFile = path.join(stateDir, 'auth.json');
  const tokenFile = path.join(stateDir, 'tokens.json');
  const failures = [];
  const renewed = new Set();
  let tokens = {};
  let stamp;

  const stampOf = () => { try { const s = fs.statSync(tokenFile); return `${s.mtimeMs}:${s.size}`; } catch { return null; } };

  // `npm run set-password` empties tokens.json from another process, so a change on disk wins over what is held here.
  const load = () => {
    const seen = stampOf();
    if (seen === stamp) return;
    stamp = seen;
    try { tokens = migrate(JSON.parse(fs.readFileSync(tokenFile, 'utf8'))); } catch { tokens = {}; }
  };

  const save = () => {
    replaceFile(tokenFile, JSON.stringify(tokens));
    stamp = stampOf();
  };

  const find = token => (token && Object.hasOwn(tokens, token) ? tokens[token] : null);

  const readSecret = () => { try { return JSON.parse(fs.readFileSync(authFile, 'utf8')); } catch { return null; } };

  // Ten failures in 15 minutes, from the password or a passkey alike, lock sign-in for the rest of that window.
  const locked = () => {
    const t = now();
    while (failures.length && t - failures[0] > LOCK_WINDOW) failures.shift();
    return failures.length >= LOCK_AFTER;
  };
  const fail = () => { failures.push(now()); };

  return {
    hasPassword: () => !!readSecret(),

    locked,
    fail,

    verify(password) {
      if (locked()) return { ok: false, locked: true };
      const secret = readSecret();
      if (!secret || typeof password !== 'string') return { ok: false };
      const hash = crypto.scryptSync(password, Buffer.from(secret.salt, 'hex'), 64);
      const ok = crypto.timingSafeEqual(hash, Buffer.from(secret.hash, 'hex'));
      if (!ok) fail();
      return { ok };
    },

    issue(userAgent) {
      load();
      const t = now();
      for (const [token, record] of Object.entries(tokens)) if (Date.parse(record.expires) < t) delete tokens[token];
      const token = crypto.randomBytes(32).toString('hex');
      tokens[token] = { created: iso(t), used: iso(t), expires: iso(t + LIFETIME_MS), device: deviceLabel(userAgent) };
      save();
      return token;
    },

    check(req) {
      load();
      const token = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith('capcom='))?.slice(7);
      const record = find(token);
      return record && Date.parse(record.expires) > now() ? token : null;
    },

    // Using a token pushes its expiry a year out. It is written at most once a day, which is also how often the cookie is re-sent.
    touch(token, userAgent) {
      load();
      const record = find(token);
      const t = now();
      if (!record || (record.used && t - Date.parse(record.used) < DAY)) return;
      record.used = iso(t);
      record.expires = iso(t + LIFETIME_MS);
      record.device ||= deviceLabel(userAgent);
      renewed.add(token);
      save();
    },

    // True once after each renewal, so a cookie that Max-Age would let lapse is re-sent and a fresh one is left alone.
    cookieDue: token => renewed.delete(token),

    revoke(token) {
      load();
      renewed.delete(token);
      delete tokens[token];
      save();
    },
  };
}

// A new password signs every browser out and removes every passkey, so a passkey added with a stolen cookie cannot outlast it.
export function writePassword(stateDir, password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  replaceFile(path.join(stateDir, 'auth.json'), JSON.stringify({ salt: salt.toString('hex'), hash: hash.toString('hex') }));
  replaceFile(path.join(stateDir, 'tokens.json'), '{}');
  replaceFile(path.join(stateDir, 'passkeys.json'), '{"passkeys":[]}');
}
