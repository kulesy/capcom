// The list of sessions on the left: routines, pinned sessions, Capcom's projects and groups, and the ones started here or in a
// terminal. A row can be dragged onto a section to move it there. Everything else is done from menus, so a phone can do it all.
import { dragRows } from './drag.js';
import { HOME, STATION } from './env.js';
import { DeleteProject, NameForm } from './forms.js';
import { folderName, STATE_LABEL, when } from './format.js';
import { useLocal } from './hooks.js';
import { Fragment, html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { Menu } from './menu.js';
import { byRecent, byTitle, UNTITLED } from './order.js';
import { moveTargets, nextStop, withoutRow } from './tree.js';

function RowLink({ r, title = r.title, current, lifted }) {
  const meta = [folderName(r.cwd, HOME), r.branch, STATE_LABEL[r.state]].filter(Boolean).join('  ');
  return html`<a class="row" href=${`#/s/${encodeURIComponent(r.id)}`} data-id=${r.id} draggable=${false} data-lifted=${lifted || null} aria-current=${current === r.id ? 'page' : null}>
    <span class="lamp" data-state=${r.state} aria-hidden="true"></span>
    <span class="row-title">${title || UNTITLED}</span>
    <time class="row-time">${when(r.lastActivityAt)}</time>
    ${meta ? html`<span class="row-meta">${meta}</span>` : null}</a>`;
}

const Row = props => html`<li><${RowLink} ...${props} /></li>`;

const dots = () => html`<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>`;

// The header of a project or a group. `menu` is { label, items } for the button at its end, or null for a header with no actions.
// The same menu opens on a right click or the menu key.
function Head({ id, name, count, open, toggle, menu, tree, project }) {
  const pop = button => tree.pop(id, menu, button);
  return html`<div class=${menu ? 'bar has-menu' : 'bar'} onContextMenu=${menu && (e => { e.preventDefault(); pop(e.currentTarget.querySelector('.more')); })}>
    <button class=${project ? 'group-head project-head' : 'group-head'} type="button" data-key=${id} aria-expanded=${open} onClick=${() => toggle(id, open)}><span class="name">${name}</span> <span class="count">${count}</span></button>
    ${menu ? html`<button class="icon-btn more" type="button" aria-label=${menu.label} title=${menu.label} aria-haspopup="menu" aria-expanded=${tree.shown?.key === id} onClick=${e => pop(e.currentTarget)}>${dots()}</button>` : null}
  </div>`;
}

function Section({ id, name, count, collapsed, toggle, drop, over, menu, tree, children }) {
  const open = !collapsed[id];
  return html`<section class="group" data-drop=${drop ? id : null} data-over=${over || null}>
    <${Head} id=${id} name=${name} count=${count} open=${open} toggle=${toggle} menu=${menu} tree=${tree} />
    ${open && children ? html`<ul class="rows">${children}</ul>` : null}</section>`;
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

// Where a dropped row shows until the server's list arrives and replaces this guess. It returns `ix` itself when the drop changes nothing.
export function placeRow(ix, id, section) {
  const row = findRow(ix, id);
  if (!row) return ix;
  const group = ix.groups.some(g => g.id === section) ? section : null;
  const inPlace = section === 'pinned' ? row.pinned : group ? row.group === group && !row.pinned : !row.group && !row.pinned;
  if (inPlace) return ix;
  const moved = { ...row, pinned: section === 'pinned', group };
  const lands = LOOSE.includes(section) ? looseHome(row) : section;
  const rest = withoutRow(ix, id);
  const into = (section, list) => (section === lands ? [...list, moved].sort(group ? byTitle : byRecent) : list);
  return {
    ...rest,
    pinned: into('pinned', rest.pinned),
    groups: rest.groups.map(g => ({ ...g, sessions: into(g.id, g.sessions) })),
    started: into('started', rest.started),
    ungrouped: into('ungrouped', rest.ungrouped),
    other: into('other', rest.other),
  };
}

// While a row is dragged, every section that can take it is shown, so an empty Pinned or group is still a place to drop it.
// A group always shows, empty or not, and so does a project, so one that was just made can be found and filled.
function Sections({ ix, current, collapsed, toggle, openRoutines, toggleRoutine, drag, tree }) {
  const carried = drag && findRow(ix, drag.id);
  const over = drag?.over;
  const lands = over && carried && LOOSE.includes(over) ? looseHome(carried) ?? over : over;
  const lifted = drag?.id;
  const rows = list => list.map(r => html`<${Row} key=${r.id} r=${r} current=${current} lifted=${r.id === lifted} />`);
  const section = (id, name, list, body, { drop = true, always = false, menu = null } = {}) => {
    if (!list.length && !always && !(drag && drop)) return null;
    return html`<${Section} key=${id} id=${id} name=${name} count=${list.length} collapsed=${collapsed} toggle=${toggle} drop=${drop} over=${lands === id} menu=${menu} tree=${tree}>${list.length ? body : drag ? html`<li class="drop-hint">Drop here</li>` : null}<//>`;
  };
  const group = g => section(g.id, g.name, g.sessions, rows(g.sessions), { always: true, menu: tree.groupMenu(g) });
  const project = p => {
    const groups = ix.groups.filter(g => g.project === p.id);
    const open = !collapsed[p.id] || !!drag;
    const adding = tree.form?.kind === 'group' && tree.form.project === p.id;
    const editing = tree.form?.project === p.id ? tree.form.kind : null;
    return html`<section class="project" key=${p.id}>
      ${editing === 'rename' ? tree.renameForm(p)
        : editing === 'delete' ? tree.deleteForm(p, groups.length)
        : html`<${Head} project=${true} id=${p.id} name=${p.name} count=${groups.reduce((n, g) => n + g.sessions.length, 0)} open=${open} toggle=${toggle} menu=${tree.projectMenu(p)} tree=${tree} />`}
      ${open ? html`<div class="project-groups">${groups.map(group)}${adding ? tree.groupForm(p) : null}${groups.length || adding ? null : html`<p class="drop-hint">No groups yet. Add one from the project's menu, or move one here from a group's menu.</p>`}</div>` : null}
    </section>`;
  };
  const parts = [
    section('routines', 'Routines', ix.routines, ix.routines.map(g => html`<${Fragment} key=${g.name}><${Routine} g=${g} current=${current} lifted=${lifted} open=${openRoutines.has(g.name)} onToggle=${toggleRoutine} /><//>`), { drop: false }),
    section('pinned', 'Pinned', ix.pinned, rows(ix.pinned)),
    ...ix.projects.map(project),
    ...ix.groups.filter(g => !g.project).map(group),
    section('started', 'Started here', ix.started, rows(ix.started)),
    section('ungrouped', 'Ungrouped', ix.ungrouped, rows(ix.ungrouped)),
    section('other', 'Terminal and other', ix.other, rows(ix.other)),
  ].filter(Boolean);
  return parts.length ? parts : html`<p class="quiet pad">No sessions found.</p>`;
}

