// The list of sessions on the left: routines, pinned sessions, Capcom's groups, and the ones started here or in a terminal.
// A row can be dragged onto a section to move it there.
import { dragRows } from './drag.js';
import { HOME, STATION } from './env.js';
import { folderName, STATE_LABEL, when } from './format.js';
import { useLocal } from './hooks.js';
import { Fragment, html, useEffect, useRef, useState } from './html.js';

function RowLink({ r, title = r.title, current, lifted }) {
  const meta = [folderName(r.cwd, HOME), r.branch, STATE_LABEL[r.state]].filter(Boolean).join('  ');
  return html`<a class="row" href=${`#/s/${encodeURIComponent(r.id)}`} data-id=${r.id} draggable=${false} data-lifted=${lifted || null} aria-current=${current === r.id ? 'page' : null}>
    <span class="lamp" data-state=${r.state} aria-hidden="true"></span>
    <span class="row-title">${title || 'Untitled session'}</span>
    <time class="row-time">${when(r.lastActivityAt)}</time>
    ${meta ? html`<span class="row-meta">${meta}</span>` : null}</a>`;
}

const Row = props => html`<li><${RowLink} ...${props} /></li>`;

function Section({ id, name, count, collapsed, toggle, drop, over, children }) {
  const open = !collapsed[id];
  return html`<section class="group" data-drop=${drop ? id : null} data-over=${over || null}><button class="group-head" type="button" data-key=${id} aria-expanded=${open} onClick=${() => toggle(id, open)}>${name} <span class="count">${count}</span></button>
    ${open ? html`<ul class="rows">${children}</ul>` : null}</section>`;
}

// The latest run of a routine, with the earlier ones folded away until asked for.
// A routine's row opens its latest run. The arrow at its end folds the earlier runs out underneath.
function Routine({ g, current, lifted, open, onToggle }) {
  const earlier = g.earlier.length;
  const runs = `${earlier} earlier run${earlier > 1 ? 's' : ''}`;
  return html`<li class=${earlier ? 'routine has-runs' : 'routine'}>
    <${RowLink} r=${g.latest} current=${current} lifted=${g.latest.id === lifted} />
    ${earlier ? html`<button class="runs-toggle" type="button" data-routine=${g.name} aria-expanded=${open} aria-label=${runs} title=${runs} onClick=${() => onToggle(g.name)}></button>` : null}
    ${earlier && open ? html`<ul class="earlier-runs">${g.earlier.map(r => html`<${Row} key=${r.id} r=${r} title=${when(r.lastActivityAt)} current=${current} lifted=${r.id === lifted} />`)}</ul>` : null}
  </li>`;
}

export const everyRow = ix => [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.routines.flatMap(g => [g.latest, ...g.earlier]), ...ix.started, ...ix.ungrouped, ...ix.other];

export const findRow = (ix, id) => (ix ? everyRow(ix).find(r => r.id === id) || null : null);

// Dropped on any of these, a session leaves its group and shows in the one that matches the app it came from.
const LOOSE_HOME = { capcom: 'started', desktop: 'ungrouped', cli: 'other' };
const LOOSE = Object.values(LOOSE_HOME);
const looseHome = row => (row.routine ? null : LOOSE_HOME[row.source]);

const byRecent = (a, b) => b.lastActivityAt - a.lastActivityAt;

// Where a dropped row shows until the server's list arrives and replaces this guess. It returns `ix` itself when the drop changes nothing.
export function placeRow(ix, id, section) {
  const row = findRow(ix, id);
  if (!row) return ix;
  const group = ix.groups.some(g => g.id === section) ? section : null;
  const inPlace = section === 'pinned' ? row.pinned : group ? row.group === group && !row.pinned : !row.group && !row.pinned;
  if (inPlace) return ix;
  const moved = { ...row, pinned: section === 'pinned', group };
  const lands = LOOSE.includes(section) ? looseHome(row) : section;
  const without = list => list.filter(r => r.id !== id);
  const into = (section, list) => (section === lands ? [...without(list), moved].sort(byRecent) : without(list));
  return {
    ...ix,
    pinned: into('pinned', ix.pinned),
    groups: ix.groups.map(g => ({ ...g, sessions: into(g.id, g.sessions) })),
    routines: ix.routines.flatMap(g => {
      if (g.latest.id !== id) return [{ ...g, earlier: without(g.earlier) }];
      const [latest, ...earlier] = g.earlier;
      return latest ? [{ ...g, latest, earlier }] : [];
    }),
    started: into('started', ix.started),
    ungrouped: into('ungrouped', ix.ungrouped),
    other: into('other', ix.other),
  };
}

// While a row is dragged, every section that can take it is shown, so an empty Pinned or group is still a place to drop it.
function Sections({ ix, current, collapsed, toggle, openRoutines, toggleRoutine, drag }) {
  const carried = drag && findRow(ix, drag.id);
  const over = drag?.over;
  const lands = over && carried && LOOSE.includes(over) ? looseHome(carried) ?? over : over;
  const lifted = drag?.id;
  const rows = list => list.map(r => html`<${Row} key=${r.id} r=${r} current=${current} lifted=${r.id === lifted} />`);
  const parts = [];
  const add = (id, name, list, body, drop = true) => {
    if (!list.length && !(drag && drop)) return;
    parts.push(html`<${Section} key=${id} id=${id} name=${name} count=${list.length} collapsed=${collapsed} toggle=${toggle} drop=${drop} over=${lands === id}>${list.length ? body : html`<li class="drop-hint">Drop here</li>`}<//>`);
  };
  add('routines', 'Routines', ix.routines, ix.routines.map(g => html`<${Fragment} key=${g.name}><${Routine} g=${g} current=${current} lifted=${lifted} open=${openRoutines.has(g.name)} onToggle=${toggleRoutine} /><//>`), false);
  add('pinned', 'Pinned', ix.pinned, rows(ix.pinned));
  for (const g of ix.groups) add(g.id, g.name, g.sessions, rows(g.sessions));
  add('started', 'Started here', ix.started, rows(ix.started));
  add('ungrouped', 'Ungrouped', ix.ungrouped, rows(ix.ungrouped));
  add('other', 'Terminal and other', ix.other, rows(ix.other));
  return parts.length ? parts : html`<p class="quiet pad">No sessions found.</p>`;
}

