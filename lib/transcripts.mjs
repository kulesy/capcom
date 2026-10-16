// Claude Code saves every session, whoever started it, as one JSON line per event in
// <projectsDir>/<folder slug>/<session id>.jsonl. This module finds those files and turns byte ranges of
// them into display items, so a 100 MB session opens by reading only its tail.
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_TYPES } from './images.mjs';
import { capText, noticeFrom } from './notices.mjs';

const files = new Map();
const heads = new Map();
let indexedAt = 0;

export function indexTranscripts(projectsDir, maxAgeMs = 4000) {
  if (Date.now() - indexedAt < maxAgeMs) return files;
  const seen = new Set();
  for (const dir of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const folder = path.join(projectsDir, dir.name);
    let names = [];
    try { names = fs.readdirSync(folder); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -6);
      try {
        const st = fs.statSync(path.join(folder, name));
        files.set(id, { id, file: path.join(folder, name), size: st.size, mtime: st.mtimeMs });
        seen.add(id);
      } catch {}
    }
  }
  for (const id of files.keys()) if (!seen.has(id)) files.delete(id);
  indexedAt = Date.now();
  return files;
}

export const transcriptFor = id => files.get(id) || null;

function readRange(file, start, end) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, end - start));
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf;
  } finally { fs.closeSync(fd); }
}

// The first lines carry the folder, branch and opening prompt, which is all a session row needs.
export function readHead(t) {
  const known = heads.get(t.file);
  if (known) return known;
  const text = readRange(t.file, 0, Math.min(t.size, 64 * 1024)).toString('utf8');
  const head = { cwd: '', branch: '', title: '', routine: null };
  for (const line of text.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!head.cwd && e.cwd) head.cwd = e.cwd;
    if (!head.branch && e.gitBranch && e.gitBranch !== 'HEAD') head.branch = e.gitBranch;
    if (e.type === 'custom-title' && e.customTitle) head.title = e.customTitle;
    if (!head.title && e.type === 'user' && !e.isMeta && !e.isSidechain) {
      const item = userItem(textOf(e.message?.content));
      if (item?.kind === 'routine') { head.routine = item.name; head.title = item.name; }
      else if (item && item.kind !== 'system') head.title = item.text.slice(0, 120);
    }
    if (head.cwd && head.title) break;
  }
  if (head.title) heads.set(t.file, head);
  return head;
}

// ---- turning lines into display items ----------------------------------------------------------

const stripReminders = s => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

const unwrapPasted = s => s.replace(/<\/?pasted_content(?:\s[^>]*)?>/g, '').trim();

const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '');

function userItem(raw, limit) {
  const text = unwrapPasted(stripReminders(raw));
  if (!text) return null;
  const notice = noticeFrom(text, limit);
  if (notice) return notice;
  const routine = text.match(/^<scheduled-task name="([^"]+)"/);
  if (routine) return { kind: 'routine', name: routine[1] };
  const cmd = text.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = (text.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
    if (cmd[1] === '/model' && args.trim()) return { kind: 'model', model: args.trim(), text: `/model ${args.trim()}` };
    return { kind: 'user', text: `${cmd[1].startsWith('/') ? '' : '/'}${cmd[1]} ${args}`.trim() };
  }
  if (/^<(local-command-stdout|local-command-stderr|command-message)>/.test(text)) return null;
  if (/^\[Request interrupted by user[^\]]*\]$/.test(text)) return { kind: 'divider', text: 'Stopped' };
  return { kind: 'user', text };
}

const relative = (p, cwd) => (cwd && typeof p === 'string' && p.startsWith(cwd + '/') ? p.slice(cwd.length + 1) : p);

const CHROME = 'mcp__claude-in-chrome__';

function chromeSummary(tool, input) {
  if (tool === 'navigate') return input.url || '';
  if (tool === 'computer') return [input.action, input.text, input.coordinate && `at ${input.coordinate.join(',')}`].filter(Boolean).join(' ');
  if (tool === 'javascript_tool') return String(input.text || '').split('\n')[0];
  if (tool === 'find') return input.query || '';
  if (tool === 'form_input') return `${input.ref || ''} = ${input.value ?? ''}`;
  return '';
}

export function toolSummary(name, input = {}, cwd = '') {
  const first = Object.values(input).find(v => typeof v === 'string') || '';
  if (name?.startsWith(CHROME)) return chromeSummary(name.slice(CHROME.length), input) || String(first).replace(/\s+/g, ' ');
  if (/__(spawn_task|mark_chapter)$/.test(name || '')) return input.title || '';
  if (/__show_widget$/.test(name || '')) return input.title || '';
  switch (name) {
    case 'AskUserQuestion': return input.questions?.[0]?.question || '';
    case 'Bash': return input.command || '';
    case 'Read': case 'Write': case 'Edit': case 'NotebookEdit': return relative(input.file_path || input.notebook_path || '', cwd);
    case 'Grep': return `${input.pattern || ''}${input.path ? `  in ${relative(input.path, cwd)}` : ''}`;
    case 'Glob': return input.pattern || '';
    case 'WebFetch': return input.url || '';
    case 'WebSearch': return input.query || '';
    case 'Agent': case 'Task': return input.description || '';
    case 'Skill': return input.skill || '';
    case 'TodoWrite': return `${(input.todos || []).length} items`;
    default: return String(first).replace(/\s+/g, ' ');
  }
}

