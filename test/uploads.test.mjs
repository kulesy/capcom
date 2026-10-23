// Run with `npm test`. Files attached to a message: the upload route over HTTP against the real server and the fake CLI, and the
// pure parts of lib/uploads.mjs that name a file, mention it and read the mention back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { writePassword } from '../lib/auth.mjs';
import { DOCUMENT_CHAT_MAX_BYTES, DOCUMENT_CHAT_MAX_PAGES, DOCUMENT_MAX_BYTES, DOCUMENT_MAX_PAGES, extensionOf, fileItems, isSlashCommand, makeUploads, MAX_FILE_BYTES, MAX_FILES, withMentions } from '../lib/uploads.mjs';
import { leadingMentions } from '../public/ui/files.js';
import { PassThrough } from 'node:stream';
import { as, cliCalls, listen, request, signIn, start, until } from './harness.mjs';

const folder = s => path.join(s.state, 'uploads');
const left = s => (fs.existsSync(folder(s)) ? fs.readdirSync(folder(s)) : []);
const post = (s, token, url, json) => request(s, 'POST', url, { headers: as(token), json });
const TEXTUTIL = fs.existsSync('/usr/bin/textutil');
const OSASCRIPT = fs.existsSync('/usr/bin/osascript');

// A valid PDF with one page for each string in `pages`, each showing that text (nothing for ''), and `pad` bytes of an object no page uses.
function makePdf(pages, { pad = 0 } = {}) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  pages.forEach((text, i) => {
    const content = text ? `BT /F1 12 Tf 20 100 Td (${text}) Tj ET` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  if (pad) objects.push(`<< /Length ${pad} >>\nstream\n${'x'.repeat(pad)}\nendstream`);
  let out = '%PDF-1.4\n';
  const at = objects.map((object, i) => { const here = out.length; out += `${i + 1} 0 obj\n${object}\nendobj\n`; return here; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  return Buffer.from(`${out}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1');
}

// The same PDF saved again by PDFKit with an owner password, and a user password too when one is given.
function encrypted(pdf, { owner = 'owner-pw', user } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-pdf-'));
  fs.writeFileSync(path.join(dir, 'in.pdf'), pdf);
  const script = 'ObjC.import("PDFKit"); function run(a) { const d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(a[0])); const o = $.NSMutableDictionary.alloc.init; o.setObjectForKey($(a[2]), $.PDFDocumentOwnerPasswordOption); if (a[3]) o.setObjectForKey($(a[3]), $.PDFDocumentUserPasswordOption); d.writeToURLWithOptions($.NSURL.fileURLWithPath(a[1]), o); }';
  execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, path.join(dir, 'in.pdf'), path.join(dir, 'out.pdf'), owner, ...(user ? [user] : [])]);
  return fs.readFileSync(path.join(dir, 'out.pdf'));
}
// Ends the fake CLI's turn in `id`, so the next message is not one queued while Claude works.
async function finish(s, token, id) {
  const viewer = listen(s, token, id);
  await post(s, token, `/api/sessions/${id}/send`, { text: 'finish the turn' });
  await until(() => viewer.events.some(e => e.type === 'turn-end'));
  viewer.close();
}
const sidecar = (s, id) => JSON.parse(fs.readFileSync(path.join(folder(s), `${id}.meta.json`), 'utf8'));

// Posts a raw body the way the page does. `content-length` is sent unless `chunked` is set, and `headers` is merged over the rest.
function put(s, token, { name, body, type = 'application/octet-stream', headers = {}, chunked = false }) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '');
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/uploads',
      headers: { host: `localhost:${s.port}`, 'content-type': type, ...(name !== undefined && { 'x-file-name': encodeURIComponent(name) }), ...(!chunked && { 'content-length': bytes.length }), ...(token && as(token)), ...headers },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, body: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(bytes);
  });
}

test('the page asks what this server takes, and a signed-out visitor is refused that and the upload before any body is read', async () => {
  const s = await start();
  assert.equal((await request(s, 'GET', '/api/uploads')).status, 401);
  assert.equal((await put(s, null, { name: 'a.txt', body: 'secret' })).status, 401);
  assert.deepEqual(left(s), [], 'nothing was written');
  const { token } = await signIn(s);
  const res = await request(s, 'GET', '/api/uploads', { headers: as(token) });
  assert.deepEqual(res.body(), { maxBytes: 30 * 1024 * 1024, maxFiles: 10 });
  assert.equal((await request(s, 'PUT', '/api/uploads', { headers: as(token) })).status, 405);
});

test('an upload is saved as <uuid>.<ext> with the owner alone able to read it, and the sidecar holds the name the page gave', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const res = await put(s, token, { name: 'Quarterly Report.PDF', body: 'pdf bytes', type: 'application/pdf; charset=binary' });
  assert.equal(res.status, 200);
  const saved = res.body();
  assert.match(saved.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(saved, { id: saved.id, name: 'Quarterly Report.PDF', type: 'application/pdf', size: 9 });
  assert.deepEqual(left(s).sort(), [`${saved.id}.meta.json`, `${saved.id}.pdf`]);
  assert.equal(fs.readFileSync(path.join(folder(s), `${saved.id}.pdf`), 'utf8'), 'pdf bytes');
  assert.equal(fs.statSync(path.join(folder(s), `${saved.id}.pdf`)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(folder(s), `${saved.id}.meta.json`)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(folder(s)).mode & 0o777, 0o700);
  const meta = JSON.parse(fs.readFileSync(path.join(folder(s), `${saved.id}.meta.json`), 'utf8'));
  assert.deepEqual([meta.name, meta.type, meta.size], ['Quarterly Report.PDF', 'application/pdf', 9]);
});

test('a folder that already exists with looser rights is tightened to the owner alone', async () => {
  const s = await start();
  fs.mkdirSync(folder(s), { mode: 0o755 });
  fs.chmodSync(folder(s), 0o755);
  const { token } = await signIn(s);
  assert.equal((await put(s, token, { name: 'a.txt', body: 'x' })).status, 200);
  assert.equal(fs.statSync(folder(s)).mode & 0o777, 0o700);
});

test('a name that climbs out of the folder lands as <uuid>.<ext> inside it and is kept only in the sidecar', async () => {
  const s = await start();
  const { token } = await signIn(s);
  for (const name of ['../../evil.sh', '..\\..\\evil.sh', '/etc/passwd.sh', '%2e%2e/%2e%2e/evil.sh']) {
    const res = await put(s, token, { name, body: '#!/bin/sh\n' });
    assert.equal(res.status, 200, name);
    const { id } = res.body();
    assert.ok(fs.existsSync(path.join(folder(s), `${id}.sh`)), `${name} is stored as the uuid and its extension`);
  }
  assert.deepEqual(fs.readdirSync(s.state).filter(f => /evil|passwd/.test(f)), []);
  assert.deepEqual(fs.readdirSync(s.home).filter(f => /evil|passwd/.test(f)), []);
  assert.ok(left(s).every(f => /^[0-9a-f-]{36}\.(sh|meta\.json)$/.test(f)), left(s).join(' '));
});

test('an extension that is not plain letters and digits, or is longer than ten, leaves the file with none, and the name falls back on bad input', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const stored = async (name, headers) => {
    const { id } = (await put(s, token, { name, body: 'x', headers })).body();
    return left(s).filter(f => f.startsWith(id) && !f.endsWith('.meta.json'));
  };
  const noName = async () => stored(undefined);
  assert.deepEqual((await stored('a.tar.gz')).map(f => f.slice(37)), ['gz']);
  assert.deepEqual((await stored('notes')).map(f => f.length), [36]);
  assert.deepEqual((await stored('x.')).map(f => f.length), [36]);
  assert.deepEqual((await stored('x.verylongextension')).map(f => f.length), [36]);
  assert.deepEqual((await stored('x.üñi')).map(f => f.length), [36]);
  assert.deepEqual((await noName()).map(f => f.length), [36]);
  const bad = await put(s, token, { body: 'x', headers: { 'x-file-name': '%E0%A4%A' } });
  assert.equal(bad.body().name, 'file', 'a name that does not decode is called file');
});

test('a file over the limit by content-length is refused with 413 before any of it is read, and nothing is left', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/uploads', headers: { host: `localhost:${s.port}`, 'x-file-name': 'big.bin', 'content-length': MAX_FILE_BYTES + 1, ...as(token) } }, answer => {
      let text = '';
      answer.on('data', chunk => { text += chunk; });
      answer.on('end', () => { req.destroy(); resolve({ status: answer.statusCode, text }); });
    });
    req.on('error', reject);
    req.write('a few bytes');
  });
  assert.equal(res.status, 413);
  assert.match(JSON.parse(res.text).error, /big\.bin is over the 30 MB limit/);
  assert.deepEqual(left(s), []);
});

test('a body streamed past the limit with no content-length is refused with 413 and the part written so far is removed', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const one = Buffer.alloc(1024 * 1024, 1);
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/uploads', headers: { host: `localhost:${s.port}`, 'x-file-name': 'stream.bin', 'transfer-encoding': 'chunked', ...as(token) } }, answer => {
      let text = '';
      answer.on('data', chunk => { text += chunk; });
      answer.on('end', () => resolve({ status: answer.statusCode, text }));
    });
    req.on('error', reject);
    (async () => {
      for (let n = 0; n <= 30 && !req.destroyed; n++) {
        if (!req.write(one)) await new Promise(r => req.once('drain', r));
      }
      req.end();
    })();
  });
  assert.equal(res.status, 413);
  assert.deepEqual(left(s), []);
});

test('a file of exactly the limit is kept', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const body = Buffer.alloc(MAX_FILE_BYTES);
  for (let at = 0; at < body.length; at += 4093) body[at] = (at / 4093) % 251;
  const res = await put(s, token, { name: 'exact.bin', body });
  assert.equal(res.status, 200);
  assert.equal(res.body().size, MAX_FILE_BYTES);
  assert.equal(fs.readFileSync(path.join(folder(s), `${res.body().id}.bin`)).equals(body), true, 'the bytes on disk are the bytes sent');
  fs.rmSync(folder(s), { recursive: true });
});

test('a password changed while a file is still arriving ends in a 401 with nothing left', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const bytes = Buffer.alloc(200_000, 5);
  const held = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/uploads', headers: { host: `localhost:${s.port}`, 'x-file-name': 'late.txt', 'content-length': bytes.length, ...as(token) } });
  const status = new Promise((resolve, reject) => {
    held.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    held.on('error', reject);
  });
  held.write(bytes.subarray(0, 100_000));
  await until(() => left(s).some(f => f.endsWith('.part')));
  writePassword(s.state, 'the password after the reset');
  held.end(bytes.subarray(100_000));
  assert.equal(await status, 401);
  assert.deepEqual(left(s), []);
});

test('a document is also saved as text beside it, a plain file is not, and a document that has no text has no text copy', { skip: !TEXTUTIL }, async () => {
  const s = await start();
  const { token } = await signIn(s);
  const rtf = await put(s, token, { name: 'Brief.rtf', body: '{\\rtf1\\ansi The brown fox is called bluebell.\\par}' });
  const { id } = rtf.body();
  assert.equal(fs.readFileSync(path.join(folder(s), `${id}.rtf.txt`), 'utf8').includes('bluebell'), true);
  assert.equal(fs.statSync(path.join(folder(s), `${id}.rtf.txt`)).mode & 0o777, 0o600);
  const plain = (await put(s, token, { name: 'a.txt', body: 'x' })).body();
  assert.equal(left(s).some(f => f.startsWith(plain.id) && f.endsWith('.txt.txt')), false);
  const blank = (await put(s, token, { name: 'Blank.docx', body: '' })).body();
  assert.equal(left(s).includes(`${blank.id}.docx`), true, 'the upload itself is kept');
  assert.equal(left(s).includes(`${blank.id}.docx.txt`), false);
});

test('a message names its files by id: anything that is not an uploaded id is a 400 on a send and on a new session', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 5 }] });
  const { token } = await signIn(s);
  const ghost = '00000000-0000-4000-8000-000000000000';
  const real = (await put(s, token, { name: 'a.txt', body: 'x' })).body().id;
  const many = Array.from({ length: MAX_FILES + 1 }, () => real);
  const refused = [
    ['a string', 'a.txt'], ['a number', [5]], ['an object', [{}]], ['a path', ['../../etc/passwd']], ['a path with the real id', [`${real}/../x`]],
    ['an unknown uuid', [ghost]], ['a sidecar', [`${real}.meta.json`]], ['an upper-case uuid', [real.toUpperCase()]], [`${MAX_FILES + 1} ids`, many],
  ];
  for (const [what, files] of refused) {
    const sent = await post(s, token, '/api/sessions/calm/send', { text: 'hello', files });
    assert.equal(sent.status, 400, `send with ${what}`);
    const made = await post(s, token, '/api/new', { cwd: s.home, text: 'hello', files });
    assert.equal(made.status, 400, `new with ${what}`);
  }
  assert.equal(cliCalls(s).some(c => c.user !== undefined), false, 'nothing reached the CLI');
  assert.equal((await post(s, token, '/api/sessions/calm/send', { text: 'hello', files: [] })).status, 200);
});

test('an upload that is deleted before the message is sent is a 400', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 5 }] });
  const { token } = await signIn(s);
  const { id } = (await put(s, token, { name: 'a.txt', body: 'x' })).body();
  fs.rmSync(path.join(folder(s), `${id}.txt`));
  assert.equal((await post(s, token, '/api/sessions/calm/send', { text: '', files: [id] })).status, 400);
});

test('a send with files and no text is accepted, and an empty one is still nothing to send', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 5 }] });
  const { token } = await signIn(s);
  const { id } = (await put(s, token, { name: 'a.txt', body: 'x' })).body();
  assert.equal((await post(s, token, '/api/sessions/calm/send', { text: '  ' })).status, 400);
  assert.equal((await post(s, token, '/api/sessions/calm/send', { text: '  ', files: [id] })).status, 200);
});

test('the CLI is sent each file as @"path" in the order given, the typed text on the next line, and a document\'s text copy right after it', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 5 }] });
  const { token } = await signIn(s);
  const a = (await put(s, token, { name: 'a.html', body: '<p>a</p>' })).body().id;
  const b = (await put(s, token, { name: 'b.md', body: '# b' })).body().id;
  const dir = folder(s);
  const sent = await post(s, token, '/api/sessions/calm/send', { text: 'compare them', files: [a, b] });
  assert.equal(sent.status, 200);
  await until(() => cliCalls(s).some(c => c.user !== undefined));
  assert.equal(cliCalls(s).find(c => c.user !== undefined).user, `@"${dir}/${a}.html" @"${dir}/${b}.md"\ncompare them`);

  await post(s, token, '/api/sessions/calm/send', { text: '', files: [b] });
  await until(() => cliCalls(s).filter(c => c.user !== undefined).length === 2);
  assert.equal(cliCalls(s).filter(c => c.user !== undefined)[1].user, `@"${dir}/${b}.md"`);
});

test('a document\'s text copy is mentioned straight after the document', { skip: !TEXTUTIL }, async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 5 }] });
  const { token } = await signIn(s);
  const doc = (await put(s, token, { name: 'Brief.rtf', body: '{\\rtf1\\ansi hello\\par}' })).body().id;
  const txt = (await put(s, token, { name: 'z.txt', body: 'z' })).body().id;
  const dir = folder(s);
  await post(s, token, '/api/sessions/calm/send', { text: 'read', files: [doc, txt] });
  await until(() => cliCalls(s).some(c => c.user !== undefined));
  assert.equal(cliCalls(s).find(c => c.user !== undefined).user, `@"${dir}/${doc}.rtf" @"${dir}/${doc}.rtf.txt" @"${dir}/${txt}.txt"\nread`);
});

test('a new session with files and no text is allowed, is titled by the file, and starts with the mention', async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const a = (await put(s, token, { name: 'plan.csv', body: 'a,b' })).body().id;
  const b = (await put(s, token, { name: 'notes.txt', body: 'n' })).body().id;
  const empty = await post(s, token, '/api/new', { cwd: s.home, text: '' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body().error, 'Write the first message.');

  const one = await post(s, token, '/api/new', { cwd: s.home, text: '', files: [a] });
  assert.equal(one.status, 200);
  const two = await post(s, token, '/api/new', { cwd: s.home, text: 'begin a session', files: [a, b] });
  assert.equal(two.status, 200);
  const many = await post(s, token, '/api/new', { cwd: s.home, text: '', files: [a, b] });
  assert.equal(many.status, 200);
  const started = JSON.parse(fs.readFileSync(path.join(s.state, 'started.json'), 'utf8'));
  assert.deepEqual(started.map(row => row.title), ['plan.csv', 'begin a session', 'Files'], 'the fake names every session alike, so they are read in the order they were started');
  const dir = folder(s);
  await until(() => cliCalls(s).filter(c => c.user !== undefined).length === 3);
  const users = cliCalls(s).filter(c => c.user !== undefined).map(c => c.user);
  assert.ok(users.includes(`@"${dir}/${a}.csv"`));
  assert.ok(users.includes(`@"${dir}/${a}.csv" @"${dir}/${b}.txt"\nbegin a session`));
});

test('extensionOf keeps the last plain extension in lower case', () => {
  assert.deepEqual(['a.PDF', 'a.tar.gz', 'a', '.bashrc', 'a.', 'a.b c', 'a.ab12', 'a.abcdefghijk'].map(extensionOf), ['pdf', 'gz', '', '', '', '', 'ab12', '']);
});

test('withMentions puts the paths first, the text after a newline, and nothing else when there is no text', () => {
  const files = [{ path: '/up/a.html', companion: null }, { path: '/up/b.docx', companion: '/up/b.docx.txt' }];
  assert.equal(withMentions(files, 'go'), '@"/up/a.html" @"/up/b.docx" @"/up/b.docx.txt"\ngo');
  assert.equal(withMentions(files, '  \n'), '@"/up/a.html" @"/up/b.docx" @"/up/b.docx.txt"');
  assert.equal(withMentions([], 'go'), 'go');
});

test('leadingMentions reads back only a leading run that ends at a newline or the end of the text', () => {
  assert.deepEqual(leadingMentions('@"/a b/c.txt" @"/d.md"\nhello\n@"/not.leading"'), { paths: ['/a b/c.txt', '/d.md'], text: 'hello\n@"/not.leading"' });
  assert.deepEqual(leadingMentions('@"/a.txt"'), { paths: ['/a.txt'], text: '' });
  assert.deepEqual(leadingMentions('look at @"/a.txt" please'), { paths: [], text: 'look at @"/a.txt" please' });
  assert.deepEqual(leadingMentions('@"/a.txt" and then words'), { paths: [], text: '@"/a.txt" and then words' });
  assert.deepEqual(leadingMentions('@"relative.txt"\nx'), { paths: [], text: '@"relative.txt"\nx' });
  assert.deepEqual(leadingMentions('@"/a.txt"@"/b.txt"\nx'), { paths: [], text: '@"/a.txt"@"/b.txt"\nx' });
});

test('readFiles takes a list of at most ten uploaded ids and says why it refuses anything else', () => {
  const uploads = makeUploads(fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-uploads-')));
  assert.deepEqual(uploads.readFiles(undefined), { files: [] });
  assert.deepEqual(uploads.readFiles(null), { files: [] });
  assert.equal(uploads.readFiles('x').error, 'Files must be a list.');
  assert.match(uploads.readFiles(Array(MAX_FILES + 1).fill('x')).error, /at most 10 files/);
  assert.match(uploads.readFiles(['x']).error, /not uploaded to GhostShell/);
});

test('fileItems describes a Capcom upload from its sidecar, hides its text copy, and describes any other path by its name and type, with no size', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-uploads-'));
  const dir = path.join(root, 'uploads');
  fs.mkdirSync(dir);
  const id = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(path.join(dir, `${id}.docx`), 'doc');
  fs.writeFileSync(path.join(dir, `${id}.docx.txt`), 'text');
  fs.writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify({ name: 'Plan v2.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 3 }));
  const outside = path.join(root, 'desktop.pdf');
  fs.writeFileSync(outside, '12345');
  const items = fileItems([`${dir}/${id}.docx`, `${dir}/${id}.docx.txt`, outside, path.join(root, 'gone.md'), path.join(root, 'noext')], dir);
  assert.deepEqual(items.map(i => [i.name, i.type, i.size]), [
    ['Plan v2.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 3],
    ['desktop.pdf', 'application/pdf', null],
    ['gone.md', 'text/markdown', null],
    ['noext', '', null],
  ]);
  assert.equal(items[0].path, `${dir}/${id}.docx`);
});

test('fileItems trusts a sidecar only inside the uploads folder, so a mention of a path elsewhere is not described by one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-uploads-'));
  const dir = path.join(root, 'uploads');
  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(dir);
  fs.mkdirSync(elsewhere);
  const id = '22222222-2222-4222-8222-222222222222';
  fs.writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify({ name: 'Not this name.txt', type: 'text/plain', size: 1 }));
  fs.writeFileSync(path.join(elsewhere, `${id}.txt`), 'x');
  assert.equal(fileItems([path.join(elsewhere, `${id}.txt`)], dir)[0].name, `${id}.txt`);
  assert.equal(fileItems([`${dir}/../elsewhere/${id}.txt`], dir)[0].name, `${id}.txt`);
  assert.equal(fileItems(['/etc/hosts'], '')[0].name, 'hosts');
  assert.equal(fileItems(['/constructor'], dir)[0].type, '', 'a file name is not looked up as a property of the table');
});

test('a PDF is saved with its page count in the sidecar and its text beside it, and one with no text, one that needs a password and a file that is not a PDF have no text copy', { skip: !OSASCRIPT }, async () => {
  const s = await start();
  const { token } = await signIn(s);
  const two = (await put(s, token, { name: 'Report.PDF', body: makePdf(['The fox is called bluebell.', 'Page two.']), type: 'application/pdf' })).body();
  assert.equal(sidecar(s, two.id).pages, 2);
  assert.equal('encrypted' in sidecar(s, two.id), false);
  const copy = path.join(folder(s), `${two.id}.pdf.txt`);
  assert.equal(fs.readFileSync(copy, 'utf8').includes('bluebell'), true);
  assert.equal(fs.statSync(copy).mode & 0o777, 0o600);

  const scanned = (await put(s, token, { name: 'Scan.pdf', body: makePdf(['', '']) })).body();
  assert.equal(sidecar(s, scanned.id).pages, 2, 'a PDF with no text still has pages');
  assert.equal(left(s).includes(`${scanned.id}.pdf.txt`), false);

  const locked = (await put(s, token, { name: 'Locked.pdf', body: encrypted(makePdf(['secret']), { user: 'user-pw' }) })).body();
  assert.equal('pages' in sidecar(s, locked.id), false);
  assert.equal(left(s).includes(`${locked.id}.pdf.txt`), false);
  assert.equal(left(s).includes(`${locked.id}.pdf`), true, 'the upload itself is kept');

  const owned = (await put(s, token, { name: 'Owned.pdf', body: encrypted(makePdf(['readable text'])) })).body();
  assert.deepEqual([sidecar(s, owned.id).pages, sidecar(s, owned.id).encrypted], [1, true]);
  assert.equal(fs.readFileSync(path.join(folder(s), `${owned.id}.pdf.txt`), 'utf8').includes('readable text'), true);

  const fake = (await put(s, token, { name: 'Fake.pdf', body: 'not a pdf at all' })).body();
  assert.equal('pages' in sidecar(s, fake.id), false);
  assert.equal(left(s).includes(`${fake.id}.pdf.txt`), false);

  const notPdf = (await put(s, token, { name: 'a.txt', body: 'x' })).body();
  assert.equal('pages' in sidecar(s, notPdf.id), false);
});

// Sidecars written by hand, so the choice is tested without a PDF reader. A file is `size` bytes of filler.
function seeded(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-uploads-'));
  const uploads = makeUploads(root);
  fs.mkdirSync(uploads.dir);
  const ids = entries.map(([name, size, extra], n) => {
    const id = `${String(n + 1).repeat(8)}-1111-4111-8111-111111111111`;
    const ext = extensionOf(name);
    fs.writeFileSync(path.join(uploads.dir, `${id}.${ext}`), Buffer.alloc(size, 'x'));
    fs.writeFileSync(path.join(uploads.dir, `${id}.meta.json`), JSON.stringify({ name, type: '', size, ...extra }));
    if (extra?.copy) fs.writeFileSync(path.join(uploads.dir, `${id}.${ext}.txt`), 'the words');
    return id;
  });
  return { uploads, ids };
}
const chosen = (entries) => { const { uploads, ids } = seeded(entries); return uploads.readFiles(ids).files.map(f => f.document); };

test('a PDF of 1 to 20 pages and at most 3 MB goes as a document, and a longer or larger one, an encrypted one and one with no page count go by path', () => {
  assert.equal(DOCUMENT_MAX_PAGES, 20);
  assert.equal(DOCUMENT_MAX_BYTES, 3 * 1024 * 1024);
  const pdf = (pages, size = 1000, extra) => ['a.pdf', size, { pages, ...extra }];
  assert.deepEqual(chosen([pdf(1)]), [true]);
  assert.deepEqual(chosen([pdf(20)]), [true], 'twenty pages is the limit');
  assert.deepEqual(chosen([pdf(21)]), [false], 'one page over');
  assert.deepEqual(chosen([pdf(0)]), [false], 'a PDF with no pages has nothing to read');
  assert.deepEqual(chosen([pdf(3, DOCUMENT_MAX_BYTES)]), [true], '3 MB is the limit');
  assert.deepEqual(chosen([pdf(3, DOCUMENT_MAX_BYTES + 1)]), [false], 'one byte over');
  assert.deepEqual(chosen([pdf(3, 1000, { encrypted: true })]), [false]);
  assert.deepEqual(chosen([['a.pdf', 1000]]), [false], 'PDFKit never opened it, so there is no page count');
  assert.deepEqual(chosen([['a.txt', 1000, { pages: 3 }], ['a.docx', 1000, { pages: 3 }]]), [false, false], 'only a PDF is a document');
});

test('the documents in one message share the same limits, in the order given, and a PDF that does not fit is left to go by path', () => {
  const pdf = (pages, size = 1000) => ['a.pdf', size, { pages }];
  assert.deepEqual(chosen([pdf(10), pdf(10)]), [true, true], 'twenty pages together');
  assert.deepEqual(chosen([pdf(10), pdf(11), pdf(10)]), [true, false, true], 'the one that would pass twenty goes by path, and a later one that fits still goes');
  assert.deepEqual(chosen([pdf(1, DOCUMENT_MAX_BYTES - 10), pdf(1, 10), pdf(1, 11)]), [true, true, false], 'the same for the bytes');
});

test('a PDF sent while Claude works goes by path with its text copy, because the CLI passes on only the text of a queued message', () => {
  const { uploads, ids } = seeded([['small.pdf', 1000, { pages: 2, copy: true }]]);
  const [file] = uploads.readFiles(ids, 'chat', { blocks: false }).files;
  assert.equal(file.document, false);
  assert.equal(withMentions([file], 'and this'), `@"${file.path}" @"${file.path}.txt"\nand this`);
});

test('a PDF that goes as a document is mentioned alone, and any other PDF is mentioned with its text copy', () => {
  const { uploads, ids } = seeded([['small.pdf', 1000, { pages: 2, copy: true }], ['long.pdf', 1000, { pages: 40, copy: true }], ['scan.pdf', 1000, { pages: 40 }], ['b.rtf', 1000, { copy: true }]]);
  const { files } = uploads.readFiles(ids);
  assert.deepEqual(files.map(f => [f.document, !!f.companion]), [[true, true], [false, true], [false, false], [false, true]]);
  const prompt = withMentions(files, 'read them');
  const [small, long, scan, rtf] = files.map(f => f.path);
  assert.equal(prompt, `@"${small}" @"${long}" @"${long}.txt" @"${scan}" @"${rtf}" @"${rtf}.txt"\nread them`);
});

test('the documents are read at send time as base64 of the PDF itself, in order, and a PDF that has gone since is refused', async () => {
  const { uploads, ids } = seeded([['a.pdf', 10, { pages: 1 }], ['b.txt', 10], ['c.pdf', 20, { pages: 1 }], ['d.pdf', 10, { pages: 99 }]]);
  const { files } = uploads.readFiles(ids);
  const { documents } = await uploads.readDocuments(files);
  assert.deepEqual(documents, [
    { mediaType: 'application/pdf', data: Buffer.alloc(10, 'x').toString('base64') },
    { mediaType: 'application/pdf', data: Buffer.alloc(20, 'x').toString('base64') },
  ]);
  assert.deepEqual(await uploads.readDocuments([]), { documents: [] });
  fs.rmSync(files[2].path);
  assert.match((await uploads.readDocuments(files)).error, /not uploaded to GhostShell/);
});

test('fileItems hides the text copy of a PDF and describes the upload without its page count', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-uploads-'));
  const dir = path.join(root, 'uploads');
  fs.mkdirSync(dir);
  const id = '33333333-3333-4333-8333-333333333333';
  fs.writeFileSync(path.join(dir, `${id}.pdf`), 'pdf');
  fs.writeFileSync(path.join(dir, `${id}.pdf.txt`), 'text');
  fs.writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify({ name: 'Annual report.pdf', type: 'application/pdf', size: 3, pages: 9 }));
  assert.deepEqual(fileItems([`${dir}/${id}.pdf`, `${dir}/${id}.pdf.txt`], dir), [{ name: 'Annual report.pdf', type: 'application/pdf', size: 3, path: `${dir}/${id}.pdf` }]);
  assert.deepEqual(fileItems([`${dir}/${id}.pdf.txt`], dir).map(i => i.name), [`${id}.pdf.txt`], 'a text copy alone, with no original beside it, is a file of its own');
});

const documentsOf = content => content.filter(b => b.type === 'document');

test('a small PDF goes to the CLI as a document block before the text, with its mention in the text, and a longer one, a locked one and a scan go as mentions', { skip: !OSASCRIPT }, async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 5 }] });
  const { token } = await signIn(s);
  const dir = folder(s);
  const bytes = makePdf(['The fox is called bluebell.']);
  const small = (await put(s, token, { name: 'small.pdf', body: bytes })).body().id;
  const long = (await put(s, token, { name: 'long.pdf', body: makePdf(Array.from({ length: DOCUMENT_MAX_PAGES + 1 }, (_, i) => `Page ${i + 1} is called damson.`)) })).body().id;
  const locked = (await put(s, token, { name: 'locked.pdf', body: encrypted(makePdf(['secret']), { user: 'user-pw' }) })).body().id;
  const scan = (await put(s, token, { name: 'scan.pdf', body: makePdf(Array(DOCUMENT_MAX_PAGES + 1).fill('')) })).body().id;
  const users = () => cliCalls(s).filter(c => c.user !== undefined && c.user !== 'finish the turn').map(c => c.user);

  assert.equal((await post(s, token, '/api/sessions/calm/send', { text: 'what is it called', files: [small] })).status, 200);
  await until(() => users().length === 1);
  assert.deepEqual(users()[0], [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } },
    { type: 'text', text: `@"${dir}/${small}.pdf"\nwhat is it called` },
  ]);

  await finish(s, token, 'calm');
  await post(s, token, '/api/sessions/calm/send', { text: 'read them', files: [long, locked, scan] });
  await until(() => users().length === 2);
  assert.equal(users()[1], `@"${dir}/${long}.pdf" @"${dir}/${long}.pdf.txt" @"${dir}/${locked}.pdf" @"${dir}/${scan}.pdf"\nread them`);
  assert.equal(left(s).includes(`${scan}.pdf.txt`), false);

  await post(s, token, '/api/sessions/calm/send', { text: 'and again', files: [small] });
  await until(() => users().length === 3);
  assert.equal(users()[2], `@"${dir}/${small}.pdf" @"${dir}/${small}.pdf.txt"\nand again`, 'a PDF sent while Claude works goes by path with its text copy');

  await finish(s, token, 'calm');
  await post(s, token, '/api/sessions/calm/send', { text: '', files: [small] });
  await until(() => users().length === 4);
  assert.deepEqual(users()[3].map(b => b.type), ['document', 'text'], 'the mention is a text block of its own when there are no words');
  assert.equal(documentsOf(users()[3]).length, 1);
});

test('a new session with a small PDF starts with the document block and the mention, and is named by the file', { skip: !OSASCRIPT }, async () => {
  const s = await start({ claude: true });
  const { token } = await signIn(s);
  const id = (await put(s, token, { name: 'Plan.pdf', body: makePdf(['A plan.']) })).body().id;
  const made = await post(s, token, '/api/new', { cwd: s.home, text: '', files: [id] });
  assert.equal(made.status, 200);
  await until(() => cliCalls(s).some(c => c.user !== undefined));
  const content = cliCalls(s).find(c => c.user !== undefined).user;
  assert.deepEqual(content.map(b => b.type), ['document', 'text']);
  assert.equal(content[1].text, `@"${folder(s)}/${id}.pdf"`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.state, 'started.json'), 'utf8'))[0].title, 'Plan.pdf');
});

test('a POST to the upload route from another site is refused with a 403 before anything is read, and nothing is saved', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const res = await put(s, token, { name: 'a.txt', body: 'x', headers: { origin: 'http://evil.example' } });
  assert.equal(res.status, 403);
  assert.deepEqual(left(s), []);
  assert.equal((await put(s, token, { name: 'a.txt', body: 'x', headers: { origin: `http://localhost:${s.port}` } })).status, 200, 'the page\'s own origin is let through');
});

test('a client that goes away in the middle of a body leaves no part file behind', async () => {
  const s = await start();
  const { token } = await signIn(s);
  const req = http.request({
    host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/uploads',
    headers: { host: `localhost:${s.port}`, 'content-type': 'application/octet-stream', 'x-file-name': 'gone.bin', 'content-length': 200_000, ...as(token) },
  });
  req.on('error', () => {});
  req.write(Buffer.alloc(50_000, 1));
  await until(() => left(s).some(f => f.endsWith('.part')));
  req.destroy();
  await until(() => left(s).length === 0);
  assert.deepEqual(left(s), []);
});

const fakeBody = () => Object.assign(new PassThrough(), { headers: { 'x-file-name': 'slow.bin' } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a body that sends nothing for the idle time is dropped with no part left, and one that keeps arriving, slowly, is kept', async () => {
  const uploads = makeUploads(fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-uploads-')), { idleMs: 200 });
  const stalled = fakeBody();
  stalled.write(Buffer.alloc(100, 1));
  await assert.rejects(uploads.save(stalled, { signedIn: () => true }), error => error.status === 408 && /slow\.bin stopped arriving/.test(error.message));
  assert.equal(stalled.destroyed, true, 'the request is destroyed');
  assert.deepEqual(fs.readdirSync(uploads.dir), [], 'neither the part nor a sidecar is left');

  const slow = fakeBody();
  const saving = uploads.save(slow, { signedIn: () => true });
  for (let n = 0; n < 4; n++) { slow.write(Buffer.alloc(10, n)); await wait(80); }
  slow.end();
  assert.equal((await saving).size, 40, 'every wait was shorter than the idle time, so the whole body was kept');
});

test('a slash command is told from a path, and from a slash that is not the first word', () => {
  for (const text of ['/compact', '  /review-pr 12', '/plugin:skill args', '/model\nopus', '/a.b']) assert.equal(isSlashCommand(text), true, text);
  for (const text of ['/etc/hosts look', '/', '//x', 'look at /compact', '/9x', '', '/ compact']) assert.equal(isSlashCommand(text), false, text);
});

test('a slash command is refused with files in a send and a new session, and goes through on its own, or with a path or ordinary words', async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 5 }] });
  const { token } = await signIn(s);
  const id = (await put(s, token, { name: 'a.txt', body: 'x' })).body().id;
  const words = 'Send a slash command on its own, without files.';
  for (const url of ['/api/sessions/calm/send', '/api/new']) {
    const refused = await post(s, token, url, { cwd: s.home, text: '/compact now', files: [id] });
    assert.deepEqual([refused.status, refused.body().error], [400, words], url);
    const bare = await post(s, token, url, { cwd: s.home, text: '/compact', files: [id] });
    assert.equal(bare.status, 400, `${url} with only the command`);
  }
  assert.equal(cliCalls(s).some(c => c.user !== undefined), false, 'nothing reached the CLI');
  assert.equal(fs.existsSync(path.join(s.state, 'documents.json')), false);
  assert.equal((await post(s, token, '/api/sessions/calm/send', { text: '/etc/hosts has a typo', files: [id] })).status, 200, 'a path is not a command');
  assert.equal((await post(s, token, '/api/sessions/calm/send', { text: '/compact' })).status, 200, 'a command with no files is as before');
  await until(() => cliCalls(s).filter(c => c.user !== undefined).length === 2);
});

