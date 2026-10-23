// The files a reply links to, opened for the page. A chat may open a path only if a reply or a thought in that chat links to it as
// written, and that list is the whole gate: there is no folder to stay inside, so there is nothing for a `..` to climb out of.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileTarget, linkedFiles } from '../public/md.mjs';
import { sniff } from './images.mjs';
import { itemsFromEntry, keepScans } from './transcripts.mjs';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
const HEAD_BYTES = 4096;

// Only a line holding this is parsed, for the reason given above NEEDLES in lib/transcripts.mjs.
const NEEDLES = [Buffer.from('"type":"assistant"')];

// The page draws exactly the text of the assistant and thinking items with md, so those are the ones that link.
function scanLine(scan, line) {
  let e = null;
  try { e = JSON.parse(line); } catch {}
  if (!e) return;
  for (const item of itemsFromEntry(e, '', Infinity, 0)) {
    if (item.kind === 'assistant' || item.kind === 'thinking') for (const file of linkedFiles(item.text)) scan.paths.add(file);
  }
}

const linkScan = keepScans({ needles: NEEDLES, fresh: () => ({ paths: new Set() }), onLine: scanLine });

// Whether a chat links to a path: in its saved replies and thoughts, or in the reply it is writing now (`live`).
export function linksOf(t, live = '') {
  const saved = t ? linkScan(t).paths : new Set();
  const writing = linkedFiles(live);
  return file => saved.has(file) || writing.has(file);
}

const refuse = (status, message) => Object.assign(new Error(message), { status });

function unreadable(e) {
  if (['ENOENT', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG'].includes(e.code)) return refuse(404, 'There is no file at that path.');
  if (['EACCES', 'EPERM'].includes(e.code)) return refuse(403, 'Capcom cannot read that file.');
  if (['ENXIO', 'ENODEV', 'EOPNOTSUPP'].includes(e.code)) return refuse(415, 'Capcom opens plain files only.');
  return e;
}

// NONBLOCK so a pipe with no writer cannot hold the server, and NOCTTY so a terminal device cannot become its terminal.
const OPEN = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK | fs.constants.O_NOCTTY;

// The open file behind a linked path, as { fd, real, size }. The caller closes the fd.
function openLinked(raw, linked) {
  const target = typeof raw === 'string' ? fileTarget(raw) : null;
  if (!target || target.path !== raw) throw refuse(400, raw ? 'That is not a plain path to a file.' : 'Which file?');
  if (!linked(raw)) throw refuse(403, 'This chat does not link to that file.');
  let real;
  let fd;
  try {
    real = fs.realpathSync(raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw);
    fd = fs.openSync(real, OPEN);
  } catch (e) {
    throw unreadable(e);
  }
  try {
    const stat = fs.fstatSync(fd);
    if (stat.isDirectory()) throw refuse(415, 'That is a folder, not a file.');
    if (!stat.isFile()) throw refuse(415, 'Capcom opens plain files only.');
    return { fd, real, size: stat.size };
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
}

function readAt(fd, length) {
  const buf = Buffer.alloc(length);
  return buf.subarray(0, fs.readSync(fd, buf, 0, length, 0));
}

const MARKDOWN = /\.(?:md|markdown|mdx)$/i;

// A text file has no NUL and decodes as UTF-8. When the head ends mid-file, a character cut by it does not count against the file.
function decodes(head, cut) {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: cut });
    return true;
  } catch { return false; }
}

// What a file is, from its first bytes and its name. Capcom decides this and the browser is told, so a file never picks its own type.
// HTML and SVG are text here, so they are shown and sent as text and never run.
function kindOf(fd, size, name) {
  const head = readAt(fd, Math.min(size, HEAD_BYTES));
  const image = sniff(head);
  if (image) return { kind: 'image', type: image };
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', type: 'application/pdf' };
  if (decodes(head, size > HEAD_BYTES)) return { kind: MARKDOWN.test(name) ? 'markdown' : 'text', type: 'text/plain; charset=utf-8' };
  return { kind: 'binary', type: 'application/octet-stream' };
}

// The start of a long file is cut back to its last line, so a preview never ends half way along one.
function readText(fd, size) {
  const long = size > MAX_TEXT_BYTES;
  let buf = readAt(fd, Math.min(size, MAX_TEXT_BYTES));
  const end = buf.lastIndexOf(0x0a);
  if (long && end !== -1) buf = buf.subarray(0, end + 1);
  return { text: new TextDecoder().decode(buf, { stream: long }), ...(long && { truncated: true }) };
}

// What the page shows of a linked file. Throws an error with a `status` and a sentence for the page when it cannot be opened.
export function previewFile(raw, linked) {
  const file = openLinked(raw, linked);
  try {
    const name = path.posix.basename(raw);
    const { kind, type } = kindOf(file.fd, file.size, name);
    const preview = { name, path: raw, real: file.real, size: file.size, kind, type };
    if (file.size > MAX_FILE_BYTES) preview.tooLarge = true;
    else if (kind === 'text' || kind === 'markdown') Object.assign(preview, readText(file.fd, file.size));
    return preview;
  } finally {
    fs.closeSync(file.fd);
  }
}

// RFC 5987 keeps a name with any characters in it, and the quoted name is for a browser that reads only that.
function disposition(name, download) {
  const plainName = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? 'attachment' : 'inline'}; filename="${plainName}"; filename*=UTF-8''${encoded}`;
}

// The bytes of a linked file as { headers, stream }, the stream null for an empty file. The stream closes the file when it ends.
// Throws as previewFile does, and with a 413 for a file over MAX_FILE_BYTES.
export function serveFile(raw, linked, download) {
  const file = openLinked(raw, linked);
  try {
    if (file.size > MAX_FILE_BYTES) throw refuse(413, `That file is over ${MAX_FILE_BYTES / 1024 ** 2} MB, which is more than Capcom sends.`);
    const name = path.posix.basename(raw);
    const { kind, type } = kindOf(file.fd, file.size, name);
    const headers = {
      'content-type': type,
      'content-length': file.size,
      'content-disposition': disposition(name, download),
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'cross-origin-resource-policy': 'same-origin',
      // NOTE: [23 Oct 2026] EK - A PDF goes without the sandbox because Chrome's PDF viewer refuses a sandboxed document. nosniff and
      // application/pdf keep it from being read as HTML, so keep both on this response whatever else changes.
      ...(kind !== 'pdf' && { 'content-security-policy': "sandbox; default-src 'none'" }),
    };
    if (!file.size) {
      fs.closeSync(file.fd);
      return { headers, stream: null };
    }
    return { headers, stream: fs.createReadStream(null, { fd: file.fd, start: 0, end: file.size - 1 }) };
  } catch (e) {
    fs.closeSync(file.fd);
    throw e;
  }
}
