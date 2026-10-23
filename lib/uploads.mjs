// Files attached to a message. Capcom saves each upload in its state folder and the message mentions the file's path, as Claude
// Desktop's does, so the CLI reads the file itself. See docs/adr/20261023-attach-files-by-path.md.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// The reader of the mentions is shared with the page, which strips them from the words of a message it is still sending.
export { leadingMentions } from '../public/ui/files.js';
// So is the rule for a slash command, which the page applies before it puts a quote in front of the text.
export { isSlashCommand } from '../public/ui/command-rules.js';

// claude.ai's limit for one file.
export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_FILES = 10;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ID = new RegExp(`^${UUID}$`);
const ORIGINAL = new RegExp(`^(${UUID})(?:\\.[a-z0-9]{1,10})?$`);
const COMPANION = new RegExp(`^(${UUID})\\.(?:doc|docx|odt|rtf|pdf)\\.txt$`);
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

// The CLI expands a mention of a text file, and leaves these as binary, so each gets a text copy beside it. So does a PDF, which the CLI
// mentions by path and size only.
const CONVERTED = new Set(['doc', 'docx', 'odt', 'rtf']);
const COMPANIONED = new Set([...CONVERTED, 'pdf']);
const TEXTUTIL = '/usr/bin/textutil';
const OSASCRIPT = '/usr/bin/osascript';
// A PDF's page count and text from macOS's PDFKit. The first line is the page count, followed by " encrypted" for a PDF that opens
// without a password but is encrypted, or it is "locked" for one that needs a password, or "none" for a file PDFKit cannot open.
const PDFKIT = 'ObjC.import("PDFKit"); function run(argv) { const d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0])); if (!d || d.isNil()) return "none"; if (d.isLocked) return "locked"; const s = d.string; return d.pageCount + (d.isEncrypted ? " encrypted" : "") + "\\n" + (s.isNil() ? "" : s.js) }';

// NOTE: [23 Oct 2026] EK - A PDF goes to Claude as a document block only while it fits three budgets, because the CLI sends every earlier block
// again on each turn, so a block the API refuses fails every later turn of that chat. The API takes at most 100 pages and 32 MB of request
// (base64 is a third larger than the file), and each page also spends context. One message gets 20 pages and 3 MB. One chat gets 40 pages and
// 10 MB across all its messages, counted in documents.json in the state folder. Any other PDF goes by path with its text copy.
export const DOCUMENT_MAX_PAGES = 20;
export const DOCUMENT_MAX_BYTES = 3 * 1024 ** 2;
export const DOCUMENT_CHAT_MAX_PAGES = 40;
export const DOCUMENT_CHAT_MAX_BYTES = 10 * 1024 ** 2;

// A body that sends nothing for this long is dropped. The Node server's own request timeout, 300 seconds, still caps a whole upload.
const IDLE_MS = 60_000;