// The arrows walk the list like a tree: up and down through headers and rows, left and right to fold a project, a section or a
// routine's runs. Enter opens the focused row, as a link does. With nothing focused, up or down starts at the open session.
const STOPS = '.group-head, a.row[data-id]';

// A header's menu button and a routine's fold button belong to the header or row beside them, so the arrows carry on from there.
function stopBeside(el) {
  if (el?.matches?.('.more')) return el.closest('.bar')?.querySelector('.group-head');
  if (el?.matches?.('.runs-toggle')) return el.closest('.routine')?.querySelector('a.row');
  return el;
}

function walk(e, box) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !box || e.target.closest?.('input, textarea, form, .confirm')) return;
  const stops = [...box.querySelectorAll(STOPS)];
  const at = stops.indexOf(stopBeside(document.activeElement));
  const go = el => { e.preventDefault(); el.focus(); el.scrollIntoView({ block: 'nearest' }); };
  const to = nextStop(stops.length, at, e.key, Math.max(stops.indexOf(box.querySelector('a.row[aria-current="page"]')), 0));
  if (to >= 0) return go(stops[to]);
  const here = stops[at];
  if (!here || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
  const opening = e.key === 'ArrowRight';
  const fold = here.matches('.group-head') ? here : here.closest('.routine')?.querySelector('.runs-toggle');
  if (fold && (fold.getAttribute('aria-expanded') === 'true') !== opening) { e.preventDefault(); fold.click(); }
  else if (!opening) {
    const section = here.closest('.group, .project');
    const parent = (here.matches('.group-head') ? section?.parentElement?.closest('.project') : section)?.querySelector('.group-head');
    if (parent) go(parent);
  }
}

