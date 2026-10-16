// Run with `npm test`. Each test starts the real server on a free port, with its own home and state folders, and talks to it
// over HTTP, so the cookie headers, the route order and the lockout are checked where they are wired together.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { writePassword } from '../lib/auth.mjs';
import { makeAuthenticator } from './authenticator.mjs';
import { as, CHROME, PASSWORD, request, signIn, start, tokenIn } from './harness.mjs';

const DAY = 24 * 3600_000;
const COOKIE = /^capcom=[0-9a-f]{64}; HttpOnly; SameSite=Lax; Max-Age=\d+$/;
const HTTPS = { 'x-forwarded-proto': 'https' };
const listUrl = origin => `/api/passkeys?origin=${encodeURIComponent(origin)}`;
const maxAge = cookie => Number(/; Max-Age=(\d+)/.exec(cookie)[1]);
const closeTo = (seconds, days) => Math.abs(seconds - days * 86400) <= 5;

function rewriteTokens(s, change) {
  const tokens = JSON.parse(fs.readFileSync(s.tokens, 'utf8'));
  change(tokens);
  fs.writeFileSync(s.tokens, JSON.stringify(tokens));
}

test('a password sign-in sets a 90 day cookie, adds Secure only behind an https proxy, and lands on the signed-in page', async () => {
  const s = await start();
  const wrong = await request(s, 'POST', '/login', { form: { password: 'not it' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers['set-cookie'], undefined);
  assert.match(wrong.text, /That password did not match/);

  const plain = await signIn(s);
  assert.equal(plain.res.headers.location, './?signed-in');
  assert.match(plain.cookie, COOKIE);
  assert.ok(closeTo(maxAge(plain.cookie), 90), plain.cookie);

  const secure = (await signIn(s, HTTPS)).cookie;
  assert.match(secure, /; Secure$/);
  assert.ok(closeTo(maxAge(secure), 90), secure);
  assert.doesNotMatch((await signIn(s, { 'x-forwarded-proto': 'http' })).cookie, /Secure/);
});

test('a write must come from this host over the scheme it arrived on, on an http mount and behind a loopback https proxy', async () => {
  const s = await start();
  const here = `localhost:${s.port}`;
  const attempt = ({ host = here, origin, proto }) => request(s, 'POST', '/login', {
    form: { password: PASSWORD },
    headers: { 'user-agent': CHROME, host, ...(origin && { origin }), ...(proto && { 'x-forwarded-proto': proto }) },
  });
  const proxy = { host: 'capcom.example.test', proto: 'https' };
  const cases = [
    ['http, no Origin', {}, 303],
    ['http, same origin', { origin: `http://${here}` }, 303],
    ['http, an https Origin for the same host', { origin: `https://${here}` }, 403],
    ['http, another port', { origin: `http://localhost:${s.port + 1}` }, 403],
    ['http, another host', { origin: 'http://evil.example' }, 403],
    ['http, an opaque origin', { origin: 'null' }, 403],
    ['http, port 80 written out', { host: 'capcom.example.test', origin: 'http://capcom.example.test:80' }, 303],
    ['https proxy, no Origin', proxy, 303],
    ['https proxy, same origin', { ...proxy, origin: 'https://capcom.example.test' }, 303],
    ['https proxy, port 443 written out in the Origin', { ...proxy, origin: 'https://capcom.example.test:443' }, 303],
    ['https proxy, port 443 written out in the Host', { ...proxy, host: 'capcom.example.test:443', origin: 'https://capcom.example.test' }, 303],
    ['https proxy, an http Origin for the same host', { ...proxy, origin: 'http://capcom.example.test' }, 403],
    ['https proxy, an http Origin with port 80', { ...proxy, origin: 'http://capcom.example.test:80' }, 403],
    ['https proxy, another host', { ...proxy, origin: 'https://evil.example' }, 403],
    ['a proxy that says http, an https Origin', { ...proxy, proto: 'http', origin: 'https://capcom.example.test' }, 403],
  ];
  for (const [label, input, status] of cases) {
    const res = await attempt(input);
    assert.equal(res.status, status, label);
    if (status === 403) assert.equal(res.headers['set-cookie'], undefined, label);
    else assert.equal(/; Secure$/.test(res.headers['set-cookie'][0]), input.proto === 'https', label);
  }

  const hostless = await new Promise(resolve => {
    const socket = net.connect(s.port, '127.0.0.1', () => socket.write('POST /login HTTP/1.0\r\nOrigin: http://undefined\r\nContent-Length: 0\r\n\r\n'));
    let text = '';
    socket.on('data', chunk => { text += chunk; });
    socket.on('close', () => resolve(text));
  });
  assert.match(hostless, /^HTTP\/1\.[01] 403 /);

  const { token } = await signIn(s);
  const renew = origin => request(s, 'POST', '/renew', { headers: { ...as(token), origin }, json: {} });
  assert.equal((await renew(`http://${here}`)).status, 200);
  assert.equal((await renew(`https://${here}`)).status, 403);
});

test('a signed-out visitor gets the sign-in page and its scripts, and a 401 from everything else', async () => {
  const s = await start();
  const page = await request(s, 'GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.text, /id="password"/);
  for (const file of ['/login.js', '/ui/webauthn.js']) {
    const script = await request(s, 'GET', file);
    assert.equal(script.status, 200, file);
    assert.match(script.headers['content-type'], /javascript/, file);
  }
  for (const [method, url] of [['GET', '/api/sessions'], ['GET', listUrl(s.origin)], ['POST', '/api/passkeys/options'], ['POST', '/api/passkeys/remove'], ['POST', '/renew']]) {
    assert.equal((await request(s, method, url, method === 'POST' ? { json: {} } : {})).status, 401, `${method} ${url}`);
  }
});

test('renew sends the cookie again at most once a day, and pushes the expiry 90 days out', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const renew = headers => request(s, 'POST', '/renew', { headers: { ...as(token), ...headers }, json: {} });

  const fresh = await renew();
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers['set-cookie'], undefined);

  rewriteTokens(s, tokens => {
    tokens[token].used = new Date(Date.now() - 2 * DAY).toISOString();
    tokens[token].expires = new Date(Date.now() + 5 * DAY).toISOString();
  });
  const due = await renew();
  assert.equal(due.status, 200);
  assert.match(due.headers['set-cookie'][0], new RegExp(`^capcom=${token}; HttpOnly; SameSite=Lax; Max-Age=\\d+$`));
  assert.ok(closeTo(maxAge(due.headers['set-cookie'][0]), 90), due.headers['set-cookie'][0]);
  const record = JSON.parse(fs.readFileSync(s.tokens, 'utf8'))[token];
  assert.ok(Math.abs(Date.parse(record.expires) - Date.now() - 90 * DAY) < 60_000);
  assert.ok(Date.now() - Date.parse(record.used) < 60_000);

  assert.equal((await renew()).headers['set-cookie'], undefined);

  rewriteTokens(s, tokens => { tokens[token].used = new Date(Date.now() - 2 * DAY).toISOString(); });
  assert.match((await renew(HTTPS)).headers['set-cookie'][0], /; Max-Age=\d+; Secure$/);
});

test('renew stops pushing the expiry past 365 days after sign-in, and the cookie then lasts only what is left', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const made = Date.now() - 300 * DAY;
  rewriteTokens(s, tokens => {
    tokens[token].created = new Date(made).toISOString();
    tokens[token].used = new Date(Date.now() - 2 * DAY).toISOString();
    tokens[token].expires = new Date(Date.now() + 80 * DAY).toISOString();
  });
  const due = await request(s, 'POST', '/renew', { headers: as(token), json: {} });
  assert.equal(due.status, 200);
  assert.ok(closeTo(maxAge(due.headers['set-cookie'][0]), 65), due.headers['set-cookie'][0]);
  assert.equal(JSON.parse(fs.readFileSync(s.tokens, 'utf8'))[token].expires, new Date(made + 365 * DAY).toISOString());
});