const TYPES = {
  pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json', html: 'text/html', xml: 'text/xml',
  zip: 'application/zip', rtf: 'application/rtf', doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

const refuse = (status, message) => Object.assign(new Error(message), { status });

// The name is only ever shown and stored in the sidecar, never used in a path.
const cleanName = raw => {
  let name = '';
  try { name = decodeURIComponent(String(raw ?? '')); } catch {}
  return [...name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')].slice(0, 255).join('').trim();
};

const cleanType = raw => {
  const type = String(raw ?? '').split(';')[0].trim().toLowerCase();
  return type.length <= 100 && MIME.test(type) ? type : '';
};

// The last extension, lowercased, when it is plain letters and digits. Anything else leaves the file without one.
export const extensionOf = name => {
  const ext = path.extname(name).slice(1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : '';
};

const MEGABYTES = MAX_FILE_BYTES / 1024 ** 2;

function readMeta(dir, id) {
  if (!id) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.meta.json`), 'utf8'));
    if (typeof meta?.name !== 'string') return null;
    return {
      name: meta.name, type: typeof meta.type === 'string' ? meta.type : '', size: Number.isFinite(meta.size) ? meta.size : null,
      pages: Number.isInteger(meta.pages) && meta.pages >= 0 ? meta.pages : null, encrypted: meta.encrypted === true,
    };
  } catch { return null; }
}

const sizeOf = file => { try { const st = fs.statSync(file); return st.isFile() ? st.size : null; } catch { return null; } };

const isFile = file => sizeOf(file) !== null;

const drop = (...files) => { for (const file of files) fs.rmSync(file, { force: true }); };

// Word's formats as plain text, or null when textutil cannot read the file.
const toText = file => new Promise(resolve => {
  execFile(TEXTUTIL, ['-convert', 'txt', '-stdout', file], { timeout: 15_000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' }, (err, out) => resolve(err || !out.length ? null : out));
});

// A PDF's { pages, encrypted, text }, or null when PDFKit cannot open it, or it needs a password.
const readPdf = file => new Promise(resolve => {
  execFile(OSASCRIPT, ['-l', 'JavaScript', '-e', PDFKIT, file], { timeout: 15_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, out) => {
    const lines = err ? null : /^(\d+)( encrypted)?\n([\s\S]*)$/.exec(out);
    resolve(lines ? { pages: Number(lines[1]), encrypted: !!lines[2], text: lines[3].replace(/\n$/, '') } : null);
  });
});

export function makeUploads(stateDir, { idleMs = IDLE_MS } = {}) {
  const dir = path.resolve(stateDir, 'uploads');
  const ledger = path.resolve(stateDir, 'documents.json');

  // The pages and bytes of the document blocks sent to each chat, as a Map of session id to { pages, bytes }. A file that cannot be read
  // counts as empty, and the next record replaces it.
  function readLedger() {
    let data = null;
    try { data = JSON.parse(fs.readFileSync(ledger, 'utf8')); } catch { /* nothing sent yet */ }
    const number = n => (Number.isFinite(n) && n > 0 ? n : 0);
    return new Map(data && typeof data === 'object' && !Array.isArray(data) ? Object.entries(data).map(([id, e]) => [id, { pages: number(e?.pages), bytes: number(e?.bytes) }]) : []);
  }

  // Adds the PDFs of a message that went as documents to what its chat has been sent. A write that fails is logged and not thrown, because the
  // message has already gone.
  function record(sessionId, files) {
    const sent = files.filter(f => f.document);
    if (!sessionId || !sent.length) return;
    try {
      const all = readLedger();
      const before = all.get(sessionId) || { pages: 0, bytes: 0 };
      all.set(sessionId, { pages: before.pages + sent.reduce((n, f) => n + f.pages, 0), bytes: before.bytes + sent.reduce((n, f) => n + f.size, 0) });
      const temp = `${ledger}.${process.pid}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(Object.fromEntries(all), null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temp, ledger);
    } catch (e) {
      console.error('Could not record the documents sent to a chat:', e.message);
    }
  }

  // Streams the request body to disk. The sign-in is checked again once the body has landed, because a new password can arrive
  // while a large file is still coming, and then nothing is kept.
  async function save(req, { signedIn }) {
    const name = cleanName(req.headers['x-file-name']) || 'file';
    const tooBig = refuse(413, `${name} is over the ${MEGABYTES} MB limit.`);
    if (Number(req.headers['content-length']) > MAX_FILE_BYTES) throw tooBig;
    const type = cleanType(req.headers['content-type']);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const id = crypto.randomUUID();
    const ext = extensionOf(name);
    const file = path.join(dir, ext ? `${id}.${ext}` : id);
    const meta = path.join(dir, `${id}.meta.json`);
    const companion = `${file}.txt`;
    const part = `${file}.part`;
    let size = 0;
    let stalled = false;
    let timer = null;
    const watch = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; req.destroy(); }, idleMs); };
    try {
      const handle = await fs.promises.open(part, 'wx', 0o600);
      try {
        // NOTE: [23 Oct 2026] EK - destroyOnReturn false, because leaving the loop on the limit would otherwise destroy the request's
        // socket and the 413 could never be sent.
        watch();
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          clearTimeout(timer);
          size += chunk.length;
          if (size > MAX_FILE_BYTES) throw tooBig;
          await handle.writeFile(chunk);
          watch();
        }
      } catch (e) {
        throw stalled ? refuse(408, `${name} stopped arriving.`) : e;
      } finally {
        clearTimeout(timer);
        await handle.close();
      }
      if (!signedIn()) throw refuse(401, 'Signed out.');
      fs.renameSync(part, file);
      const pdf = ext === 'pdf' ? await readPdf(file) : null;
      fs.writeFileSync(meta, JSON.stringify({ name, type, size, at: Date.now(), ...(pdf && { pages: pdf.pages, ...(pdf.encrypted && { encrypted: true }) }) }), { flag: 'wx', mode: 0o600 });
      const text = CONVERTED.has(ext) ? await toText(file) : pdf?.text;
      if (text && /\S/.test(text)) fs.writeFileSync(companion, text, { flag: 'wx', mode: 0o600 });
    } catch (e) {
      drop(part, file, meta, companion);
      throw e;
    }
    return { id, name, type, size };
  }

  // The uploads a message names, each as { id, name, path, size, pages, companion, document }, or the reason they are refused. A PDF is a
  // `document` when it can go as a document block, and then its text copy is left out of the message. `sessionId` is the chat it goes to,
  // whose earlier documents count against its budget. A message for a chat that does not exist yet has none. `blocks` is false for a message
  // sent while Claude works, because the CLI passes on only the text of a message it queues (checked on CLI 2.1.309).
  function readFiles(list, sessionId, { blocks = true } = {}) {
    if (list == null) return { files: [] };
    if (!Array.isArray(list)) return { error: 'Files must be a list.' };
    if (list.length > MAX_FILES) return { error: `Attach at most ${MAX_FILES} files to one message.` };
    const files = [];
    const before = (sessionId && readLedger().get(sessionId)) || { pages: 0, bytes: 0 };
    let pages = 0;
    let bytes = 0;
    for (const id of list) {
      const meta = typeof id === 'string' && ID.test(id) ? readMeta(dir, id) : null;
      const ext = meta ? extensionOf(meta.name) : '';
      const file = meta && path.join(dir, ext ? `${id}.${ext}` : id);
      const size = file ? sizeOf(file) : null;
      if (size === null) return { error: 'A file was not uploaded to GhostShell. Attach it again.' };
      const document = blocks && ext === 'pdf' && !meta.encrypted && meta.pages >= 1
        && pages + meta.pages <= DOCUMENT_MAX_PAGES && bytes + size <= DOCUMENT_MAX_BYTES
        && before.pages + pages + meta.pages <= DOCUMENT_CHAT_MAX_PAGES && before.bytes + bytes + size <= DOCUMENT_CHAT_MAX_BYTES;
      if (document) { pages += meta.pages; bytes += size; }
      files.push({ id, name: meta.name, path: file, size, pages: meta.pages, companion: COMPANIONED.has(ext) && isFile(`${file}.txt`) ? `${file}.txt` : null, document });
    }
    return { files };
  }

  // The PDFs that go as document blocks, read now, each as { mediaType, data } with the data in base64. Read in one go with no wait, so a
  // message's check of its chat's budget and the record of what it sent cannot be interleaved with another message to the same chat.
  function readDocuments(files) {
    try {
      return { documents: files.filter(f => f.document).map(f => ({ mediaType: 'application/pdf', data: fs.readFileSync(f.path).toString('base64') })) };
    } catch {
      return { error: 'A file was not uploaded to GhostShell. Attach it again.' };
    }
  }

  return { dir, save, readFiles, readDocuments, record };
}