test('fileItems never stats a path outside the uploads folder, so a volume that has gone cannot stall a read', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-uploads-'));
  const dir = path.join(root, 'uploads');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(root, 'outside.csv'), 'a,b');
  fs.writeFileSync(path.join(dir, '44444444-4444-4444-8444-444444444444.csv'), 'a,b,c');
  const real = fs.statSync;
  const statted = [];
  fs.statSync = (target, ...rest) => { statted.push(String(target)); return real(target, ...rest); };
  let items;
  try {
    items = fileItems([path.join(root, 'outside.csv'), '/Volumes/gone/report.pdf', path.join(dir, '44444444-4444-4444-8444-444444444444.csv')], dir);
  } finally {
    fs.statSync = real;
  }
  assert.deepEqual(items.map(i => [i.name, i.size]), [['outside.csv', null], ['report.pdf', null], ['44444444-4444-4444-8444-444444444444.csv', 5]]);
  assert.deepEqual(statted, [path.join(dir, '44444444-4444-4444-8444-444444444444.csv')], 'only the file in the uploads folder was looked at');
});

const budgetPdf = (pages, size = 1000) => ['a.pdf', size, { pages }];
// Sends each list of entries as one message to `chat`, recording it as the server does, and says which went as documents.
function messages(uploads, ids, sends) {
  return sends.map(([chat, ...which]) => {
    const { files } = uploads.readFiles(which.map(n => ids[n]), chat);
    uploads.record(chat, files);
    return files.map(f => f.document);
  });
}