test('signing out clears the cookie, with Secure behind an https proxy, and ends that session', async () => {
  const s = await start();
  const { token } = await signIn(s);
  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).status, 200);

  const out = await request(s, 'POST', '/logout', { headers: { ...as(token), ...HTTPS }, json: {} });
  assert.equal(out.status, 303);
  assert.equal(out.headers.location, './');
  assert.equal(out.headers['set-cookie'][0], 'capcom=; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).status, 401);
});

test('a token file in the old shape keeps its browsers signed in, and an expired token stays out', async () => {
  const s = await start();
  const live = 'a'.repeat(64);
  const expired = 'b'.repeat(64);
  fs.writeFileSync(s.tokens, JSON.stringify({ [live]: Date.now() + 5 * DAY, [expired]: Date.now() - DAY }));

  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(live) })).status, 200);
  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(expired) })).status, 401);
  const record = JSON.parse(fs.readFileSync(s.tokens, 'utf8'))[live];
  assert.ok(Math.abs(Date.parse(record.expires) - Date.now() - 90 * DAY) < 60_000);
  assert.ok(Date.parse(record.created) < Date.now());
  assert.equal(record.device, 'Chrome 141 on macOS');
});

test('a passkey is added by a signed-in browser and signs a signed-out one in', async () => {
  const s = await start();
  const a = makeAuthenticator();
  const { token } = await signIn(s);
  const ask = async (origin = s.origin) => (await request(s, 'POST', '/passkey-options', { json: { origin } })).body();
  const post = (body, headers) => request(s, 'POST', '/passkey-login', { json: body, headers: { 'user-agent': CHROME, ...headers } });

  assert.deepEqual((await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).body(), { available: true, passkeys: [] });
  assert.equal((await request(s, 'GET', listUrl('https://elsewhere.example'), { headers: as(token) })).body().available, false);
  assert.deepEqual(await ask(), { options: null, why: '' });

  const options = (await request(s, 'POST', '/api/passkeys/options', { headers: as(token), json: { origin: s.origin } })).body();
  assert.equal(options.rp.id, 'localhost');
  const added = await request(s, 'POST', '/api/passkeys', { headers: as(token), json: a.register({ challenge: options.challenge, origin: s.origin }) });
  assert.equal(added.status, 200);
  assert.equal(added.body().passkeys.length, 1);
  assert.equal(added.body().passkeys[0].device, 'Chrome 141 on macOS');
  assert.equal(fs.statSync(path.join(s.state, 'passkeys.json')).mode & 0o777, 0o600);

  const { options: signIn1 } = await ask();
  assert.equal(signIn1.rpId, 'localhost');
  assert.deepEqual(signIn1.allowCredentials, []);
  const assertion = a.assert({ challenge: signIn1.challenge, origin: s.origin, signCount: 1 });
  const good = await post(assertion);
  assert.equal(good.status, 200);
  assert.match(good.headers['set-cookie'][0], COOKIE);
  const fresh = tokenIn(good.headers['set-cookie'][0]);
  assert.notEqual(fresh, token);
  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(fresh) })).status, 200);

  const replay = await post(assertion);
  assert.equal(replay.status, 401);
  assert.equal(replay.headers['set-cookie'], undefined);

  const { options: backwards } = await ask();
  assert.equal((await post(a.assert({ challenge: backwards.challenge, origin: s.origin, signCount: 1 }))).status, 401);

  const { options: forwards } = await ask();
  const proxied = await post(a.assert({ challenge: forwards.challenge, origin: s.origin, signCount: 2 }), HTTPS);
  assert.equal(proxied.status, 200);
  assert.match(proxied.headers['set-cookie'][0], /; Max-Age=\d+; Secure$/);
  assert.ok(closeTo(maxAge(proxied.headers['set-cookie'][0]), 90), proxied.headers['set-cookie'][0]);

  assert.deepEqual(await ask('https://elsewhere.example'), { options: null, why: 'Passkeys are not set up for this address.' });
  assert.equal((await request(s, 'POST', '/passkey-options', { form: { origin: s.origin } })).status, 400);
  assert.equal((await post({}, { origin: 'https://evil.example' })).status, 403);

  const used = (await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).body().passkeys;
  assert.equal(used.length, 1);
  assert.ok(used[0].used);
  const removed = await request(s, 'POST', '/api/passkeys/remove', { headers: as(token), json: { id: a.id } });
  assert.deepEqual(removed.body(), { passkeys: [] });
  assert.deepEqual(await ask(), { options: null, why: '' });
});