// An image the page can draw: base64 data in one of the four types Capcom accepts.
const isImage = b => b?.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string' && IMAGE_TYPES.includes(b.source.media_type);

// The text of a tool result. An image the page can draw is listed on the item instead, so only one it cannot draw leaves a mark.
function resultText(content, limit) {
  const parts = typeof content === 'string' ? [content] : (content || []).flatMap(b => (b?.type === 'text' ? [b.text] : b?.type === 'image' ? (isImage(b) ? [] : ['[image]']) : ['']));
  return capText(parts.join('\n'), limit);
}

const imagesIn = content => (Array.isArray(content) ? content.filter(isImage) : []);

const DENIED = /doesn't want to proceed|was rejected|denied this|permission to use .* has been denied/i;

// NOTE: [16 Oct 2026] EK - A background task that ends mid-turn is saved as a queued_command with commandMode
// task-notification, not as a user entry (checked on CLI 2.1.301). Without it the result never shows.
const isQueuedPrompt = e => e.type === 'attachment' && e.attachment?.type === 'queued_command' && ['prompt', 'task-notification'].includes(e.attachment.commandMode);

// The content blocks of a message the user sent, as a typed message or as one queued while Claude was mid-turn.
function sentBlocks(e) {
  const c = e.type === 'user' ? e.message?.content : isQueuedPrompt(e) ? e.attachment.prompt : null;
  return Array.isArray(c) ? c : [];
}

const uuidOf = e => String(e.uuid || '').replace(/[^\w-]/g, '');

// A message the user sent as content blocks. Each image the page can draw becomes a ref on the item: the line's byte
// offset, the image's place among the message's images, and the entry's uuid, so a rewritten file never serves the wrong one.
function sentItem(blocks, e, at, offset, limit) {
  const texts = [];
  const images = [];
  for (const b of blocks) {
    if (b.type === 'text') texts.push(b.text);
    else if (b.type === 'image') {
      if (isImage(b)) images.push({ ref: `${offset}.${images.length}.${uuidOf(e)}`, type: b.source.media_type });
      else texts.push('[image]');
    }
  }
  const item = userItem(texts.join('\n'), limit) || (images.length ? { kind: 'user', text: '' } : null);
  if (!item) return null;
  return { ...item, ...(item.kind === 'user' && images.length && { images }), at };
}

function itemsFromEntry(e, cwd, limit, offset) {
  if (e.isSidechain || e.isMeta) return [];
  if (e.isCompactSummary) return [{ kind: 'divider', text: 'Earlier conversation was summarised to save space' }];
  if (e.type === 'system' && e.subtype === 'compact_boundary') return [{ kind: 'divider', text: 'Conversation compacted' }];
  const at = e.timestamp || null;
  // NOTE: [14 Oct 2026] EK - A message sent while Claude is mid-turn is saved as a queued_command attachment, not a
  // user entry (checked on CLI 2.1.299). Without this the redirect never shows in the transcript.
  if (isQueuedPrompt(e)) {
    const prompt = e.attachment.prompt;
    if (typeof prompt === 'string') { const item = userItem(prompt, limit); return item ? [{ ...item, at }] : []; }
    // With images the prompt is a list of content blocks, not a string (seen on CLI 2.1.300).
    const item = sentItem(sentBlocks(e), e, at, offset, limit);
    return item ? [item] : [];
  }
  if (e.type === 'user') {
    const c = e.message?.content;
    if (typeof c === 'string') { const item = userItem(c, limit); return item ? [{ ...item, at }] : []; }
    const out = [];
    const sent = [];
    // Pictures are numbered across every result on the line, as readImage counts them.
    let drawn = 0;
    for (const b of c || []) {
      if (b.type === 'tool_result') {
        const output = resultText(b.content, limit);
        const images = imagesIn(b.content).map(img => ({ ref: `${offset}.r${drawn++}.${uuidOf(e)}`, type: img.source.media_type }));
        out.push({ kind: 'result', toolId: b.tool_use_id, status: b.is_error ? (DENIED.test(output) ? 'denied' : 'failed') : 'ok', output, ...(images.length && { images }) });
      } else sent.push(b);
    }
    const item = sentItem(sent, e, at, offset, limit);
    if (item) out.unshift(item);
    return out;
  }
  if (e.type === 'assistant') {
    const msgId = e.message?.id || e.uuid;
    return (e.message?.content || []).flatMap(b => {
      if (b.type === 'text' && b.text.trim()) return [{ kind: 'assistant', msgId, text: b.text, at }];
      if (b.type === 'thinking' && b.thinking?.trim()) return [{ kind: 'thinking', msgId, text: capText(b.thinking, limit), at }];
      if (b.type === 'tool_use') return [{ kind: 'tool', id: b.id, name: b.name, summary: toolSummary(b.name, b.input, cwd), input: b.input, status: 'pending', at }];
      return [];
    });
  }
  return [];
}

