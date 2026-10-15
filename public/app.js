import { md, esc } from './md.mjs';

const $ = id => document.getElementById(id);
const app = $('app');
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(`capcom.${k}`)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(`capcom.${k}`, JSON.stringify(v)); } catch {} },
};

const ui = { index: null, query: '', archived: store.get('archived', false), collapsed: store.get('collapsed', {}), openRoutines: new Set(), verbose: store.get('verbose', false), first: null };
let chat = null;

async function api(path, body) {
  const r = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  if (r.status === 401) { location.reload(); throw new Error('Signed out'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { data });
  return data;
}

// ---- small formatting helpers ----------------------------------------------------------------------

const HOME = app.dataset.home;

function folderName(cwd = '') {
  const wt = cwd.match(/\/([^/]+)\/\.claude\/worktrees\/[^/]+/);
  if (wt) return wt[1];
  if (cwd === HOME) return '';
  return cwd.replace(HOME, '~').split('/').filter(Boolean).slice(-2).join('/');
}

function when(ms) {
  const t = typeof ms === 'number' ? ms : Date.parse(ms);
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'now';
  if (diff < 3600_000) return `${Math.round(diff / 60_000)} min`;
  const d = new Date(t);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (diff < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

const STATE_LABEL = { working: 'working', waiting: 'needs you', active: 'active', idle: '' };

function modelLabel(m = '') {
  const long = /\[1m\]$/i.test(m) ? ' (1M)' : '';
  const named = m.match(/(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/i);
  if (named) return `${named[1][0].toUpperCase()}${named[1].slice(1)} ${named[2]}${named[3] ? `.${named[3]}` : ''}${long}`;
  const alias = m.match(/^(opus|sonnet|haiku|fable)(\[1m\])?$/i);
  if (alias) return `${alias[1][0].toUpperCase()}${alias[1].slice(1)}${long}`;
  return m;
}

const settingsLine = s => [modelLabel(s?.shownModel || s?.model || ''), s?.effort && `${s.effort} effort`].filter(Boolean).join(', ');

// ---- the list --------------------------------------------------------------------------------------

function rowHtml(r, { title = r.title } = {}) {
  const meta = [folderName(r.cwd), r.branch, STATE_LABEL[r.state]].filter(Boolean).join('  ');
  const current = chat?.id === r.id ? ' aria-current="page"' : '';
  return `<li><a class="row" href="#/s/${encodeURIComponent(r.id)}"${current}>
    <span class="lamp" data-state="${r.state}" aria-hidden="true"></span>
    <span class="row-title">${esc(title || 'Untitled session')}</span>
    <time class="row-time">${esc(when(r.lastActivityAt))}</time>
    ${meta ? `<span class="row-meta">${esc(meta)}</span>` : ''}</a></li>`;
}

function section(key, name, count, body) {
  const open = !ui.collapsed[key];
  return `<section class="group"><button class="group-head" type="button" data-key="${esc(key)}" aria-expanded="${open}">${esc(name)} <span class="count">${count}</span></button>
    ${open ? `<ul class="rows">${body}</ul>` : ''}</section>`;
}

function routineHtml(g) {
  const open = ui.openRoutines.has(g.name);
  const earlier = g.earlier.length
    ? open
      ? `<ul class="earlier-runs">${g.earlier.map(r => rowHtml(r, { title: when(r.lastActivityAt) })).join('')}</ul>`
      : `<li class="more"><button class="link" type="button" data-routine="${esc(g.name)}">${g.earlier.length} earlier run${g.earlier.length > 1 ? 's' : ''}</button></li>`
    : '';
  return rowHtml(g.latest) + earlier;
}

function matches(r) {
  const q = ui.query.toLowerCase();
  return `${r.title} ${r.cwd} ${r.branch} ${r.routine || ''}`.toLowerCase().includes(q);
}

function renderList() {
  const ix = ui.index;
  if (!ix) return;
  $('problem').hidden = !ix.problem;
  $('problem').textContent = ix.problem ? `${ix.problem}. Sessions are listed without Desktop's groups.` : '';
  if (ui.query) {
    const all = [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.routines.flatMap(g => [g.latest, ...g.earlier]), ...ix.started, ...ix.ungrouped, ...ix.other];
    const seen = new Set();
    const hits = all.filter(r => !seen.has(r.id) && seen.add(r.id) && matches(r));
    $('sections').innerHTML = hits.length
      ? `<section class="group"><ul class="rows">${hits.slice(0, 80).map(r => rowHtml(r)).join('')}</ul></section>`
      : '<p class="quiet pad">No sessions match.</p>';
    return;
  }
  const parts = [];
  if (ix.pinned.length) parts.push(section('pinned', 'Pinned', ix.pinned.length, ix.pinned.map(r => rowHtml(r)).join('')));
  for (const g of ix.groups) if (g.sessions.length) parts.push(section(g.id, g.name, g.sessions.length, g.sessions.map(r => rowHtml(r)).join('')));
  if (ix.routines.length) parts.push(section('routines', 'Routines', ix.routines.length, ix.routines.map(routineHtml).join('')));
  if (ix.started.length) parts.push(section('started', 'Started here', ix.started.length, ix.started.map(r => rowHtml(r)).join('')));
  if (ix.ungrouped.length) parts.push(section('ungrouped', 'Ungrouped', ix.ungrouped.length, ix.ungrouped.map(r => rowHtml(r)).join('')));
  if (ix.other.length) parts.push(section('other', 'Terminal and other', ix.other.length, ix.other.map(r => rowHtml(r)).join('')));
  $('sections').innerHTML = parts.join('') || '<p class="quiet pad">No sessions found.</p>';
}

async function loadIndex() {
  try {
    ui.index = await api(`api/sessions${ui.archived ? '?archived=1' : ''}`);
    renderList();
  } catch (e) {
    if (!ui.index) $('sections').innerHTML = `<p class="quiet pad">Could not load sessions: ${esc(e.message)}</p>`;
  }
}

$('sections').addEventListener('click', e => {
  const head = e.target.closest('.group-head');
  if (head) {
    ui.collapsed[head.dataset.key] = head.getAttribute('aria-expanded') === 'true';
    store.set('collapsed', ui.collapsed);
    renderList();
  }
  const more = e.target.closest('[data-routine]');
  if (more) { ui.openRoutines.add(more.dataset.routine); renderList(); }
});

$('q').addEventListener('input', e => { ui.query = e.target.value.trim(); renderList(); });
$('archived').checked = ui.archived;
$('archived').addEventListener('change', e => { ui.archived = e.target.checked; store.set('archived', ui.archived); loadIndex(); });

// ---- the chat --------------------------------------------------------------------------------------

function newChat(id) {
  return { id, items: [], tools: new Map(), orphans: new Map(), chips: new Map(), rendered: [], start: 0, end: 0, hasEarlier: false, loaded: false, status: null, live: '', sending: [], es: null, session: null };
}

// Assistant text arrives one block per line, so consecutive blocks of one message are joined back up.
// A result whose tool sits in a chunk not loaded yet waits in `orphans` until that chunk arrives.
function absorb(list, tools, incoming, orphans) {
  for (const item of incoming) {
    if (item.kind === 'result') {
      const tool = tools.get(item.toolId);
      if (tool) Object.assign(tool, { status: item.status, output: item.output });
      else orphans?.set(item.toolId, item);
      continue;
    }
    const last = list[list.length - 1];
    if (item.kind === 'assistant' && last?.kind === 'assistant' && last.msgId === item.msgId) { last.text += `\n\n${item.text}`; continue; }
    const copy = { ...item };
    if (copy.kind === 'tool') tools.set(copy.id, copy);
    list.push(copy);
  }
  return list;
}

const CHROME = 'mcp__claude-in-chrome__';
const toolLabel = name => name.replace(/^mcp__.+?__/, '').replace(/_/g, ' ');
const clip = (text, lines = 40) => {
  const all = String(text ?? '').split('\n');
  return all.length > lines ? `${all.slice(0, lines).join('\n')}\n... ${all.length - lines} more lines` : all.join('\n');
};

function toolHtml(t) {
  const label = { pending: 'running', ok: 'ok', failed: 'failed', denied: 'denied' }[t.status] || t.status;
  const input = t.name === 'Bash' ? t.input?.command || '' : JSON.stringify(t.input ?? {}, null, 2);
  return `<li class="tool" data-status="${t.status}"><details data-k="${esc(t.id)}"><summary><span class="tool-name">${esc(toolLabel(t.name))}</span><span class="tool-sum">${esc(t.summary || '')}</span><span class="tool-status">${label}</span></summary>
    <pre class="tool-io">${esc(input)}</pre>${t.output ? `<pre class="tool-io">${esc(t.output)}</pre>` : ''}</details></li>`;
}

// ---- grouped tool calls: Desktop's Normal view says what a run did instead of listing each call ---------

const EDITS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];
const KIND_OF = { Read: 'read', NotebookRead: 'read', Grep: 'search', Glob: 'search', Bash: 'run', WebSearch: 'web', WebFetch: 'fetch', Agent: 'agent', Task: 'agent', Skill: 'skill', TodoWrite: 'todo' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
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
const toolKind = name => (EDITS.includes(name) ? 'edit' : KIND_OF[name] || (name.startsWith(CHROME) ? 'chrome' : 'other'));

const splitLines = text => (text ? text.replace(/\n$/, '').split('\n') : []);

// The unchanged head and tail are trimmed, so changing one line inside a long block counts as one line.
function lineDelta(before, after) {
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

function groupHtml(g) {
  const kinds = new Map();
  let added = 0;
  let removed = 0;
  let edited = false;
  const tally = { pending: 0, failed: 0, denied: 0 };
  for (const t of g.tools) {
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
  const note = tally.pending ? 'running' : [tally.failed && `${tally.failed} failed`, tally.denied && `${tally.denied} denied`].filter(Boolean).join(', ');
  const status = tally.pending ? 'pending' : tally.failed || tally.denied ? 'failed' : 'ok';
  return `<li class="tool-group" data-status="${status}"><details data-k="g:${esc(g.tools[0].id)}"><summary><span class="group-sum">${esc(phrase[0].toUpperCase() + phrase.slice(1))}</span>
    <span class="group-meta">${edited ? `<span class="add">+${added}</span> <span class="del">-${removed}</span>` : ''}<span class="tool-status">${note}</span></span></summary>
    <ul class="group-tools">${g.tools.map(toolHtml).join('')}</ul></details></li>`;
}

// Chips, chapters, widgets and questions render as themselves and end a run; every other tool call joins it.
function groupable(i) {
  if (i.kind !== 'tool' || i.name === 'AskUserQuestion' || /__(spawn_task|dismiss_task|mark_chapter)$/.test(i.name)) return false;
  return !(/__show_widget$/.test(i.name) && i.input?.widget_code);
}

function display(items) {
  if (ui.verbose) return items;
  const out = [];
  for (const i of items) {
    const last = out[out.length - 1];
    if (!groupable(i)) out.push(i);
    else if (last?.kind === 'group') last.tools.push(i);
    else out.push({ kind: 'group', tools: [i] });
  }
  return out;
}

// A chip from Capcom's own tool or from Desktop's, so chips in resumed Desktop sessions can be started here too.
function chipHtml(t) {
  const i = t.input || {};
  const chip = chat.chips.get(t.id);
  const status = chip?.status || 'open';
  const folder = chip?.cwd || i.cwd || chat.session?.cwd || '';
  const actions = status === 'started'
    ? `<a class="button" href="#/s/${encodeURIComponent(chip.startedId)}">Open the session</a>`
    : status === 'dismissed'
      ? '<span class="quiet">Dismissed</span>'
      : `<button class="button send" type="button" data-chip="start" data-tool="${esc(t.id)}" data-folder="${esc(folder)}">Start session</button>
         <button class="link" type="button" data-chip="dismiss" data-tool="${esc(t.id)}">Dismiss</button>`;
  return `<li class="chip-card" data-status="${status}">
    <p class="chip-kind">Suggested task${t.name.startsWith('mcp__capcom__') ? '' : ' from Desktop'}</p>
    <h4>${esc(i.title || 'Untitled task')}</h4>
    ${i.tldr ? `<p>${esc(i.tldr)}</p>` : ''}
    <pre class="tool-io chip-prompt">${esc(clip(i.prompt || '', 8))}</pre>
    <p class="chip-folder">Starts in ${esc(folder.replace(HOME, '~') || 'the session folder')}</p>
    <div class="chip-actions">${actions}</div></li>`;
}

// Widgets run in a sandbox with no same-origin access, so model-written HTML cannot read Capcom's cookie or press its buttons.
function widgetHtml(t) {
  const code = t.input?.widget_code || '';
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">
<style>:root{color-scheme:light dark;font:15px/1.45 -apple-system,system-ui,sans-serif}html,body{height:auto!important;min-height:0!important}body{margin:0;padding:4px}</style></head><body>${code}
<script>(function(){var lastIH=0,lastD=null,send=function(){var b=document.body,h=Math.ceil(Math.max(b.scrollHeight,b.getBoundingClientRect().height)),d=h-innerHeight;if(innerHeight!==lastIH&&d===lastD)return;lastIH=innerHeight;lastD=d;parent.postMessage({capcomHeight:h},'*')};new ResizeObserver(send).observe(document.body);addEventListener('load',send);send()})()</script></body></html>`;
  return `<li class="widget"><iframe sandbox="allow-scripts" title="${esc(t.input?.title || 'Widget')}" srcdoc="${esc(doc)}"></iframe></li>`;
}

function itemHtml(i) {
  if (i.kind === 'user') return `<li class="msg user${i.sending ? ' sending' : ''}">${esc(i.text)}</li>`;
  if (i.kind === 'assistant') return `<li class="msg claude">${md(i.text)}</li>`;
  if (i.kind === 'tool' && /__spawn_task$/.test(i.name)) return chipHtml(i);
  if (i.kind === 'tool' && /__mark_chapter$/.test(i.name)) return `<li class="chapter"><span>${esc(i.input?.title || 'Chapter')}</span></li>`;
  if (i.kind === 'tool' && /__show_widget$/.test(i.name) && i.input?.widget_code) return widgetHtml(i);
  if (i.kind === 'tool' && /__dismiss_task$/.test(i.name)) return '<li hidden></li>';
  if (i.kind === 'tool') return toolHtml(i);
  if (i.kind === 'group') return groupHtml(i);
  if (i.kind === 'model') return `<li class="divider">Model set to ${esc(modelLabel(i.model))}</li>`;
  if (i.kind === 'routine') return `<li class="divider">Started by the ${esc(i.name)} routine</li>`;
  if (i.kind === 'divider') return `<li class="divider">${esc(i.text)}</li>`;
  return '<li hidden></li>';
}

const atBottom = el => el.scrollHeight - el.scrollTop - el.clientHeight < 80;

// Only changed rows are replaced, so a running widget is not reloaded and expanded tool rows and groups stay open.
function renderItems({ keepBottom = true, rebuild = false } = {}) {
  const box = $('transcript');
  const stick = keepBottom && atBottom(box);
  const list = $('items');
  if (rebuild) { list.textContent = ''; chat.rendered = []; }
  const html = [...display(chat.items), ...chat.sending.map(text => ({ kind: 'user', text, sending: true }))].map(itemHtml);
  for (let i = 0; i < html.length; i++) {
    const old = list.children[i];
    if (old && chat.rendered[i] === html[i]) continue;
    const tpl = document.createElement('template');
    tpl.innerHTML = html[i].trim();
    const el = tpl.content.firstElementChild;
    if (old) {
      const open = new Set([...old.querySelectorAll('details[open]')].map(d => d.dataset.k));
      for (const d of el.querySelectorAll('details')) if (d.dataset.k && open.has(d.dataset.k)) d.setAttribute('open', '');
    }
    if (old) list.replaceChild(el, old); else list.appendChild(el);
  }
  while (list.children.length > html.length) list.lastElementChild.remove();
  chat.rendered = html;
  $('earlier').hidden = !chat.hasEarlier;
  renderLive(false);
  if (stick) box.scrollTop = box.scrollHeight;
}

window.addEventListener('message', e => {
  if (typeof e.data?.capcomHeight !== 'number') return;
  for (const frame of document.querySelectorAll('.widget iframe')) {
    if (frame.contentWindow === e.source) frame.style.height = `${Math.min(Math.max(e.data.capcomHeight, 40), 1600)}px`;
  }
});

function renderLive(scroll = true) {
  const box = $('transcript');
  const stick = scroll && atBottom(box);
  $('live').hidden = !chat.live;
  $('live').innerHTML = chat.live ? md(chat.live) : '';
  const state = chat.status?.state || 'idle';
  $('working').hidden = !(state === 'working' && !chat.live);
  if (stick) box.scrollTop = box.scrollHeight;
}

// ---- approval cards: say exactly what is about to happen ---------------------------------------------

function chromeCard(tool, i) {
  const known = {
    navigate: ['open a page', [['URL', i.url], ['Tab', i.tabId]]],
    computer: [`${i.action || 'act'} on a page`, [['Action', i.action], ['Text', i.text], ['Where', i.coordinate?.join(', ') || i.ref], ['Tab', i.tabId]]],
    javascript_tool: ['run JavaScript in a tab', [['Script', i.text], ['Tab', i.tabId]]],
    form_input: ['fill in a form field', [['Field', i.ref], ['Value', i.value === undefined ? '' : String(i.value)], ['Tab', i.tabId]]],
    find: ['search a page', [['Looking for', i.query], ['Tab', i.tabId]]],
    file_upload: ['upload a file', [['Files', (i.paths || []).join('\n')], ['Field', i.ref], ['Tab', i.tabId]]],
  }[tool];
  if (known) return { title: `Chrome wants to ${known[0]}`, fields: known[1] };
  return { title: `Chrome wants to use ${toolLabel(tool)}`, fields: Object.entries(i).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]) };
}

function cardParts(p) {
  const i = p.input || {};
  if (p.tool === 'Bash') return { title: 'Bash wants to run a command', fields: [['Command', i.command]] };
  if (p.tool === 'Edit') return { title: `Edit wants to change ${p.summary}`, diff: [i.old_string, i.new_string] };
  if (p.tool === 'Write') return { title: `Write wants to create or replace ${p.summary}`, fields: [['New content', clip(i.content)]] };
  if (p.tool === 'NotebookEdit') return { title: `NotebookEdit wants to change ${p.summary}`, fields: [['New source', clip(i.new_source)]] };
  if (p.tool === 'Read') return { title: `Read wants to open ${p.summary}`, fields: [] };
  if (p.tool === 'WebFetch') return { title: 'WebFetch wants to fetch a page', fields: [['URL', i.url], ['Asks', i.prompt]] };
  if (p.tool === 'WebSearch') return { title: 'WebSearch wants to search the web', fields: [['Query', i.query]] };
  if (p.tool === 'Agent' || p.tool === 'Task') return { title: 'Claude wants to start a subagent', fields: [['Task', i.description], ['Prompt', clip(i.prompt, 12)]] };
  if (p.tool?.startsWith(CHROME)) return chromeCard(p.tool.slice(CHROME.length), i);
  const mcp = p.tool?.match(/^mcp__(.+?)__(.+)$/);
  const fields = Object.entries(i).filter(([, v]) => v !== '' && v != null).slice(0, 8).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v, null, 2)]);
  return { title: mcp ? `${mcp[1]} wants to use ${toolLabel(mcp[2])}` : `${p.label} wants to run`, fields };
}

function approvalHtml(p) {
  const c = cardParts(p);
  const fields = (c.fields || []).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const diff = c.diff && `<pre class="diff">${clip(c.diff[0], 30).split('\n').map(l => `<span class="del">- ${esc(l)}</span>`).join('\n')}\n${clip(c.diff[1], 30).split('\n').map(l => `<span class="add">+ ${esc(l)}</span>`).join('\n')}</pre>`;
  return `<article class="approval" data-id="${esc(p.requestId)}">
    <h3><span class="lamp" data-state="waiting" aria-hidden="true"></span>${esc(c.title)}</h3>
    ${fields.length ? `<dl class="fields">${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd><pre>${esc(String(v))}</pre></dd>`).join('')}</dl>` : ''}
    ${diff || ''}
    ${p.description ? `<p>${esc(p.description)}</p>` : ''}
    <details><summary>All input</summary><pre>${esc(JSON.stringify(p.input ?? {}, null, 2))}</pre></details>
    <div class="approval-actions">
      <button class="button send" type="button" data-decision="allow">Allow</button>
      ${p.suggestions?.length && !p.tool?.startsWith(CHROME) ? '<button class="button" type="button" data-decision="always">Always allow</button>' : ''}
      <button class="button" type="button" data-decision="deny">Deny</button>
    </div></article>`;
}

// ---- questions: Claude's multiple-choice asks, answered with buttons ----------------------------------

const picks = new Map();

function pickState(p) {
  if (!picks.has(p.requestId)) picks.set(p.requestId, (p.input?.questions || []).map(() => ({ chosen: new Set(), other: '' })));
  return picks.get(p.requestId);
}

function answersFor(p) {
  const state = pickState(p);
  const answers = {};
  (p.input?.questions || []).forEach((q, qi) => {
    const labels = [...state[qi].chosen].map(oi => q.options[oi]?.label).filter(Boolean);
    if (state[qi].other.trim()) labels.push(state[qi].other.trim());
    if (labels.length) answers[q.question] = labels.join(', ');
  });
  return answers;
}

function questionHtml(p) {
  const state = pickState(p);
  const qs = p.input?.questions || [];
  const complete = Object.keys(answersFor(p)).length === qs.length;
  return `<article class="approval question" data-id="${esc(p.requestId)}">
    <h3><span class="lamp" data-state="waiting" aria-hidden="true"></span>Claude is asking</h3>
    ${qs.map((q, qi) => `<fieldset class="ask" data-q="${qi}">
      <legend>${q.header ? `<span class="ask-head">${esc(q.header)}</span>` : ''}${esc(q.question)}${q.multiSelect ? ' <span class="quiet">(pick any)</span>' : ''}</legend>
      <div class="options">${(q.options || []).map((o, oi) => `<button class="option" type="button" data-q="${qi}" data-o="${oi}" aria-pressed="${state[qi].chosen.has(oi)}">
        <strong>${esc(o.label)}</strong>${o.description ? `<span>${esc(o.description)}</span>` : ''}</button>
        ${o.preview && state[qi].chosen.has(oi) ? `<pre class="preview">${esc(o.preview)}</pre>` : ''}`).join('')}</div>
      <input class="other" type="text" data-q="${qi}" value="${esc(state[qi].other)}" placeholder="Or write your own answer" aria-label="Your own answer">
    </fieldset>`).join('')}
    <div class="approval-actions">
      <button class="button send" type="button" data-decision="answer"${complete ? '' : ' disabled'}>Send answers</button>
      <button class="button" type="button" data-decision="deny">Skip</button>
    </div></article>`;
}

function renderApprovals() {
  const pending = chat.status?.pending || [];
  for (const id of picks.keys()) if (!pending.some(p => p.requestId === id)) picks.delete(id);
  const typing = document.activeElement?.classList.contains('other') ? document.activeElement : null;
  const where = typing && { id: typing.closest('.approval').dataset.id, q: typing.dataset.q, at: typing.selectionStart };
  $('approvals').innerHTML = pending.map(p => (p.tool === 'AskUserQuestion' ? questionHtml(p) : approvalHtml(p))).join('');
  const again = where && $('approvals').querySelector(`.approval[data-id="${CSS.escape(where.id)}"] .other[data-q="${where.q}"]`);
  if (again) { again.focus(); again.setSelectionRange(where.at, where.at); }
}

const isBusy = s => s?.state === 'working' || s?.state === 'waiting';

// A model or effort the list does not hold, such as one Desktop recorded, gets an option of its own so the box shows the truth.
function syncPick(select, value, label) {
  for (const o of [...select.options]) if (o.dataset.extra && o.value !== value) o.remove();
  if (value && ![...select.options].some(o => o.value === value)) {
    const extra = new Option(label(value), value);
    extra.dataset.extra = '1';
    select.add(extra);
  }
  if (select.value !== (value || '')) select.value = value || '';
}

function renderStatus() {
  const s = chat.status || { state: 'idle', pending: [], mode: 'manual', chrome: true };
  const busy = isBusy(s);
  $('chatLamp').dataset.state = s.state;
  for (const id of ['mode', 'model', 'effort']) $(id).disabled = !chat.status;
  $('mode').value = s.mode || 'manual';
  syncPick($('model'), s.shownModel || s.model, modelLabel);
  syncPick($('effort'), s.effort, e => e);
  $('chrome').setAttribute('aria-checked', String(!!s.chrome));
  $('chrome').disabled = !chat.status || (busy && !chat.draft);
  $('chromeHint').textContent = busy && !chat.draft ? 'Wait for Claude to finish this turn' : 'Asks before each action';
  $('chromeTag').hidden = !s.chrome;
  renderComposer();
  renderHead();
  renderApprovals();
  renderLive();
}

// While Claude works and the box is empty, the Send button is the Stop button. Typing turns it back into Send.
function renderComposer() {
  const typed = !!textBox.value.trim();
  const stop = isBusy(chat?.status) && !chat?.draft && !typed;
  const button = $('send');
  button.textContent = stop ? 'Stop' : 'Send';
  button.dataset.act = stop ? 'stop' : 'send';
  button.disabled = !stop && (!typed || !!chat?.starting);
}

function notice(text) {
  $('notice').textContent = text || '';
  $('notice').hidden = !text;
}

function renderHead() {
  const s = chat.session;
  if (chat.draft) {
    $('title').textContent = 'New session';
    $('meta').textContent = 'Starts Claude Code in the folder you pick';
    document.title = 'New session · Capcom';
    return;
  }
  $('title').textContent = s?.title || 'Session';
  $('meta').textContent = s ? [folderName(s.cwd), s.branch, s.routine ? `${s.routine} routine` : '', settingsLine(chat.status)].filter(Boolean).join('  ') : '';
  document.title = s?.title ? `${s.title} · Capcom` : 'Capcom';
}

async function fetchNew() {
  if (!chat?.loaded) return;
  if (chat.fetching) { chat.again = true; return; }
  const current = chat;
  current.fetching = true;
  try {
    const r = await api(`api/sessions/${encodeURIComponent(current.id)}/messages?after=${current.end}`);
    if (chat !== current) return;
    if (r.reset) {
      Object.assign(current, { items: [], tools: new Map(), orphans: new Map(), start: r.start, hasEarlier: r.hasEarlier });
    }
    absorb(current.items, current.tools, r.items, current.orphans);
    current.end = r.end;
    for (const i of r.items) if (i.kind === 'user') current.sending = current.sending.filter(t => t.trim() !== i.text.trim());
    if (r.items.some(i => i.kind === 'assistant')) current.live = '';
    if (r.items.some(i => /__(spawn|dismiss)_task$/.test(i.name || ''))) await loadChips(current);
    if (chat !== current) return;
    renderItems({ rebuild: !!r.reset });
  } catch (e) {
    notice(e.message);
  } finally {
    current.fetching = false;
    if (current.again) { current.again = false; fetchNew(); }
  }
}

function connect(c) {
  const es = new EventSource(`api/sessions/${encodeURIComponent(c.id)}/events`);
  c.es = es;
  const on = (type, fn) => es.addEventListener(type, e => { if (chat === c) fn(JSON.parse(e.data || '{}')); });
  on('status', s => { c.status = s; c.live = s.live || ''; renderStatus(); notice(''); fetchNew(); });
  on('state', d => { c.status = { ...c.status, state: d.state }; renderStatus(); });
  on('delta', d => { c.live += d.text; renderLive(); });
  on('changed', () => fetchNew());
  on('approval', p => { c.status = { ...c.status, pending: [...(c.status?.pending || []).filter(x => x.requestId !== p.requestId), p] }; renderStatus(); });
  on('approval-resolved', d => { c.status = { ...c.status, pending: (c.status?.pending || []).filter(x => x.requestId !== d.requestId) }; renderStatus(); });
  on('mode', d => { c.status = { ...c.status, mode: d.mode }; renderStatus(); });
  on('model', d => { c.status = { ...c.status, model: d.model, shownModel: d.model }; renderStatus(); });
  on('effort', d => { c.status = { ...c.status, effort: d.effort }; renderStatus(); });
  on('chrome', d => { c.status = { ...c.status, chrome: d.chrome }; renderStatus(); });
  on('turn-end', d => { c.live = ''; if (d.error) notice(d.message || 'The last turn ended with an error.'); fetchNew(); loadIndex(); });
  on('error', d => notice(d.message));
  on('exit', () => { c.status = { ...c.status, running: false, state: 'idle', pending: [] }; renderStatus(); });
  es.onerror = () => { if (chat === c) notice(es.readyState === EventSource.CLOSED ? 'Lost contact with the Mac.' : ''); };
}

async function loadChips(c) {
  try {
    const { chips } = await api(`api/sessions/${encodeURIComponent(c.id)}/chips`);
    c.chips = new Map(chips.map(ch => [ch.toolUseId, ch]));
  } catch {}
}

async function openSession(id) {
  if (chat?.id === id) { show('session'); return; }
  chat?.es?.close();
  chat = newChat(id);
  if (ui.first?.id === id) { chat.sending.push(ui.first.text); ui.first = null; }
  show('session');
  $('items').innerHTML = '';
  $('approvals').innerHTML = '';
  $('earlier').hidden = true;
  $('live').hidden = true;
  $('working').hidden = true;
  notice('');
  renderComposer();
  const row = findRow(id);
  chat.session = row && { title: row.title, cwd: row.cwd, branch: row.branch, routine: row.routine };
  renderHead();
  renderStatus();
  renderList();
  const c = chat;
  try {
    const r = await api(`api/sessions/${encodeURIComponent(id)}/messages`);
    if (chat !== c) return;
    c.session = r.session || c.session;
    renderHead();
    absorb(c.items, c.tools, r.items, c.orphans);
    c.sending = c.sending.filter(t => !c.items.some(i => i.kind === 'user' && i.text.trim() === t.trim()));
    Object.assign(c, { start: r.start, end: r.end, hasEarlier: r.hasEarlier, loaded: true });
    await loadChips(c);
    if (chat !== c) return;
    renderItems({ keepBottom: false, rebuild: true });
    $('transcript').scrollTop = $('transcript').scrollHeight;
  } catch (e) {
    notice(`Could not open this session: ${e.message}`);
  }
  if (chat === c) connect(c);
}

function findRow(id) {
  const ix = ui.index;
  if (!ix) return null;
  return [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.routines.flatMap(g => [g.latest, ...g.earlier]), ...ix.started, ...ix.ungrouped, ...ix.other].find(r => r.id === id) || null;
}

$('earlier').addEventListener('click', async () => {
  const c = chat;
  const box = $('transcript');
  const from = box.scrollHeight - box.scrollTop;
  $('earlier').disabled = true;
  try {
    const r = await api(`api/sessions/${encodeURIComponent(c.id)}/messages?before=${c.start}`);
    if (chat !== c) return;
    const tools = new Map();
    const older = absorb([], tools, r.items, null);
    for (const [k, tool] of tools) {
      const result = c.orphans.get(k);
      if (result) { Object.assign(tool, { status: result.status, output: result.output }); c.orphans.delete(k); }
      c.tools.set(k, tool);
    }
    const seam = older[older.length - 1];
    if (seam?.kind === 'assistant' && c.items[0]?.kind === 'assistant' && c.items[0].msgId === seam.msgId) {
      seam.text += `\n\n${c.items.shift().text}`;
    }
    c.items = older.concat(c.items);
    Object.assign(c, { start: r.start, hasEarlier: r.hasEarlier });
    renderItems({ keepBottom: false, rebuild: true });
    box.scrollTop = box.scrollHeight - from;
  } catch (e) {
    notice(e.message);
  } finally {
    $('earlier').disabled = false;
  }
});

const textBox = $('text');
function fit(el) {
  el.style.height = 'auto';
  const max = window.innerHeight * 0.4;
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
}
textBox.addEventListener('input', () => { fit(textBox); renderComposer(); });
textBox.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
    e.preventDefault();
    if (textBox.value.trim()) $('composer').requestSubmit();
  }
});

// Sent while Claude works, a message redirects it without stopping: Claude reads it before its next step.
$('composer').addEventListener('submit', async e => {
  e.preventDefault();
  const text = textBox.value.trim();
  if (!text || !chat) return;
  const c = chat;
  if (c.draft) { startSession(c, text); return; }
  c.sending.push(text);
  textBox.value = '';
  fit(textBox);
  renderComposer();
  notice('');
  renderItems();
  $('transcript').scrollTop = $('transcript').scrollHeight;
  try {
    c.status = await api(`api/sessions/${encodeURIComponent(c.id)}/send`, { text, mode: $('mode').value });
    renderStatus();
  } catch (err) {
    c.sending = c.sending.filter(t => t !== text);
    textBox.value = text;
    fit(textBox);
    renderComposer();
    renderItems();
    notice(`Not sent: ${err.message}`);
  }
});

async function stopRun() {
  try { await api(`api/sessions/${encodeURIComponent(chat.id)}/stop`, {}); } catch (e) { notice(e.message); }
}

$('send').addEventListener('click', e => {
  if ($('send').dataset.act !== 'stop') return;
  e.preventDefault();
  stopRun();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.isComposing) return;
  if (!$('plusMenu').hidden) closeMenu();
  else if (chat && !chat.draft && isBusy(chat.status)) stopRun();
});

const pendingFor = id => (chat?.status?.pending || []).find(p => p.requestId === id);

$('approvals').addEventListener('click', async e => {
  const option = e.target.closest('.option');
  if (option) {
    const p = pendingFor(option.closest('.approval').dataset.id);
    const q = p.input.questions[Number(option.dataset.q)];
    const state = pickState(p)[Number(option.dataset.q)];
    const o = Number(option.dataset.o);
    if (q.multiSelect) { if (state.chosen.has(o)) state.chosen.delete(o); else state.chosen.add(o); }
    else { state.chosen = new Set(state.chosen.has(o) ? [] : [o]); state.other = ''; }
    renderApprovals();
    return;
  }
  const button = e.target.closest('[data-decision]');
  if (!button) return;
  const card = button.closest('.approval');
  const p = pendingFor(card.dataset.id);
  const body = { requestId: card.dataset.id, decision: button.dataset.decision };
  if (body.decision === 'answer') body.answers = answersFor(p);
  card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    await api(`api/sessions/${encodeURIComponent(chat.id)}/approve`, body);
  } catch (err) {
    notice(err.message);
    card.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
});

$('approvals').addEventListener('input', e => {
  if (!e.target.classList.contains('other')) return;
  const card = e.target.closest('.approval');
  const p = pendingFor(card.dataset.id);
  const qi = Number(e.target.dataset.q);
  const state = pickState(p)[qi];
  state.other = e.target.value;
  if (state.other && !p.input.questions[qi].multiSelect) state.chosen.clear();
  card.querySelector('[data-decision="answer"]').disabled = Object.keys(answersFor(p)).length !== p.input.questions.length;
  card.querySelectorAll(`.option[data-q="${qi}"]`).forEach(b => b.setAttribute('aria-pressed', String(state.chosen.has(Number(b.dataset.o)))));
});

$('items').addEventListener('click', async e => {
  const button = e.target.closest('[data-chip]');
  if (!button) return;
  const c = chat;
  const tool = c.tools.get(button.dataset.tool);
  if (!tool) return;
  button.disabled = true;
  try {
    const r = await api(`api/chips/${button.dataset.chip}`, { sessionId: c.id, toolUseId: tool.id, title: tool.input?.title, tldr: tool.input?.tldr,
      prompt: tool.input?.prompt, cwd: tool.input?.cwd, confirmCwd: button.dataset.folder });
    c.chips.set(tool.id, r.chip);
    renderItems();
    loadIndex();
  } catch (err) {
    if (err.data?.chip) { c.chips.set(tool.id, err.data.chip); renderItems(); return; }
    notice(err.message);
    button.disabled = false;
  }
});

function closeMenu() {
  $('plusMenu').hidden = true;
  $('plus').setAttribute('aria-expanded', 'false');
}

$('plus').addEventListener('click', () => {
  const open = $('plusMenu').hidden;
  $('plusMenu').hidden = !open;
  $('plus').setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', e => { if (!e.target.closest('.plus')) closeMenu(); });

// Until a new session starts, the box holds its settings locally; the ones left alone follow the folder's defaults.
function setDraft(patch) {
  for (const k of Object.keys(patch)) chat.draft.touched.add(k === 'shownModel' ? 'model' : k);
  chat.status = { ...chat.status, ...patch };
  renderStatus();
}

async function setChrome(on) {
  closeMenu();
  if (chat.draft) { setDraft({ chrome: on }); return; }
  try {
    chat.status = await api(`api/sessions/${encodeURIComponent(chat.id)}/chrome`, { on, mode: $('mode').value });
    renderStatus();
  } catch (err) { notice(err.message); }
}

$('chrome').addEventListener('click', () => setChrome($('chrome').getAttribute('aria-checked') !== 'true'));
$('chromeTag').addEventListener('click', () => setChrome(false));

$('mode').addEventListener('change', async e => {
  if (chat.draft) { setDraft({ mode: e.target.value }); return; }
  try { await api(`api/sessions/${encodeURIComponent(chat.id)}/mode`, { mode: e.target.value }); } catch (err) { notice(err.message); renderStatus(); }
});

// The change shows at once and is put back if Claude refuses it. It applies from Claude's next request, even mid-turn.
async function pick(kind, value) {
  const patch = kind === 'model' ? { model: value, shownModel: value } : { effort: value };
  if (chat.draft) { setDraft(patch); return; }
  const c = chat;
  const before = c.status;
  c.status = { ...before, ...patch };
  renderStatus();
  try {
    c.status = await api(`api/sessions/${encodeURIComponent(c.id)}/${kind}`, { [kind]: value });
  } catch (err) {
    c.status = before;
    notice(err.message);
  }
  if (chat === c) renderStatus();
}

$('model').addEventListener('change', e => pick('model', e.target.value));
$('effort').addEventListener('change', e => pick('effort', e.target.value));

function renderView() {
  for (const b of $('view').querySelectorAll('button')) b.setAttribute('aria-pressed', String((b.dataset.tools === 'verbose') === ui.verbose));
}

$('view').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  ui.verbose = b.dataset.tools === 'verbose';
  store.set('verbose', ui.verbose);
  renderView();
  if (chat) renderItems();
});

// ---- starting a session ----------------------------------------------------------------------------
// "+ New session" opens the chat pane empty, with a folder to pick above the prompt box. The first message starts it.

async function openNew() {
  chat?.es?.close();
  chat = newChat(null);
  chat.draft = { touched: new Set() };
  chat.status = { state: 'idle', pending: [], mode: 'manual', model: null, shownModel: null, effort: null, chrome: true };
  $('items').innerHTML = '';
  $('approvals').innerHTML = '';
  $('earlier').hidden = true;
  $('live').hidden = true;
  $('working').hidden = true;
  $('folder').value = HOME;
  notice('');
  show('session');
  renderList();
  renderStatus();
  textBox.focus({ preventScroll: true });
  loadDraftDefaults();
  try {
    const { folders } = await api('api/folders');
    $('folders').innerHTML = folders.map((f, i) => `<label class="folder"><input type="radio" name="folder" value="${esc(f)}"${i === 0 ? ' checked' : ''}> ${esc(f.replace(HOME, '~') || '~')}</label>`).join('');
  } catch (e) {
    notice(e.message);
  }
}

// A new session starts the way Desktop would start one in that folder: its mode for the folder, and its effort.
async function loadDraftDefaults() {
  const c = chat;
  try {
    const d = await api(`api/defaults?cwd=${encodeURIComponent($('folder').value.trim())}`);
    if (chat !== c) return;
    const t = c.draft.touched;
    c.status = { ...c.status, ...(!t.has('mode') && { mode: d.mode }), ...(!t.has('model') && { model: d.model, shownModel: d.shownModel }), ...(!t.has('effort') && { effort: d.effort }) };
  } catch {}
  if (chat === c) renderStatus();
}

$('folders').addEventListener('change', e => { if (e.target.name === 'folder') { $('folder').value = e.target.value; loadDraftDefaults(); } });
$('folder').addEventListener('change', loadDraftDefaults);

async function startSession(c, text) {
  const s = c.status;
  const t = c.draft.touched;
  c.starting = true;
  renderComposer();
  $('send').textContent = 'Starting';
  notice('');
  try {
    const { id } = await api('api/new', { cwd: $('folder').value.trim(), text, mode: s.mode, ...(t.has('model') && { model: s.shownModel }), ...(t.has('effort') && { effort: s.effort }), ...(t.has('chrome') && { chrome: !!s.chrome }) });
    textBox.value = '';
    fit(textBox);
    ui.first = { id, text };
    await loadIndex();
    location.hash = `#/s/${encodeURIComponent(id)}`;
  } catch (err) {
    notice(err.message);
  } finally {
    c.starting = false;
    renderComposer();
  }
}

// ---- routing ---------------------------------------------------------------------------------------

function show(view) {
  app.dataset.view = view === 'list' ? 'list' : 'chat';
  $('empty').hidden = view !== 'list';
  $('session').hidden = view !== 'session';
  $('folderBar').hidden = !chat?.draft;
  $('newHint').hidden = !chat?.draft;
  $('view').hidden = !!chat?.draft;
  textBox.placeholder = chat?.draft ? 'What should Claude do?' : 'Reply';
}

function route() {
  const h = location.hash;
  if (h.startsWith('#/s/')) return openSession(decodeURIComponent(h.slice(4)));
  if (h === '#/new') return openNew();
  chat?.es?.close();
  chat = null;
  document.title = 'Capcom';
  show('list');
  renderList();
}

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadIndex(); if (chat) fetchNew(); } });
setInterval(() => { if (!document.hidden) loadIndex(); }, 15_000);

renderView();
await loadIndex();
route();