test('the localhost passkey origin works only on a request that arrived as localhost', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const a = makeAuthenticator();
  const asked = (await request(s, 'POST', '/api/passkeys/options', { headers: as(token), json: { origin: s.origin } })).body();
  await request(s, 'POST', '/api/passkeys', { headers: as(token), json: a.register({ challenge: asked.challenge, origin: s.origin }) });

  const ask = headers => request(s, 'POST', '/passkey-options', { json: { origin: s.origin }, headers }).then(res => res.body());
  assert.ok((await ask({})).options);
  const refused = { options: null, why: 'Passkeys are not set up for this address.' };
  for (const headers of [{ 'x-forwarded-for': '203.0.113.9' }, { 'x-forwarded-host': 'capcom.example.test' }, { forwarded: 'for=203.0.113.9' }, { host: `127.0.0.1:${s.port}` }, { host: 'capcom.example.test' }]) {
    assert.deepEqual(await ask(headers), refused, JSON.stringify(headers));
    const signedIn = { ...as(token), ...headers };
    assert.equal((await request(s, 'POST', '/api/passkeys/options', { headers: signedIn, json: { origin: s.origin } })).status, 400, JSON.stringify(headers));
    assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: signedIn })).body().available, false, JSON.stringify(headers));
  }
});

test('a new password ends every session and every passkey, so a passkey made with a stolen cookie cannot sign back in', async () => {
  const s = await start();
  const thief = makeAuthenticator();
  const { token } = await signIn(s);
  const asked = (await request(s, 'POST', '/api/passkeys/options', { headers: as(token), json: { origin: s.origin } })).body();
  const added = await request(s, 'POST', '/api/passkeys', { headers: as(token), json: thief.register({ challenge: asked.challenge, origin: s.origin }) });
  assert.equal(added.body().passkeys.length, 1);
  const ask = () => request(s, 'POST', '/passkey-options', { json: { origin: s.origin } }).then(res => res.body());
  const { options } = await ask();
  assert.ok(options);

  writePassword(s.state, 'the password after the reset');

  assert.equal((await request(s, 'GET', listUrl(s.origin), { headers: as(token) })).status, 401);
  const stale = await request(s, 'POST', '/passkey-login', { json: thief.assert({ challenge: options.challenge, origin: s.origin, signCount: 1 }) });
  assert.equal(stale.status, 401);
  assert.equal(stale.headers['set-cookie'], undefined);
  assert.deepEqual(await ask(), { options: null, why: '' });

  assert.equal((await request(s, 'POST', '/login', { form: { password: PASSWORD } })).status, 401);
  const fresh = await request(s, 'POST', '/login', { form: { password: 'the password after the reset' }, headers: { 'user-agent': CHROME } });
  assert.equal(fresh.status, 303);
  assert.deepEqual((await request(s, 'GET', listUrl(s.origin), { headers: as(tokenIn(fresh.headers['set-cookie'][0])) })).body().passkeys, []);
});

