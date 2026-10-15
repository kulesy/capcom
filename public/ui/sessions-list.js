// The list of sessions on the left: Desktop's groups, routines, and the ones started here or in a terminal.
import { HOME, STATION } from './env.js';
import { folderName, STATE_LABEL, when } from './format.js';
import { useLocal } from './hooks.js';
import { Fragment, html, useState } from './html.js';

function Row({ r, title = r.title, current }) {
  const meta = [folderName(r.cwd, HOME), r.branch, STATE_LABEL[r.state]].filter(Boolean).join('  ');
  return html`<li><a class="row" href=${`#/s/${encodeURIComponent(r.id)}`} aria-current=${current === r.id ? 'page' : null}>
    <span class="lamp" data-state=${r.state} aria-hidden="true"></span>
    <span class="row-title">${title || 'Untitled session'}</span>
    <time class="row-time">${when(r.lastActivityAt)}</time>
    ${meta ? html`<span class="row-meta">${meta}</span>` : null}</a></li>`;
}

function Section({ id, name, count, collapsed, toggle, children }) {
  const open = !collapsed[id];
  return html`<section class="group"><button class="group-head" type="button" data-key=${id} aria-expanded=${open} onClick=${() => toggle(id, open)}>${name} <span class="count">${count}</span></button>
    ${open ? html`<ul class="rows">${children}</ul>` : null}</section>`;
}

// The latest run of a routine, with the earlier ones folded away until asked for.
function Routine({ g, current, open, onOpen }) {
  const earlier = g.earlier.length;
  return html`<${Row} r=${g.latest} current=${current} />
    ${earlier ? open
      ? html`<li><ul class="earlier-runs">${g.earlier.map(r => html`<${Row} key=${r.id} r=${r} title=${when(r.lastActivityAt)} current=${current} />`)}</ul></li>`
      : html`<li class="more"><button class="link" type="button" data-routine=${g.name} onClick=${() => onOpen(g.name)}>${earlier} earlier run${earlier > 1 ? 's' : ''}</button></li>` : null}`;
}

const everyRow = ix => [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.routines.flatMap(g => [g.latest, ...g.earlier]), ...ix.started, ...ix.ungrouped, ...ix.other];

export const findRow = (ix, id) => (ix ? everyRow(ix).find(r => r.id === id) || null : null);

function matches(r, query) {
  return `${r.title} ${r.cwd} ${r.branch} ${r.routine || ''}`.toLowerCase().includes(query.toLowerCase());
}

function Sections({ ix, query, current, collapsed, toggle, openRoutines, openRoutine }) {
  if (query) {
    const seen = new Set();
    const hits = everyRow(ix).filter(r => !seen.has(r.id) && seen.add(r.id) && matches(r, query));
    return hits.length
      ? html`<section class="group"><ul class="rows">${hits.slice(0, 80).map(r => html`<${Row} key=${r.id} r=${r} current=${current} />`)}</ul></section>`
      : html`<p class="quiet pad">No sessions match.</p>`;
  }
  const rows = list => list.map(r => html`<${Row} key=${r.id} r=${r} current=${current} />`);
  const parts = [];
  const add = (id, name, list, body) => { if (list.length) parts.push(html`<${Section} key=${id} id=${id} name=${name} count=${list.length} collapsed=${collapsed} toggle=${toggle}>${body}<//>`); };
  add('pinned', 'Pinned', ix.pinned, rows(ix.pinned));
  for (const g of ix.groups) add(g.id, g.name, g.sessions, rows(g.sessions));
  add('routines', 'Routines', ix.routines, ix.routines.map(g => html`<${Fragment} key=${g.name}><${Routine} g=${g} current=${current} open=${openRoutines.has(g.name)} onOpen=${openRoutine} /><//>`));
  add('started', 'Started here', ix.started, rows(ix.started));
  add('ungrouped', 'Ungrouped', ix.ungrouped, rows(ix.ungrouped));
  add('other', 'Terminal and other', ix.other, rows(ix.other));
  return parts.length ? parts : html`<p class="quiet pad">No sessions found.</p>`;
}

export function SessionList({ ix, error, current, archived, setArchived }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useLocal('collapsed', {});
  const [openRoutines, setOpenRoutines] = useState(new Set());
  const toggle = (id, open) => setCollapsed(all => ({ ...all, [id]: open }));
  const openRoutine = name => setOpenRoutines(all => new Set([...all, name]));
  return html`<nav class="list" aria-label="Sessions">
    <header class="list-head">
      <div class="brand"><span class="station">${STATION}</span><h1>Capcom</h1></div>
      <a class="button new" href="#/new">+ New session</a>
    </header>
    <div class="search"><input id="q" type="search" placeholder="Search sessions" autocomplete="off" aria-label="Search sessions" value=${query} onInput=${e => setQuery(e.target.value)} /></div>
    <p class="problem" id="problem" hidden=${!ix?.problem}>${ix?.problem ? `${ix.problem}. Sessions are listed without Desktop's groups.` : ''}</p>
    <div class="sections" id="sections">
      ${ix
        ? html`<${Sections} ix=${ix} query=${query.trim()} current=${current} collapsed=${collapsed} toggle=${toggle} openRoutines=${openRoutines} openRoutine=${openRoutine} />`
        : html`<p class="quiet pad">${error ? `Could not load sessions: ${error}` : 'Loading sessions'}</p>`}
    </div>
    <footer class="list-foot">
      <label><input id="archived" type="checkbox" checked=${archived} onChange=${e => setArchived(e.target.checked)} /> Show archived</label>
      <form method="post" action="logout"><button class="link" type="submit">Sign out</button></form>
    </footer>
  </nav>`;
}
