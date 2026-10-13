// One password, set from the Mac with `npm run set-password`, kept only as a scrypt hash.
// Browsers that sign in get a random token in an HttpOnly cookie, remembered for 30 days.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DAYS_30 = 30 * 24 * 3600_000;
const failures = [];

export function makeAuth(stateDir) {
  const authFile = path.join(stateDir, 'auth.json');
  const tokenFile = path.join(stateDir, 'tokens.json');
  let tokens = {};
  try { tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8')); } catch {}
  const save = () => fs.writeFileSync(tokenFile, JSON.stringify(tokens), { mode: 0o600 });

  const readSecret = () => { try { return JSON.parse(fs.readFileSync(authFile, 'utf8')); } catch { return null; } };

  return {
    hasPassword: () => !!readSecret(),

    // Ten wrong passwords in 15 minutes locks sign-in for the rest of that window.
    verify(password) {
      const now = Date.now();
      while (failures.length && now - failures[0] > 15 * 60_000) failures.shift();
      if (failures.length >= 10) return { ok: false, locked: true };
      const secret = readSecret();
      if (!secret || typeof password !== 'string') return { ok: false };
      const hash = crypto.scryptSync(password, Buffer.from(secret.salt, 'hex'), 64);
      const ok = crypto.timingSafeEqual(hash, Buffer.from(secret.hash, 'hex'));
      if (!ok) failures.push(now);
      return { ok };
    },

    issue() {
      const token = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      for (const [t, exp] of Object.entries(tokens)) if (exp < now) delete tokens[t];
      tokens[token] = now + DAYS_30;
      save();
      return token;
    },

    check(req) {
      const token = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith('capcom='))?.slice(7);
      return !!token && tokens[token] > Date.now() ? token : null;
    },

    revoke(token) {
      delete tokens[token];
      save();
    },
  };
}

export function writePassword(stateDir, password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  fs.writeFileSync(path.join(stateDir, 'auth.json'), JSON.stringify({ salt: salt.toString('hex'), hash: hash.toString('hex') }), { mode: 0o600 });
  fs.writeFileSync(path.join(stateDir, 'tokens.json'), '{}', { mode: 0o600 });
}
