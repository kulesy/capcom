// The files a reply links to, opened for the page. A chat may open a path only if a reply or a thought in that chat links to it as
// written, and that list is the whole gate: there is no folder to stay inside, so there is nothing for a `..` to climb out of.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileTarget, linkedFiles } from '../public/md.mjs';
import { sniff } from './images.mjs';
import { itemsFromEntry, keepScans } from './transcripts.mjs';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1024 * 1024;
const HEAD_BYTES = 4096;
const CHUNK_BYTES = 64 * 1024;

// Only a line holding this is parsed, for the reason given above NEEDLES in lib/transcripts.mjs.
const NEEDLES = [Buffer.from('"type":"assistant"')];

// The page draws exactly the text of the assistant and thinking items with md, so those are the ones that link. It is sent thinking cut
// at `limit` characters, so the scan reads it cut there too, or a path across the cut would link on the page and be refused here.
function scanLine(scan, line, limit) {
  let e = null;
  try { e = JSON.parse(line); } catch {}
  if (!e) return;
  for (const item of itemsFromEntry(e, '', limit, 0)) {
    if (item.kind === 'assistant' || item.kind === 'thinking') for (const file of linkedFiles(item.text)) scan.paths.add(file);
  }
}

// A scan reads a transcript once and then only what is added to it, and what it finds depends on the limit, so each limit has its own.
const scanners = new Map();
function scannerFor(limit) {
  if (!scanners.has(limit)) scanners.set(limit, keepScans({ needles: NEEDLES, fresh: () => ({ paths: new Set() }), onLine: (scan, line) => scanLine(scan, line, limit) }));
  return scanners.get(limit);
}

// Whether a chat links to a path: in its saved replies and thoughts, as the page is sent them cut at `limit` characters, or in the reply
// it is writing now (`live`).
export function linksOf(t, live = '', limit) {
  const saved = t ? scannerFor(limit)(t).paths : new Set();
  const writing = linkedFiles(live);
  return file => saved.has(file) || writing.has(file);
}

const refuse = (status, message) => Object.assign(new Error(message), { status });

function unreadable(e) {
  if (['ENOENT', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG'].includes(e.code)) return refuse(404, 'There is no file at that path.');
  if (['EACCES', 'EPERM'].includes(e.code)) return refuse(403, 'GhostShell cannot read that file.');
  if (['ENXIO', 'ENODEV', 'EOPNOTSUPP'].includes(e.code)) return refuse(415, 'GhostShell opens plain files only.');
  return e;
}

// NONBLOCK so a pipe with no writer cannot hold the server, and NOCTTY so a terminal device cannot become its terminal.
const OPEN = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK | fs.constants.O_NOCTTY;

function plainFile(stat) {
  if (stat.isDirectory()) throw refuse(415, 'That is a folder, not a file.');
  if (!stat.isFile()) throw refuse(415, 'GhostShell opens plain files only.');
}

// The open file behind a linked path, as { handle, real, size }. The caller closes the handle. Every call goes to the disk asynchronously,
// so a file that is only online in OneDrive or on a mount that has gone away holds up this request and not the server.
async function openLinked(raw, linked) {
  const target = typeof raw === 'string' ? fileTarget(raw) : null;
  if (!target || target.path !== raw) throw refuse(400, raw ? 'That is not a plain path to a file.' : 'Which file?');
  if (!linked(raw)) throw refuse(403, 'This chat does not link to that file.');
  let real;
  let handle;
  try {
    real = await fsp.realpath(raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw);
    // Looked at before it is opened, because opening a device such as a serial port can reset what is plugged into it.
    plainFile(await fsp.stat(real));
    handle = await fsp.open(real, OPEN);
  } catch (e) {
    throw unreadable(e);
  }
  try {
    const stat = await handle.stat();
    plainFile(stat);
    return { handle, real, size: stat.size };
  } catch (e) {
    await handle.close();
    throw e;
  }
}

async function readAt(handle, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = length ? await handle.read(buf, 0, length, 0) : { bytesRead: 0 };
  return buf.subarray(0, bytesRead);
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
async function kindOf(handle, size, name) {
  const head = await readAt(handle, Math.min(size, HEAD_BYTES));
  const image = sniff(head);
  if (image) return { kind: 'image', type: image };
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', type: 'application/pdf' };
  if (decodes(head, size > HEAD_BYTES)) return { kind: MARKDOWN.test(name) ? 'markdown' : 'text', type: 'text/plain; charset=utf-8' };
  return { kind: 'binary', type: 'application/octet-stream' };
}

// The start of a long file is cut back to its last line, so a preview never ends half way along one.
async function readText(handle, size) {
  const long = size > MAX_TEXT_BYTES;
  let buf = await readAt(handle, Math.min(size, MAX_TEXT_BYTES));
  const end = buf.lastIndexOf(0x0a);
  if (long && end !== -1) buf = buf.subarray(0, end + 1);
  return { text: new TextDecoder().decode(buf, { stream: long }), ...(long && { truncated: true }) };
}

// What the page shows of a linked file. Throws an error with a `status` and a sentence for the page when it cannot be opened.
export async function previewFile(raw, linked) {
  const file = await openLinked(raw, linked);
  try {
    const name = path.posix.basename(raw);
    const { kind, type } = await kindOf(file.handle, file.size, name);
    const preview = { name, path: raw, real: file.real, size: file.size, kind, type };
    if (file.size > MAX_FILE_BYTES) preview.tooLarge = true;
    else if (kind === 'text' || kind === 'markdown') Object.assign(preview, await readText(file.handle, file.size));
    return preview;
  } finally {
    await file.handle.close();
  }
}

// RFC 5987 keeps a name with any characters in it, and the quoted name is for a browser that reads only that.
function disposition(name, download) {
  const plainName = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? 'attachment' : 'inline'}; filename="${plainName}"; filename*=UTF-8''${encoded}`;
}

// The first `size` bytes of the file, which the response promised in its content-length. A file that has shrunk since fails the stream, so
// the response is cut short and the browser sees a broken download and not one that never finishes. Destroying the stream closes the handle.
function bytesOf(handle, size) {
  let at = 0;
  return new Readable({
    highWaterMark: CHUNK_BYTES,
    async read() {
      try {
        const buf = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, size - at));
        const { bytesRead } = await handle.read(buf, 0, buf.length, at);
        if (!bytesRead) throw new Error('The file got shorter while it was sent.');
        at += bytesRead;
        this.push(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
        if (at >= size) this.push(null);
      } catch (e) {
        this.destroy(e);
      }
    },
    destroy(error, done) {
      handle.close().then(() => done(error), () => done(error));
    },
  });
}

// The bytes of a linked file as { headers, stream }, the stream null for an empty file. The stream closes the file when it ends.
// Throws as previewFile does, and with a 413 for a file over MAX_FILE_BYTES.
export async function serveFile(raw, linked, download) {
  const file = await openLinked(raw, linked);
  let handed = false;
  try {
    if (file.size > MAX_FILE_BYTES) throw refuse(413, `That file is over ${MAX_FILE_BYTES / 1024 ** 2} MB, which is more than GhostShell sends.`);
    const name = path.posix.basename(raw);
    const { kind, type } = await kindOf(file.handle, file.size, name);
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
    if (!file.size) return { headers, stream: null };
    handed = true;
    return { headers, stream: bytesOf(file.handle, file.size) };
  } finally {
    if (!handed) await file.handle.close();
  }
}