// The prompt for a message with files: a mention of each file's path, the text copy after its original (unless the original goes
// as a document), then the typed text.
// NOTE: [23 Oct 2026] EK - The shape is Claude Desktop's: @"/abs/a.html" @"/abs/b.md", a newline, then the text. The CLI expands it
// (checked on CLI 2.1.309), and leadingMentions in public/ui/files.js reads it back. Change the two together.
export function withMentions(files, text) {
  const paths = files.flatMap(f => (f.companion && !f.document ? [f.path, f.companion] : [f.path]));
  if (!paths.length) return text;
  const lead = paths.map(p => `@"${p}"`).join(' ');
  return text.trim() ? `${lead}\n${text}` : lead;
}

// The files a message mentions, for the page to draw. A Capcom upload is described by its sidecar, and only inside `dir`, Capcom's
// own folder. Any other path, as Desktop mentions, goes by its file name alone and its size is not known, because a stat of a path on a
// network volume that has gone away would stall the server each time the chat is read.
export function fileItems(paths, dir = '') {
  const own = p => (dir && path.dirname(p) === dir ? path.basename(p) : '');
  const originals = new Set(paths.map(p => ORIGINAL.exec(own(p))?.[1]).filter(Boolean));
  return paths.filter(p => !originals.has(COMPANION.exec(own(p))?.[1])).map(p => {
    const meta = readMeta(dir, ORIGINAL.exec(own(p))?.[1]);
    const ext = extensionOf(p);
    return meta ? { name: meta.name, type: meta.type, size: meta.size, path: p } : { name: path.basename(p), type: Object.hasOwn(TYPES, ext) ? TYPES[ext] : '', size: own(p) ? sizeOf(p) : null, path: p };
  });
}
