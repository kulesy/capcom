// Claude Code saves every session, whoever started it, as one JSON line per event in
// <projectsDir>/<folder slug>/<session id>.jsonl. This module finds those files and turns byte ranges of
// them into display items, so a 100 MB session opens by reading only its tail.
import fs from 'node:fs';
import path from 'node:path';

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
    if (!head.title && e.type === 'user' && !e.isMeta && !e.isSidechain && typeof e.message?.content === 'string') {
      const item = userItem(e.message.content);
      if (item?.kind === 'routine') { head.routine = item.name; head.title = item.name; }
      else if (item) head.title = item.text.slice(0, 120);
    }
    if (head.cwd && head.title) break;
  }
  if (head.title) heads.set(t.file, head);
  return head;
}

// ---- turning lines into display items ----------------------------------------------------------

const stripReminders = s => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();

function userItem(raw) {
  const text = stripReminders(raw);
  if (!text) return null;
  const routine = text.match(/^<scheduled-task name="([^"]+)"/);
  if (routine) return { kind: 'routine', name: routine[1] };
  const cmd = text.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = (text.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
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

function resultText(content, limit) {
  const parts = typeof content === 'string' ? [content] : (content || []).map(b => (b.type === 'text' ? b.text : b.type === 'image' ? '[image]' : ''));
  const text = parts.join('\n');
  return text.length > limit ? `${text.slice(0, limit)}\n... (${text.length - limit} more characters)` : text;
}

const DENIED = /doesn't want to proceed|was rejected|denied this|permission to use .* has been denied/i;

function itemsFromEntry(e, cwd, limit) {
  if (e.isSidechain || e.isMeta) return [];
  if (e.isCompactSummary) return [{ kind: 'divider', text: 'Earlier conversation was summarised to save space' }];
  if (e.type === 'system' && e.subtype === 'compact_boundary') return [{ kind: 'divider', text: 'Conversation compacted' }];
  const at = e.timestamp || null;
  if (e.type === 'user') {
    const c = e.message?.content;
    if (typeof c === 'string') { const item = userItem(c); return item ? [{ ...item, at }] : []; }
    const out = [];
    const texts = [];
    for (const b of c || []) {
      if (b.type === 'tool_result') {
        const output = resultText(b.content, limit);
        out.push({ kind: 'result', toolId: b.tool_use_id, status: b.is_error ? (DENIED.test(output) ? 'denied' : 'failed') : 'ok', output });
      } else if (b.type === 'text') texts.push(b.text);
      else if (b.type === 'image') texts.push('[image]');
    }
    const item = texts.length ? userItem(texts.join('\n')) : null;
    if (item) out.unshift({ ...item, at });
    return out;
  }
  if (e.type === 'assistant') {
    const msgId = e.message?.id || e.uuid;
    return (e.message?.content || []).flatMap(b => {
      if (b.type === 'text' && b.text.trim()) return [{ kind: 'assistant', msgId, text: b.text, at }];
      if (b.type === 'tool_use') return [{ kind: 'tool', id: b.id, name: b.name, summary: toolSummary(b.name, b.input, cwd), input: b.input, status: 'pending', at }];
      return [];
    });
  }
  return [];
}

function parseLines(text, cwd, limit) {
  const items = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    items.push(...itemsFromEntry(e, cwd, limit));
  }
  return items;
}

// Items from the chunk that ends at `end`, starting on a line boundary. A line longer than the chunk grows it.
export function readBefore(t, end, chunk, cwd, limit) {
  let start = Math.max(0, end - chunk);
  for (;;) {
    const buf = readRange(t.file, start, end);
    if (start === 0) return { items: parseLines(buf.toString('utf8'), cwd, limit), start: 0, end };
    const nl = buf.indexOf(0x0a);
    if (nl !== -1 && nl < buf.length - 1) {
      return { items: parseLines(buf.subarray(nl + 1).toString('utf8'), cwd, limit), start: start + nl + 1, end };
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
  return { items: parseLines(buf.subarray(0, last + 1).toString('utf8'), cwd, limit), end: from + last + 1 };
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