// `place(id, section)` moves a dropped row and resolves with the reason when the server refuses, or an empty string.
export function SessionList({ ix, error, current, place, onFind }) {
  const [collapsed, setCollapsed] = useLocal('collapsed', {});
  const [openRoutines, setOpenRoutines] = useState(new Set());
  const [drag, setDrag] = useState(null);
  const [note, setNote] = useState('');
  const box = useRef(null);
  const latestPlace = useRef(place);
  latestPlace.current = place;
  const toggle = (id, open) => setCollapsed(all => ({ ...all, [id]: open }));
  const toggleRoutine = name => setOpenRoutines(all => { const next = new Set(all); if (!next.delete(name)) next.add(name); return next; });

  useEffect(() => dragRows(box.current, {
    onStart: id => setDrag({ id, over: null }),
    onOver: over => setDrag(d => d && { ...d, over }),
    onEnd: async (id, section) => {
      setDrag(null);
      if (section) setNote(await latestPlace.current(id, section));
    },
  }), []);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(''), 6000);
    return () => clearTimeout(timer);
  }, [note]);

  return html`<nav class="list" aria-label="Sessions">
    <header class="list-head">
      <div class="brand"><span class="station">${STATION}</span><h1>Capcom</h1></div>
      <button class="icon-btn find" type="button" aria-label="Find a session" title="Find a session (Ctrl+K)" onClick=${onFind}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12.6 12.6 17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
    </header>
    <p class="problem" id="problem" hidden=${!ix?.problem}>${ix?.problem ? `${ix.problem}.` : ''}</p>
    <div role="status">${note ? html`<p class="problem" id="moveNote">${note}</p>` : null}</div>
    <div class="sections" id="sections" ref=${box}>
      ${ix
        ? html`<${Sections} ix=${ix} current=${current} collapsed=${collapsed} toggle=${toggle} openRoutines=${openRoutines} toggleRoutine=${toggleRoutine} drag=${drag} />`
        : html`<p class="quiet pad">${error ? `Could not load sessions: ${error}` : 'Loading sessions'}</p>`}
    </div>
    <footer class="list-foot">
      <form method="post" action="logout"><button class="link" type="submit">Sign out</button></form>
    </footer>
  </nav>`;
}