test('a chat\'s documents share 40 pages across its messages, and another chat, and one not started yet, begin clear', () => {
  assert.equal(DOCUMENT_CHAT_MAX_PAGES, 40);
  const { uploads, ids } = seeded([budgetPdf(20), budgetPdf(20), budgetPdf(1), budgetPdf(1), budgetPdf(19), budgetPdf(21)]);
  assert.deepEqual(messages(uploads, ids, [['a', 0], ['a', 1], ['a', 2], ['b', 2], [undefined, 3], ['a', 3]]), [[true], [true], [false], [true], [true], [false]],
    'twenty and twenty make forty, and the forty-first page goes by path');
  assert.deepEqual(messages(uploads, ids, [['c', 4, 3], ['c', 3]]), [[true, true], [true]], 'twenty pages in one message fills that message, but a chat that has used twenty has room for twenty more');
  assert.deepEqual(messages(uploads, ids, [['d', 5]]), [[false]], 'one over the per-message limit is still refused');
});

test('a chat\'s documents share 10 MB across its messages, to the byte', () => {
  assert.equal(DOCUMENT_CHAT_MAX_BYTES, 10 * 1024 * 1024);
  const third = DOCUMENT_MAX_BYTES;
  const { uploads, ids } = seeded([budgetPdf(1, third), budgetPdf(1, third), budgetPdf(1, third), budgetPdf(1, DOCUMENT_CHAT_MAX_BYTES - 3 * third), budgetPdf(1, 1)]);
  assert.deepEqual(messages(uploads, ids, [['a', 0], ['a', 1], ['a', 2], ['a', 3], ['a', 4], ['b', 4]]), [[true], [true], [true], [true], [false], [true]],
    'three of 3 MB and one of 1 MB come to exactly 10 MB, and one more byte goes by path');
});

