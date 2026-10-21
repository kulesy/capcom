// The list of sessions on the left, for the view the projects sidebar picks. Home has the routines, the groups outside projects and the
// sessions started here or in a terminal, and a project has its groups. Pinned sessions show in every view. A row can be dragged
// onto a section to move it there. Everything else is done from menus, so a phone can do it all.
import { ask } from './ask.js';
import { dragRows } from './drag.js';
import { HOME, STATION } from './env.js';
import { DeleteProject, NameForm } from './forms.js';
import { folderName, STATE_LABEL, when } from './format.js';
import { useLocal, useModifier } from './hooks.js';
import { Fragment, html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { Menu } from './menu.js';
import { byRecent, byTitle, UNTITLED } from './order.js';
import { ProjectsPanel, ProjectsToggle } from './projects.js';
import { groupsIn, HOME_VIEW } from './scopes.js';
import { archiveHint, shortcut } from './shortcuts.js';
import { archiveTarget, LOOSE_HOME, LOOSE_NAMES, looseHome, moveTargets, neighbour, nextStop, sessionTargets, TITLE_MAX, withoutRow } from './tree.js';

function RowLink({ r, title = r.title, current, lifted, marked }) {
  const meta = [folderName(r.cwd, HOME), r.branch, STATE_LABEL[r.state]].filter(Boolean).join('  ');
  return html`<a class="row" href=${`#/s/${encodeURIComponent(r.id)}`} data-id=${r.id} draggable=${false} data-lifted=${lifted || null} data-menu=${marked || null} aria-current=${current === r.id ? 'page' : null}>
    <span class="lamp" data-state=${r.state} aria-hidden="true"></span>
    <span class="row-title">${title || UNTITLED}</span>
    <time class="row-time">${when(r.lastActivityAt)}</time>
    ${meta ? html`<span class="row-meta">${meta}</span>` : null}</a>`;
}

// A row being renamed shows its form where the link was.
const Row = ({ tree, ...props }) => html`<li>${tree.renaming === props.r.id ? tree.sessionForm(props.r) : html`<${RowLink} ...${props} />`}</li>`;

const rowOf = id => `a.row[data-id="${CSS.escape(id)}"]`;

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
function Routine({ g, current, lifted, marked, open, onToggle, tree }) {
  const earlier = g.earlier.length;
  const runs = `${earlier} earlier run${earlier > 1 ? 's' : ''}`;
  const renaming = tree.renaming === g.latest.id;
  return html`<li class=${earlier ? 'routine has-runs' : 'routine'}>
    ${renaming ? tree.sessionForm(g.latest) : html`<${RowLink} r=${g.latest} current=${current} lifted=${g.latest.id === lifted} marked=${g.latest.id === marked} />`}
    ${earlier && !renaming ? html`<button class="runs-toggle" type="button" data-routine=${g.name} aria-expanded=${open} aria-label=${runs} title=${runs} onClick=${() => onToggle(g.name)}></button>` : null}
    ${earlier && open ? html`<ul class="earlier-runs">${g.earlier.map(r => html`<${Row} key=${r.id} r=${r} title=${r.renamed ? r.title : when(r.lastActivityAt)} current=${current} lifted=${r.id === lifted} marked=${r.id === marked} tree=${tree} />`)}</ul>` : null}
  </li>`;
}

export const everyRow = ix => [...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.routines.flatMap(g => [g.latest, ...g.earlier]), ...ix.started, ...ix.ungrouped, ...ix.other];

export const findRow = (ix, id) => (ix ? everyRow(ix).find(r => r.id === id) || null : null);

const LOOSE = Object.values(LOOSE_HOME);

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
// A group always shows, empty or not, and so does the project in view, so one that was just made can be found and filled.
function Sections({ ix, view, current, collapsed, toggle, openRoutines, toggleRoutine, drag, tree }) {
  const carried = drag && findRow(ix, drag.id);
  const over = drag?.over;
  const lands = over && carried && LOOSE.includes(over) ? looseHome(carried) ?? over : over;
  const lifted = drag?.id;
  const marked = tree.shown?.session;
  const rows = list => list.map(r => html`<${Row} key=${r.id} r=${r} current=${current} lifted=${r.id === lifted} marked=${r.id === marked} tree=${tree} />`);
  const section = (id, name, list, body, { drop = true, always = false, menu = null } = {}) => {
    if (!list.length && !always && !(drag && drop)) return null;
    return html`<${Section} key=${id} id=${id} name=${name} count=${list.length} collapsed=${collapsed} toggle=${toggle} drop=${drop} over=${lands === id} menu=${menu} tree=${tree}>${list.length ? body : drag ? html`<li class="drop-hint">Drop here</li>` : null}<//>`;
  };
  const home = view === HOME_VIEW;
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
      ${open ? html`<div class="project-groups">${groups.map(group)}${adding ? tree.groupForm(p) : null}${groups.length || adding ? null : html`<p class="drop-hint">No groups yet. Make one with New group, or move one here from a group's menu in Home.</p>`}</div>` : null}
    </section>`;
  };
  const parts = [
    home && section('routines', 'Routines', ix.routines, ix.routines.map(g => html`<${Fragment} key=${g.name}><${Routine} g=${g} current=${current} lifted=${lifted} marked=${marked} open=${openRoutines.has(g.name)} onToggle=${toggleRoutine} tree=${tree} /><//>`), { drop: false }),
    section('pinned', 'Pinned', ix.pinned, rows(ix.pinned)),
    ...ix.projects.filter(p => p.id === view).map(project),
    ...(home ? groupsIn(ix, HOME_VIEW).map(group) : []),
    home && section('started', LOOSE_NAMES.started, ix.started, rows(ix.started)),
    home && section('ungrouped', LOOSE_NAMES.ungrouped, ix.ungrouped, rows(ix.ungrouped)),
    home && section('other', LOOSE_NAMES.other, ix.other, rows(ix.other)),
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

// Opens a new session. When one is open already the cursor goes to its message box, because setting the same hash does nothing.
export const newSession = () => { if (location.hash === '#/new') document.getElementById('text')?.focus(); else location.hash = '#/new'; };

// A note about something that did not work, which shows in amber. No reason means no note.
const problemNote = text => (text ? { text, problem: true } : null);

const isRunning = r => r.state === 'working' || r.state === 'waiting';
const STOP_DETAIL = "Archiving stops Claude's turn and denies any approval it is waiting for. Undo brings the session back, but not the turn.";

// `projects` is the projects sidebar's state, which the app owns because the search changes it as well.
// `place(id, section)` moves a dropped row and resolves with the reason when the server refuses, or an empty string.
// `edit(path, body)` sends a change to projects or groups and resolves with { problem, made }, where `made` is the project or
// group the server made, changed or removed. `archive(id, archived, { stop })` archives or unarchives a session and resolves with
// { problem, stopped, running }: the reason when the server refuses, whether it stopped a chat that was running, and whether it
// refused because one was running and `stop` was false.
export function SessionList({ ix, projects, error, current, place, edit, archive, onFind, passkeys, banner }) {
  const [collapsed, setCollapsed] = useLocal('collapsed', {});
  const { view } = projects;
  const mod = useModifier();
  const [openRoutines, setOpenRoutines] = useState(new Set());
  const [drag, setDrag] = useState(null);
  const [note, setNote] = useState(null);
  const [form, setForm] = useState(null);
  const [shown, setShown] = useState(null);
  const [back, setBack] = useState(null);
  const [after, setAfter] = useState(null);
  const nav = useRef(null);
  const box = useRef(null);
  const opened = useRef(0);
  const latestPlace = useRef(place);
  latestPlace.current = place;
  const latestMenu = useRef(null);
  const latestKey = useRef(null);
  const toggle = (id, open) => setCollapsed(all => ({ ...all, [id]: open }));
  const expand = id => setCollapsed(all => ({ ...all, [id]: false }));
  const toggleRoutine = name => setOpenRoutines(all => { const next = new Set(all); if (!next.delete(name)) next.add(name); return next; });

  useEffect(() => dragRows(box.current, {
    onStart: id => setDrag({ id, over: null }),
    onOver: over => setDrag(d => d && { ...d, over }),
    onEnd: async (id, section) => {
      setDrag(null);
      if (section) setNote(problemNote(await latestPlace.current(id, section)));
    },
    onMenu: (id, row, point) => latestMenu.current(id, row, point),
  }), []);

  // With no chat open and nothing focused, up or down steps into the list. With a chat open they are left to scroll it.
  useEffect(() => {
    const onKey = e => {
      if (shortcut(e) === 'archive') return latestKey.current(e);
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
    const timer = setTimeout(() => setNote(null), note.undo ? 10_000 : 6000);
    return () => clearTimeout(timer);
  }, [note]);

  // Each view starts at the top of the list. A form left open in the view before closes, so a group is never made in a view that is
  // off screen and a form does not come back with its view. New project is in the sidebar, so it stays. This comes before the effects
  // that move the focus, so a header they focus scrolls into sight after the jump to the top.
  useLayoutEffect(() => {
    box.current.scrollTop = 0;
    setForm(open => (open && open.kind !== 'project' ? null : open));
  }, [view]);

  // Focus goes to the project or group a closed form made, or back to what it replaced or came from, as soon as the list has been
  // drawn without the form. The first selector that matches wins, so when the list could not be loaded again focus goes to the next
  // one rather than to the page. It scrolls into view, so `focus()` must never be given preventScroll.
  useLayoutEffect(() => {
    if (back === null) return;
    back.map(to => nav.current.querySelector(to) || projects.box.current?.querySelector(to)).find(Boolean)?.focus();
    setBack(null);
  }, [back]);

  // A view picked in the search gets the focus on its header, or on the opener when it has none, once the list shows it. A focus
  // still waiting for a row gives way to it.
  useLayoutEffect(() => {
    if (!projects.landing) return;
    const { view: landed } = projects.landing;
    const head = landed ? nav.current.querySelector(headOf(landed)) : box.current.querySelector('.group-head');
    (head || projects.opener.current)?.focus();
    setAfter(null);
    projects.settle();
  }, [projects.landing]);

  // Once a row has left the list, the focus goes to the row beside it or to a header, so the keyboard stays in the list. Below 56rem an
  // open chat hides the list, so it waits until the list shows, and a focus that something else hides the list from is dropped. A key
  // asks for the ring, because after a click the browser gives none. A ring meant for the first header goes to the Projects button when
  // no header is left. Below 56rem a view picked in the search closes the chat in the same render, and the view's header keeps the focus.
  useLayoutEffect(() => {
    if (!after || projects.landing) return;
    const el = box.current.querySelector(after.to) ?? (after.to === '.group-head' ? projects.opener.current : null);
    if (el && !el.getClientRects().length) {
      if (!current) setAfter(null);
      return;
    }
    // Closing a question hands the focus back to this row, and focus() ignores a row that has it, so the ring needs a blur first.
    if (after.ring && el === document.activeElement) el.blur();
    el?.focus({ preventScroll: true, focusVisible: after.ring || undefined });
    el?.scrollIntoView({ block: 'nearest' });
    setAfter(null);
  }, [after, current]);

  // A rename form lasts only as long as its row is drawn. A reload can take the row away (archived elsewhere, folded among a
  // routine's earlier runs, past the newest 60), and the form is then dropped rather than coming back unasked later.
  useLayoutEffect(() => {
    if (form?.kind === 'session' && !box.current?.querySelector('.name-form')) setForm(null);
  });

  // The note that says why a change was refused pushes the list down, and can push the open form or the focused row out of view, so
  // it is brought back.
  useLayoutEffect(() => {
    if (!note?.problem) return;
    const focused = box.current?.contains(document.activeElement) ? document.activeElement : null;
    (nav.current.querySelector('.name-form') ?? focused)?.scrollIntoView({ block: 'nearest' });
  }, [note]);

  // Sends one change to the layout. It resolves with what the server made, changed or removed, or with null when it refused,
  // and then shows the reason at the top of the list.
  async function change(path, body) {
    const { problem, made } = await edit(path, body);
    setNote(problemNote(problem));
    return problem ? null : made;
  }

  // Starts a change that takes the row out of its place and resolves with what `start` resolves with. The focus moves on to the row
  // beside it at once, with its ring if `ring`, and back to the row if the change is refused. With no row left beside it, a ring goes
  // to the first header, or to the Projects button when no header is left, so the keyboard stays in the list and a press too many
  // archives nothing.
  async function leaving(id, start, ring = false) {
    const ids = [...box.current.querySelectorAll('a.row[data-id]')].map(a => a.dataset.id);
    // A routine's next run takes the place of its latest, so the focus goes to that run and not past the routine.
    const next = ix.routines.find(g => g.latest.id === id)?.earlier[0]?.id;
    const done = start();
    const to = next ?? neighbour(ids, id);
    setAfter(to ? { to: rowOf(to), ring } : ring ? { to: '.group-head', ring } : null);
    const result = await done;
    if (result.problem) setAfter({ to: rowOf(id), ring });
    return result;
  }

  // Archives a session and says so with a way to undo it, or says why it could not. A session on screen is left for the list, and
  // Undo reopens it. `ask` asks first about a chat that turns out to be running.
  async function archiveRow(id, title, { ask: askFirst = false, ring = false } = {}) {
    const { problem, stopped, running } = await leaving(id, () => archive(id, true, { stop: !askFirst }), ring);
    if (running) {
      // A focus still waiting for a hidden list would move later. Cancel finds the row, a new element, by its id.
      setAfter(null);
      return confirmStop(id, title, { back: () => box.current.querySelector(rowOf(id)), ring });
    }
    const onScreen = location.hash === `#/s/${encodeURIComponent(id)}`;
    // A refusal shows in the list's note, so a list hidden behind the chat is brought back to show it.
    if (onScreen && (!problem || !box.current.getClientRects().length)) location.hash = '#/';
    setNote(problem ? problemNote(problem) : { text: `${stopped ? 'Stopped and archived' : 'Archived'} ${title}.`, undo: { id, title, reopen: onScreen } });
  }

  const confirmStop = (id, title, { back, ring } = {}) => ask({ action: 'Stop and archive', title, detail: STOP_DETAIL, back, run: () => archiveRow(id, title, { ring }) });

  // Moves a session the way a drop does, and says where it went or why it did not. `where` names the place in the note.
  async function moveRow(id, title, section, where) {
    const { problem } = await leaving(id, async () => ({ problem: await latestPlace.current(id, section) }));
    setNote(problem ? problemNote(problem) : { text: section === 'pinned' ? `Pinned ${title}.` : `Moved ${title} to ${where}.` });
  }

  // Gives a session a title of its own. One no different from the one it has closes the form without asking the server. The form
  // keeps what was sent, so a reload that draws the row somewhere else draws the form there with it, ready to try again.
  async function renameRow(r, text) {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();
    const title = clean(text);
    if (title === clean(r.title)) { closeForm(rowOf(r.id)); return true; }
    setForm(f => (f?.kind === 'session' && f.session === r.id ? { ...f, sent: text } : f));
    const done = await change('api/layout/rename', { id: r.id, title });
    if (done) closeForm(rowOf(r.id));
    return !!done;
  }

  // Takes an archive back, puts the focus on the row that returns, and reopens the session if its archive closed it and the page is
  // still on the list. If the server refuses, the note keeps its Undo button to try again.
  async function undo({ id, title, reopen }) {
    const { problem } = await archive(id, false);
    if (!problem) {
      setAfter({ to: rowOf(id) });
      if (reopen && (!location.hash || location.hash === '#/')) location.hash = `#/s/${encodeURIComponent(id)}`;
    }
    setNote(problem ? { ...problemNote(problem), undo: { id, title, reopen } } : { text: `Unarchived ${title}.` });
  }

  // The menu of a row, opened by a right click, the menu key or a long press. Move to swaps it for a menu of places at the same spot,
  // headed by Move to again, which brings the first menu back with the focus on Move to, as the left arrow does. A chat the list shows
  // running is stopped as it is archived, and the item says so. Archive on a chat that turns out to be running asks first, as the key
  // does.
  latestMenu.current = (id, row, point, start = 0) => {
    const r = findRow(ix, id);
    if (!r) return;
    const title = r.title || UNTITLED;
    const running = isRunning(r);
    const targets = sessionTargets(ix, r);
    const show = menu => setShown({ key: `row-${++opened.current}`, session: id, anchor: row, point, ...menu });
    const choice = (label, section, where) => ({ label, run: () => moveRow(id, title, section, where) });
    const back = () => latestMenu.current(id, row, point, 1);
    const moveMenu = {
      label: `Move ${title} to`,
      start: 1,
      onBack: back,
      items: [
        { label: 'Move to', back: true, run: back },
        ...targets.map(t => (t.group
          ? { group: t.group, items: t.items.map(i => choice(i.label, i.section, `${i.label} in ${t.group}`)) }
          : choice(t.label, t.section, t.label))),
      ],
    };
    show({
      label: `Actions for ${title}`,
      start,
      items: [
        { label: 'Rename', run: () => setForm({ kind: 'session', session: id }) },
        ...(targets.length ? [{ label: 'Move to', more: true, run: () => show(moveMenu) }] : []),
        { label: running ? 'Stop and archive' : 'Archive', danger: running, hint: archiveHint(), run: () => archiveRow(id, title, { ask: !running }) },
      ],
    });
  };

  // Cmd+A archives the row with the focus ring, or else the open session. A click leaves a stale focus with no ring, so it is ignored.
  // An open menu takes the key for its own row or none, and a ring on anything else in the list or the sidebar takes it for none. A
  // search, a form in the list or the projects sidebar, or nothing to archive leaves the key to the browser.
  latestKey.current = e => {
    const el = document.activeElement;
    const inList = !!(nav.current?.contains(el) || projects.box.current?.contains(el));
    const ringed = inList && el.matches(':focus-visible');
    const row = ringed && el.matches('a.row[data-id]');
    const target = archiveTarget({
      modal: !!document.querySelector('[aria-modal="true"]'),
      menu: shown && { session: shown.session },
      form: inList && !!el.closest('form, .confirm'),
      ringed: row ? el.dataset.id : null,
      ringedOther: ringed && !row,
      current,
      listed: id => !!findRow(ix, id),
    });
    if (!target) return;
    e.preventDefault();
    if (e.repeat || target.id === null) return;
    if (shown) {
      if (shown.anchor.isConnected) shown.anchor.focus({ preventScroll: true });
      setShown(null);
    }
    const r = findRow(ix, target.id);
    const title = r.title || UNTITLED;
    if (isRunning(r)) confirmStop(r.id, title, { ring: true });
    else archiveRow(r.id, title, { ask: true, ring: true });
  };

  const closeForm = (...focus) => { setForm(null); setBack(focus); };
  const headOf = id => `.group-head[data-key="${CSS.escape(id)}"]`;
  const pop = (key, { label, items }, anchor) => setShown(open => (open?.key === key ? null : { key, anchor, label, items }));

  // A new session needs nothing from the list, so the + opens before the list has loaded, with only New session until it has.
  // An open + menu gains New group when the list arrives. The group goes in the view on screen, and New project is in the sidebar.
  const addMenu = {
    label: 'New session or group',
    items: [
      { label: 'New session', hint: `${mod} N`, run: newSession },
      ...(ix ? [{ label: 'New group', run: () => { if (view) expand(view); setForm({ kind: 'group', project: view }); } }] : []),
    ],
  };

  // A moved group leaves the view on screen, so the note says where it went and the focus goes to the group beside it.
  async function moveGroup(g, project) {
    const beside = neighbour(groupsIn(ix, view).map(x => x.id), g.id);
    const to = ix.projects.find(p => p.id === project)?.name ?? 'Home';
    const moved = await change('api/layout/group/move', { id: g.id, project });
    if (moved && project) expand(project);
    if (moved) setNote({ text: `Moved ${g.name} to ${to}.` });
    setBack(moved ? [beside && headOf(beside), '.add'].filter(Boolean) : [headOf(g.id)]);
  }

  async function addProject(name) {
    const { problem, made } = await edit('api/layout/project/add', { name });
    if (!made) return problem || 'Could not add the project.';
    projects.choose(made.id);
    projects.closeLevel(false);
    closeForm(headOf(made.id), '.add');
    return '';
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
    renaming: form?.kind === 'session' ? form.session : null,
    sessionForm: r => html`<${NameForm} label="Rename session" value=${form.sent ?? r.title} action="Save" max=${TITLE_MAX} onCancel=${() => closeForm(rowOf(r.id))} onSubmit=${text => renameRow(r, text)} />`,
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
        if (done) { projects.choose(null); closeForm('.add'); }
        return !!done;
      }} />`,
  };

  const topForm = form?.kind === 'group' && !form.project
    ? html`<${NameForm} label="New group" action="Create" onCancel=${() => closeForm('.add')} onSubmit=${name => addGroup(name, null)} />`
    : null;

  // A double click on a row's link renames it, after the first click has opened it as usual. A click with a modifier is left alone.
  const renameAt = e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const id = e.target.closest?.('a.row[data-id]')?.dataset.id;
    if (id) setForm({ kind: 'session', session: id });
  };

  return html`<${Fragment}>
  <${ProjectsPanel} ix=${ix} projects=${projects} creating=${form?.kind === 'project'} onNew=${() => setForm({ kind: 'project' })}
    onCancel=${() => closeForm('.new-project')} onCreate=${addProject} />
  <nav class="list" aria-label="Sessions" ref=${nav}>
    <header class="list-head">
      <${ProjectsToggle} projects=${projects} />
      <div class="brand"><span class="station">${STATION}</span><h1>Capcom</h1></div>
      <div class="list-actions">
        <button class="icon-btn add" type="button" aria-label=${addMenu.label} title=${addMenu.label} aria-haspopup="menu" aria-expanded=${shown?.key === 'add'} onClick=${e => pop('add', addMenu, e.currentTarget)}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        <button class="icon-btn find" type="button" aria-label="Find a session" title=${`Find a session (${mod}+K)`} onClick=${onFind}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12.6 12.6 17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
    </header>
    <p class="problem" id="problem" hidden=${!ix?.problem}>${ix?.problem ? `${ix.problem}.` : ''}</p>
    <div role="status">${note
      ? html`<p class=${note.problem ? 'problem' : 'note'} id="listNote">${note.text}${note.undo ? html` <button class="link" type="button" onClick=${() => undo(note.undo)}>Undo</button>` : null}</p>`
      : null}</div>
    ${banner}
    ${topForm}
    <div class="sections" id="sections" ref=${box} onDblClick=${renameAt}>
      ${ix
        ? html`<${Sections} ix=${ix} view=${view} current=${current} collapsed=${collapsed} toggle=${toggle} openRoutines=${openRoutines} toggleRoutine=${toggleRoutine} drag=${drag} tree=${tree} />`
        : html`<p class="quiet pad">${error ? `Could not load sessions: ${error}` : 'Loading sessions'}</p>`}
    </div>
    <footer class="list-foot">
      <a href="#/passkeys" aria-current=${passkeys ? 'page' : null}>Passkeys</a>
      <form method="post" action="logout"><button class="link" type="submit">Sign out</button></form>
    </footer>
    ${shown ? html`<${Menu} key=${shown.key} anchor=${shown.anchor} point=${shown.point} label=${shown.label} items=${shown.key === 'add' ? addMenu.items : shown.items} start=${shown.start} onBack=${shown.onBack} onClose=${() => setShown(null)} />` : null}
  </nav>
<//>`;
}