test('a passkey still arriving when the password is changed is refused rather than added afterwards', async () => {
  const s = await start();
  const thief = makeAuthenticator();
  const { token } = await signIn(s);
  const asked = (await request(s, 'POST', '/api/passkeys/options', { headers: as(token), json: { origin: s.origin } })).body();
  const text = JSON.stringify(thief.register({ challenge: asked.challenge, origin: s.origin }));
  const half = Math.floor(text.length / 2);

  const held = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/passkeys', headers: { host: `localhost:${s.port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...as(token) } });
  const status = new Promise((resolve, reject) => {
    held.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    held.on('error', reject);
  });
  held.write(text.slice(0, half));
  await new Promise(resolve => setTimeout(resolve, 200));
  writePassword(s.state, 'the password after the reset');
  held.end(text.slice(half));

  assert.equal(await status, 401);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.state, 'passkeys.json'), 'utf8')).passkeys, []);
});

test('wrong passwords and refused passkeys count toward one lockout', async () => {
  const s = await start();
  for (let i = 0; i < 5; i++) assert.equal((await request(s, 'POST', '/login', { form: { password: 'nope' } })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await request(s, 'POST', '/passkey-login', { json: {} })).status, 401);
  assert.equal((await request(s, 'POST', '/passkey-login', { json: {} })).status, 429);

  const locked = await request(s, 'POST', '/login', { form: { password: PASSWORD } });
  assert.equal(locked.status, 401);
  assert.match(locked.text, /Too many tries/);
  assert.equal(locked.headers['set-cookie'], undefined);
});
