// The transcript as a list of display items. These are plain functions on plain data: items are never changed in
// place, so a row can tell by identity whether it needs to draw again.
import { plural } from './format.js';

export const CHROME = 'mcp__claude-in-chrome__';

let counter = 0;
const nextKey = () => `i${++counter}`;

function indexTools(list) {
  const at = new Map();
  list.forEach((i, n) => { if (i.kind === 'tool') at.set(i.id, n); });
  return at;
}

// Assistant text arrives one block per line, so consecutive blocks of one message are joined back up.
// A result whose tool sits in a chunk not loaded yet waits in `orphans` until that chunk arrives.
export function absorb({ items, orphans }, incoming) {
  const list = items.slice();
  const waiting = new Map(orphans);
  let toolAt = null;
  for (const item of incoming) {
    if (item.kind === 'result') {
      toolAt ||= indexTools(list);
      const at = toolAt.get(item.toolId);
      if (at === undefined) waiting.set(item.toolId, item);
      else list[at] = { ...list[at], status: item.status, output: item.output };
      continue;
    }
    const last = list[list.length - 1];
    if (item.kind === 'assistant' && last?.kind === 'assistant' && last.msgId === item.msgId) {
      list[list.length - 1] = { ...last, text: `${last.text}\n\n${item.text}` };
      continue;
    }
    if (item.kind === 'tool') toolAt?.set(item.id, list.length);
    list.push({ ...item, key: nextKey() });
  }
  return { items: list, orphans: waiting };
}

// Older items go in front. A tool whose result was waiting for them is settled, and a message cut in two by the chunk
// boundary is joined again.
export function prepend({ items, orphans }, incoming) {
  const older = absorb({ items: [], orphans: new Map() }, incoming);
  const waiting = new Map(orphans);
  const list = older.items.map(item => {
    const result = item.kind === 'tool' && waiting.get(item.id);
    if (!result) return item;
    waiting.delete(item.id);
    return { ...item, status: result.status, output: result.output };
  });
  for (const [id, result] of older.orphans) waiting.set(id, result);
  const seam = list[list.length - 1];
  if (seam?.kind === 'assistant' && items[0]?.kind === 'assistant' && items[0].msgId === seam.msgId) {
    list[list.length - 1] = { ...seam, text: `${seam.text}\n\n${items[0].text}` };
    return { items: [...list, ...items.slice(1)], orphans: waiting };
  }
  return { items: [...list, ...items], orphans: waiting };
}

// ---- grouped tool calls: Desktop's Normal view says what a run did instead of listing each call -----------

const EDITS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];
const KIND_OF = { Read: 'read', NotebookRead: 'read', Grep: 'search', Glob: 'search', Bash: 'run', WebSearch: 'web', WebFetch: 'fetch', Agent: 'agent', Task: 'agent', Skill: 'skill', TodoWrite: 'todo' };
const KINDS = {
  read: n => `read ${plural(n, 'file')}`,
  search: n => `searched ${plural(n, 'time')}`,
  run: n => `ran ${plural(n, 'command')}`,
  edit: n => `edited ${plural(n, 'file')}`,
  web: n => `searched the web ${plural(n, 'time')}`,
  fetch: n => `fetched ${plural(n, 'page')}`,
  agent: n => `started ${plural(n, 'agent')}`,
  skill: n => `used ${plural(n, 'skill')}`,
  todo: () => 'updated the to-do list',
  chrome: n => `used Chrome ${plural(n, 'time')}`,
  other: n => `used ${plural(n, 'tool')}`,
};
const toolKind = name => (EDITS.includes(name) ? 'edit' : KIND_OF[name] || ((name || '').startsWith(CHROME) ? 'chrome' : 'other'));

const splitLines = text => (text ? text.replace(/\n$/, '').split('\n') : []);

// The unchanged head and tail are trimmed, so changing one line inside a long block counts as one line.
export function lineDelta(before, after) {
  const a = splitLines(before);
  const b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return [b.length - head - tail, a.length - head - tail];
}

// Write and NotebookEdit carry no old text, so they count as added lines only.
function linesChanged(t) {
  const i = t.input || {};
  if (t.name === 'Edit') return lineDelta(i.old_string, i.new_string);
  if (t.name === 'MultiEdit') return (i.edits || []).reduce(([add, del], e) => { const [a, d] = lineDelta(e.old_string, e.new_string); return [add + a, del + d]; }, [0, 0]);
  return [splitLines(t.name === 'Write' ? i.content : i.new_source).length, 0];
}

// What a run of tool calls did: the sentence, the changed-line counts, and whether any call is running or failed.
export function summarize(tools) {
  const kinds = new Map();
  let added = 0;
  let removed = 0;
  let edited = false;
  const tally = { pending: 0, failed: 0, denied: 0 };
  for (const t of tools) {
    const kind = toolKind(t.name);
    if (!kinds.has(kind)) kinds.set(kind, new Set());
    kinds.get(kind).add(kind === 'read' || kind === 'edit' ? t.input?.file_path || t.input?.notebook_path || t.id : t.id);
    if (t.status in tally) tally[t.status]++;
    if (kind === 'edit') {
      edited = true;
      if (t.status === 'pending' || t.status === 'ok') { const [a, d] = linesChanged(t); added += a; removed += d; }
    }
  }
  const phrase = [...kinds].map(([kind, set]) => KINDS[kind](set.size)).join(', ');
  return {
    title: phrase[0].toUpperCase() + phrase.slice(1),
    edited,
    added,
    removed,
    note: tally.pending ? 'running' : [tally.failed && `${tally.failed} failed`, tally.denied && `${tally.denied} denied`].filter(Boolean).join(', '),
    status: tally.pending ? 'pending' : tally.failed || tally.denied ? 'failed' : 'ok',
  };
}

// Chips, chapters, widgets and questions render as themselves and end a run; every other tool call joins it.
export function groupable(i) {
  if (i.kind !== 'tool' || i.name === 'AskUserQuestion' || /__(spawn_task|dismiss_task|mark_chapter)$/.test(i.name)) return false;
  return !(/__show_widget$/.test(i.name) && i.input?.widget_code);
}

export function display(items) {
  const out = [];
  for (const i of items) {
    const last = out[out.length - 1];
    if (!groupable(i)) out.push(i);
    else if (last?.kind === 'group') last.tools.push(i);
    else out.push({ kind: 'group', tools: [i], key: `g${i.key}` });
  }
  return out;
}