test('a PDF that goes by path is not counted, and the ledger is an owner-only JSON file written whole, replaced when it cannot be read', () => {
  const { uploads, ids } = seeded([budgetPdf(30), budgetPdf(5), budgetPdf(5)]);
  const file = path.join(path.dirname(uploads.dir), 'documents.json');
  assert.deepEqual(messages(uploads, ids, [['a', 0, 1], ['a', 2]]), [[false, true], [true]], 'the thirty pages were over the message limit and did not use the chat\'s');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: { pages: 10, bytes: 2000 } });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(n => n.includes('.tmp')), [], 'no temporary file is left');
  assert.equal(uploads.readFiles([ids[1]], '__proto__').files[0].document, true, 'an id that is a property name is only an id');
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(messages(uploads, ids, [['a', 1]]), [[true]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: { pages: 5, bytes: 1000 } });
  fs.writeFileSync(file, JSON.stringify({ a: { pages: 'x', bytes: -4 }, b: 7 }));
  assert.deepEqual(messages(uploads, ids, [['a', 1], ['b', 2]]), [[true], [true]], 'a record with no numbers counts as empty');
});

test('over HTTP the third 20-page PDF in a chat goes by path with its text copy, the first two go as documents, and the ledger holds what was sent', { skip: !OSASCRIPT }, async () => {
  const s = await start({ claude: true, sessions: [{ id: 'calm', title: 'Calm one', ago: 5 }] });
  const { token } = await signIn(s);
  const dir = folder(s);
  const pages = Array.from({ length: DOCUMENT_MAX_PAGES }, (_, n) => `Page ${n + 1} is called damson.`);
  const ups = [];
  for (let n = 0; n < 3; n++) ups.push((await put(s, token, { name: `r${n}.pdf`, body: makePdf(pages) })).body().id);
  const users = () => cliCalls(s).filter(c => c.user !== undefined && c.user !== 'finish the turn').map(c => c.user);
  for (let n = 0; n < 3; n++) {
    assert.equal((await post(s, token, '/api/sessions/calm/send', { text: `read ${n}`, files: [ups[n]] })).status, 200);
    await until(() => users().length === n + 1);
    await finish(s, token, 'calm');
  }
  assert.deepEqual(users().map(u => (Array.isArray(u) ? u.map(b => b.type) : 'text')), [['document', 'text'], ['document', 'text'], 'text']);
  assert.equal(users()[2], `@"${dir}/${ups[2]}.pdf" @"${dir}/${ups[2]}.pdf.txt"\nread 2`);
  const ledger = JSON.parse(fs.readFileSync(path.join(s.state, 'documents.json'), 'utf8'));
  assert.deepEqual(Object.keys(ledger), ['calm']);
  assert.equal(ledger.calm.pages, 2 * DOCUMENT_MAX_PAGES);
  assert.equal(ledger.calm.bytes, 2 * fs.statSync(`${dir}/${ups[0]}.pdf`).size);
  assert.equal(fs.statSync(path.join(s.state, 'documents.json')).mode & 0o777, 0o600);

  const small = (await put(s, token, { name: 'one.pdf', body: makePdf(['one page']) })).body().id;
  assert.equal((await post(s, token, '/api/new', { cwd: s.home, text: '', files: [small] })).status, 200);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(s.state, 'documents.json'), 'utf8'))).sort(), ['begun-by-the-fake', 'calm'], 'a new chat is recorded under its own id');
});