// `base` is where `buf` starts in the file, so an item can say which line it came from.
function parseLines(buf, base, cwd, limit) {
  const items = [];
  for (let from = 0; from < buf.length;) {
    const nl = buf.indexOf(0x0a, from);
    const to = nl === -1 ? buf.length : nl;
    let e = null;
    try { if (to > from) e = JSON.parse(buf.toString('utf8', from, to)); } catch {}
    if (e) items.push(...itemsFromEntry(e, cwd, limit, base + from));
    from = to + 1;
  }
  return items;
}

// Items from the chunk that ends at `end`, starting on a line boundary. A line longer than the chunk grows it.
export function readBefore(t, end, chunk, cwd, limit) {
  let start = Math.max(0, end - chunk);
  for (;;) {
    const buf = readRange(t.file, start, end);
    if (start === 0) return { items: parseLines(buf, 0, cwd, limit), start: 0, end };
    const nl = buf.indexOf(0x0a);
    if (nl !== -1 && nl < buf.length - 1) {
      return { items: parseLines(buf.subarray(nl + 1), start + nl + 1, cwd, limit), start: start + nl + 1, end };
    }
    start = Math.max(0, start - chunk);
  }
}

// Items appended since `from`, stopping at the last complete line so a half-written one waits for the next read.
export function readAfter(t, from, cwd, limit) {
  const size = fs.statSync(t.file).size;
  if (size <= from) return { items: [], end: from };
  const buf = readRange(t.file, from, size);
  const last = buf.lastIndexOf(0x0a);
  if (last === -1) return { items: [], end: from };
  return { items: parseLines(buf.subarray(0, last + 1), from, cwd, limit), end: from + last + 1 };
}

// Where the last complete line ends; the tail read starts its window here.
export function completeEnd(t) {
  const size = fs.statSync(t.file).size;
  for (let back = 64 * 1024; ; back *= 4) {
    const start = Math.max(0, size - back);
    const last = readRange(t.file, start, size).lastIndexOf(0x0a);
    if (last !== -1) return start + last + 1;
    if (start === 0) return 0;
  }
}

// ---- one image, for the page to draw ------------------------------------------------------------

const MAX_LINE = 64 * 1024 * 1024;

// The finished line that starts at `offset`, or null.
function readLine(file, offset) {
  const fd = fs.openSync(file, 'r');
  try {
    const parts = [];
    for (let at = offset; at - offset < MAX_LINE;) {
      const buf = Buffer.allocUnsafe(1024 * 1024);
      const got = fs.readSync(fd, buf, 0, buf.length, at);
      if (!got) return null;
      const nl = buf.subarray(0, got).indexOf(0x0a);
      parts.push(buf.subarray(0, nl === -1 ? got : nl));
      if (nl !== -1) return Buffer.concat(parts);
      at += got;
    }
    return null;
  } finally { fs.closeSync(fd); }
}

// The pictures the tools returned on a user line, in the order itemsFromEntry numbers them.
const toolImages = e => (e.type === 'user' && Array.isArray(e.message?.content) ? e.message.content.flatMap(b => (b?.type === 'tool_result' ? imagesIn(b.content) : [])) : []);

// The bytes and type of the image a ref on an item names, or null when the line is not there any more.
// NOTE: [17 Oct 2026] EK - server.mjs serves the image route immutable for a year, so a ref must name the same picture for ever.
// A sent picture keeps its plain number and a tool's counts apart under an r. Never renumber either.
export function readImage(t, ref) {
  const m = /^(\d+)\.(r?)(\d+)\.([\w-]*)$/.exec(ref || '');
  if (!m || !Number.isSafeInteger(Number(m[1]))) return null;
  const line = readLine(t.file, Number(m[1]));
  let e = null;
  try { if (line) e = JSON.parse(line); } catch {}
  if (!e || uuidOf(e) !== m[4]) return null;
  const block = (m[2] ? toolImages(e) : sentBlocks(e).filter(isImage))[Number(m[3])];
  return block ? { type: block.source.media_type, bytes: Buffer.from(block.source.data, 'base64') } : null;
}