// `place(id, section)` moves a dropped row and resolves with the reason when the server refuses, or an empty string.
// `edit(path, body)` sends a change to projects or groups and resolves with { problem, made }, where `made` is the project or
// group the server made, changed or removed.
export function SessionList({ ix, error, current, place, edit, onFind, passkeys, banner }) {
  const [collapsed, setCollapsed] = useLocal('collapsed', {});
  const [openRoutines, setOpenRoutines] = useState(new Set());
  const [drag, setDrag] = useState(null);
  const [note, setNote] = useState('');
  const [form, setForm] = useState(null);
  const [shown, setShown] = useState(null);
  const [back, setBack] = useState(null);
  const nav = useRef(null);
  const box = useRef(null);
  const latestPlace = useRef(place);
  latestPlace.current = place;
  const toggle = (id, open) => setCollapsed(all => ({ ...all, [id]: open }));
  const expand = id => setCollapsed(all => ({ ...all, [id]: false }));
  const toggleRoutine = name => setOpenRoutines(all => { const next = new Set(all); if (!next.delete(name)) next.add(name); return next; });

  useEffect(() => dragRows(box.current, {
    onStart: id => setDrag({ id, over: null }),
    onOver: over => setDrag(d => d && { ...d, over }),
    onEnd: async (id, section) => {
      setDrag(null);
      if (section) setNote(await latestPlace.current(id, section));
    },
  }), []);

  // With no chat open and nothing focused, up or down steps into the list. With a chat open they are left to scroll it.
  useEffect(() => {
    const onKey = e => {
      const el = document.activeElement;
      if (box.current?.contains(el)) return walk(e, box.current);
      const idle = (!el || el === document.body) && !document.getElementById('session');
      if (idle && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) walk(e, box.current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(''), 6000);
    return () => clearTimeout(timer);
  }, [note]);

  // Focus goes to the project or group a closed form made, or back to what it replaced or came from, as soon as the list has been
  // drawn without the form. The first selector that matches wins, so when the list could not be loaded again focus goes to the next
  // one rather than to the page. It scrolls into view, so `focus()` must never be given preventScroll.
  useLayoutEffect(() => {
    if (back === null) return;
    back.map(to => nav.current.querySelector(to)).find(Boolean)?.focus();
    setBack(null);
  }, [back]);

  // Sends one change to the layout. It resolves with what the server made, changed or removed, or with null when it refused,
  // and then shows the reason at the top of the list.
  async function change(path, body) {
    const { problem, made } = await edit(path, body);
    setNote(problem);
    return problem ? null : made;
  }

  const closeForm = (...focus) => { setForm(null); setBack(focus); };
  const headOf = id => `.group-head[data-key="${CSS.escape(id)}"]`;
  const pop = (key, { label, items }, anchor) => setShown(open => (open?.key === key ? null : { key, anchor, label, items }));

  const addMenu = {
    label: 'Add a project or group',
    items: [
      { label: 'New project', run: () => setForm({ kind: 'project' }) },
      { label: 'New group', run: () => setForm({ kind: 'group', project: null }) },
    ],
  };

  async function moveGroup(g, project) {
    if (await change('api/layout/group/move', { id: g.id, project }) && project) expand(project);
    setBack([headOf(g.id)]);
  }

  async function addGroup(name, project) {
    const made = await change('api/layout/group/add', { name, project });
    if (made) { closeForm(headOf(made.id), project ? headOf(project) : '.add'); if (project) expand(project); }
    return !!made;
  }

  const tree = {
    form,
    shown,
    pop,
    groupMenu: g => {
      const to = moveTargets(ix.projects, g);
      return to.length ? { label: `Move ${g.name}`, items: to.map(t => ({ label: t.label, run: () => moveGroup(g, t.project) })) } : null;
    },
    projectMenu: p => ({
      label: `Actions for ${p.name}`,
      items: [
        { label: 'New group here', run: () => { expand(p.id); setForm({ kind: 'group', project: p.id }); } },
        { label: 'Rename', run: () => setForm({ kind: 'rename', project: p.id }) },
        { label: 'Delete project', danger: true, run: () => setForm({ kind: 'delete', project: p.id }) },
      ],
    }),
    groupForm: p => html`<${NameForm} label=${`New group in ${p.name}`} action="Create" onSubmit=${name => addGroup(name, p.id)} onCancel=${() => closeForm(headOf(p.id))} />`,
    renameForm: p => html`<${NameForm} label="Rename project" value=${p.name} action="Save" onCancel=${() => closeForm(headOf(p.id))}
      onSubmit=${async name => {
        const done = await change('api/layout/project/rename', { id: p.id, name });
        if (done) closeForm(headOf(p.id));
        return !!done;
      }} />`,
    deleteForm: (p, groups) => html`<${DeleteProject} name=${p.name} groups=${groups} onCancel=${() => closeForm(headOf(p.id))}
      onConfirm=${async () => {
        const done = await change('api/layout/project/remove', { id: p.id });
        if (done) closeForm('.add');
        return !!done;
      }} />`,
  };

  const top = form && !form.project ? form : null;
  const topForm = !top ? null : top.kind === 'project'
    ? html`<${NameForm} label="New project" action="Create" onCancel=${() => closeForm('.add')}
        onSubmit=${async name => {
          const made = await change('api/layout/project/add', { name });
          if (made) closeForm(headOf(made.id), '.add');
          return !!made;
        }} />`
    : html`<${NameForm} label="New group" action="Create" onCancel=${() => closeForm('.add')} onSubmit=${name => addGroup(name, null)} />`;

  return html`<nav class="list" aria-label="Sessions" ref=${nav}>
    <header class="list-head">
      <div class="brand"><span class="station">${STATION}</span><h1>Capcom</h1></div>
      <div class="list-actions">
        <button class="icon-btn add" type="button" aria-label=${addMenu.label} title=${addMenu.label} aria-haspopup="menu" aria-expanded=${shown?.key === 'add'} disabled=${!ix} onClick=${e => pop('add', addMenu, e.currentTarget)}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        <button class="icon-btn find" type="button" aria-label="Find a session" title="Find a session (Ctrl+K)" onClick=${onFind}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12.6 12.6 17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
    </header>
    <p class="problem" id="problem" hidden=${!ix?.problem}>${ix?.problem ? `${ix.problem}.` : ''}</p>
    <div role="status">${note ? html`<p class="problem" id="moveNote">${note}</p>` : null}</div>
    ${banner}
    ${topForm}
    <div class="sections" id="sections" ref=${box}>
      ${ix
        ? html`<${Sections} ix=${ix} current=${current} collapsed=${collapsed} toggle=${toggle} openRoutines=${openRoutines} toggleRoutine=${toggleRoutine} drag=${drag} tree=${tree} />`
        : html`<p class="quiet pad">${error ? `Could not load sessions: ${error}` : 'Loading sessions'}</p>`}
    </div>
    <footer class="list-foot">
      <a href="#/passkeys" aria-current=${passkeys ? 'page' : null}>Passkeys</a>
      <form method="post" action="logout"><button class="link" type="submit">Sign out</button></form>
    </footer>
    ${shown ? html`<${Menu} key=${shown.key} anchor=${shown.anchor} label=${shown.label} items=${shown.items} onClose=${() => setShown(null)} />` : null}
  </nav>`;
}
