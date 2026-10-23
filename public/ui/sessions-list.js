// The list of sessions on the left, for the view the projects sidebar picks. Home has the routines, the groups outside projects and the
// sessions started here or in a terminal, and a project has its groups. Pinned sessions show in every view. A row can be dragged
// onto a section to move it there, or onto another row to nest it under that one. Everything else is done from menus, so a phone can
// do it all.
import { ask } from './ask.js';
import { dragRows, pointIn } from './drag.js';
import { HOME, STATION } from './env.js';
import { NameForm } from './forms.js';
import { DOT_LABEL, duration, folderName, STATE_LABEL, when } from './format.js';
import { useClock, useLocal, useModifier } from './hooks.js';
import { Fragment, html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { draw, icons, layerId, Menu, opener } from './menu.js';
import { UNTITLED } from './order.js';
import { anchorAt, archiveNote, extend, inOrder, NO_PICK, prune, sessions, stayAfter, step, stopDetail, toggle as toggleRow, unarchiveNote } from './pick.js';
import { ProjectsPanel, ProjectsToggle } from './projects.js';
import { groupsIn, HOME_VIEW } from './scopes.js';
import { Shell } from './shell.js';
import { archiveHint, keyHint, onMac, shortcut } from './shortcuts.js';
import { say } from './toast.js';
import { archiveTarget, findRow, LOOSE, LOOSE_NAMES, looseHome, moveTargets, neighbour, nestTargets, nextStop, rootOf, sessionTargets, TITLE_MAX, withKids } from './tree.js';

// The target a row is while another is dragged over it, which only its middle half counts as. See targetAt in drag.js.
const NEST = 'nest:';

// `drop` is whether a dragged row can nest here, and `over` whether it would land here now, which the row says at its right end.
// A working row's time sits there too, from `turnStart`, which stampTurns puts on this page's clock. The mark is the server's `dot`.
// Where the session is and when it last ran: a mouse reads it in the row's tooltip and a touch screen, which has none, on a second line.
// The line stays in the row for a screen reader either way, so the CSS only hides it from the eye.
function RowLink({ r, title = r.title, current, lifted, marked, picked, drop, over }) {
  const timed = r.turnStart != null;
  useClock(timed, r.turnStart);
  const last = when(r.lastActivityAt);
  const where = [folderName(r.cwd, HOME), r.branch, DOT_LABEL[r.dot] ?? STATE_LABEL[r.state]].filter(Boolean).join(' · ');
  const at = title === last ? '' : last;
  const detail = [where, at].filter(Boolean).join(' · ');
  return html`<a class="row" href=${`#/s/${encodeURIComponent(r.id)}`} data-id=${r.id} draggable=${false} data-lifted=${lifted || null} data-menu=${marked || null} data-picked=${picked || null}
    data-drop=${drop ? NEST + r.id : null} data-drop-middle=${drop ? '' : null} data-over=${over || null} aria-current=${current === r.id ? 'page' : null}
    data-tip=${detail || null} data-tip-side="right" data-tip-delay="700">
    ${r.dot ? html`<span class="row-dot" data-dot=${r.dot} aria-hidden="true">${r.dot === 'error' ? draw(icons.triangleAlert) : null}</span>` : null}
    <span class="row-title">${title || UNTITLED}</span>${picked ? html`<span class="sr">, selected</span>` : null}
    ${over ? html`<span class="row-nest">Nest here</span>` : timed ? html`<span class="row-run" aria-hidden="true">${duration(Date.now() - r.turnStart)}</span>` : null}
    ${detail ? html`<span class="row-meta">${where ? html`<span class="row-where">${where}</span>` : null}${at ? html`<time class="row-time">${where ? ' · ' : ''}${at}</time>` : null}</span>` : null}</a>`;
}

// The dots button at the end of a session's row, beside the link. It opens the row's menu under itself, for a pointer with no right
// click to use, and shows while the pointer is over the row or the focus is in it.
function RowMore({ r, tree }) {
  const label = `Actions for ${r.title || UNTITLED}`;
  const open = tree.shown?.key === 'row' && tree.shown.session === r.id;
  const trigger = opener((button, entry) => tree.rowMenu(r.id, button, entry));
  return html`<button class="more" type="button" aria-label=${label} data-tip=${label} aria-haspopup="menu" aria-expanded=${open} aria-controls=${open ? layerId(tree.shown.id) : null} data-state=${open ? 'open' : 'closed'} ...${trigger}>${dots()}</button>`;
}

// A row being renamed shows its form where the link was.
const Row = ({ tree, ...props }) => html`<li>${tree.renaming === props.r.id ? tree.sessionForm(props.r) : html`<${RowLink} ...${props} /><${RowMore} r=${props.r} tree=${tree} />`}</li>`;

const rowOf = id => `a.row[data-id="${CSS.escape(id)}"]`;

const dots = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>`;

const chevron = () => draw(['m9 18 6-6-6-6'], 'chevron');

const Empty = ({ paths, title, action, children }) => html`<div data-slot="empty">
  <div data-slot="empty-header">
    <div data-slot="empty-icon" data-variant="icon">${draw(paths)}</div>
    <div data-slot="empty-title">${title}</div>
    <div data-slot="empty-description">${children}</div>
  </div>
  ${action ? html`<div data-slot="empty-content">${action}</div>` : null}
</div>`;

// The header of a group. `menu` is { label, items } for the button at its end, or null for a header with no actions.
// The same menu opens on a right click, at the pointer, or the menu key, under the button.
function Head({ id, name, count, open, toggle, menu, tree }) {
  const pop = (button, point, entry) => tree.pop(id, menu, button, { point, entry });
  const trigger = opener((button, entry) => pop(button, null, entry));
  const shown = tree.shown?.key === id;
  return html`<div class=${menu ? 'bar has-menu' : 'bar'} onContextMenu=${menu && (e => { e.preventDefault(); pop(e.currentTarget.querySelector('.more'), pointIn(e.currentTarget, e)); })}>
    <button class="group-head" type="button" data-key=${id} aria-expanded=${open} onClick=${() => toggle(id, open)}><span class="name">${name}</span> <span class="badge count">${count}</span>${chevron()}</button>
    ${menu ? html`<button class="more" type="button" aria-label=${menu.label} data-tip=${menu.label} aria-haspopup="menu" aria-expanded=${shown} aria-controls=${shown ? layerId(tree.shown.id) : null} data-state=${shown ? 'open' : 'closed'} ...${trigger}>${dots()}</button>` : null}
  </div>`;
}

function Section({ id, name, count, collapsed, toggle, drop, over, menu, tree, children }) {
  const open = !collapsed[id];
  return html`<section class="group" data-drop=${drop ? id : null} data-over=${over || null}>
    <${Head} id=${id} name=${name} count=${count} open=${open} toggle=${toggle} menu=${menu} tree=${tree} />
    ${open && children ? html`<ul class="rows">${children}</ul>` : null}</section>`;
}

// The button at the end of a row that folds the rows nested under it in and out. The list it controls is drawn only while it is open.
const FoldButton = ({ label, open, controls, onClick }) => html`<button class="fold" type="button" aria-expanded=${open} aria-controls=${open ? controls : null} aria-label=${label} data-tip=${label} onClick=${onClick}>${chevron()}</button>`;

// The latest run of a routine, with the earlier ones folded away until asked for.
// A routine's row opens its latest run. The arrow at its end folds the earlier runs out underneath.
function Routine({ g, rowProps, open, onToggle, tree }) {
  const earlier = g.earlier.length;
  const runs = `${earlier} earlier run${earlier > 1 ? 's' : ''}`;
  const renaming = tree.renaming === g.latest.id;
  const list = `runs-${g.latest.id}`;
  return html`<li class=${earlier ? 'has-fold' : null}>
    ${renaming ? tree.sessionForm(g.latest) : html`<${RowLink} r=${g.latest} ...${rowProps(g.latest)} /><${RowMore} r=${g.latest} tree=${tree} />`}
    ${earlier && !renaming ? html`<${FoldButton} label=${runs} open=${open} controls=${list} onClick=${() => onToggle(g.name)} />` : null}
    ${earlier && open ? html`<ul class="sub-rows earlier-runs" id=${list}>${g.earlier.map(r => html`<${Row} key=${r.id} r=${r} title=${r.renamed ? r.title : when(r.lastActivityAt)} ...${rowProps(r)} tree=${tree} />`)}</ul>` : null}
  </li>`;
}

// A session with others nested under it. Its row opens it, and the arrow at its end folds the nested ones in and out underneath.
// While one of them is carried (`holds`), their list takes a drop as a nest under this session, so letting go anywhere in it leaves
// the carried session where it is, instead of falling through to the section and taking it out.
function Family({ r, rowProps, holds, open, onToggle, tree }) {
  const count = r.children.length;
  const nested = `${count} nested session${count > 1 ? 's' : ''}`;
  const renaming = tree.renaming === r.id;
  const list = `family-${r.id}`;
  return html`<li class="has-fold">
    ${renaming ? tree.sessionForm(r) : html`<${RowLink} r=${r} ...${rowProps(r)} /><${RowMore} r=${r} tree=${tree} />`}
    ${renaming ? null : html`<${FoldButton} label=${nested} open=${open} controls=${list} onClick=${() => onToggle(r.id)} />`}
    ${open ? html`<ul class="sub-rows" id=${list} aria-label=${`Nested under ${r.title || UNTITLED}`} data-drop=${holds ? NEST + r.id : null}>${r.children.map(c => html`<${Row} key=${c.id} r=${c} ...${rowProps(c)} tree=${tree} />`)}</ul>` : null}
  </li>`;
}

// While a row is dragged, every section that can take it is shown, so an empty Pinned or group is still a place to drop it.
// A group always shows, empty or not, so one that was just made can be found and filled.
// Over a row, the row is the target and no section is. The carried row and the ones nested under it dim, and take no drop.
function Sections({ ix, view, current, collapsed, toggle, folded, toggleFold, openRoutines, toggleRoutine, drag, tree, picked, newKey }) {
  const carried = drag && findRow(ix, drag.id);
  const together = new Set(carried ? [carried.id, ...(carried.children ?? []).map(c => c.id)] : []);
  const nesting = drag?.over?.startsWith(NEST) ? drag.over.slice(NEST.length) : null;
  const over = nesting ? null : drag?.over;
  const lands = over && carried && LOOSE.includes(over) ? looseHome(carried) ?? over : over;
  const marked = tree.shown?.session;
  const rowProps = r => ({ current, lifted: together.has(r.id), marked: r.id === marked, picked: picked.has(r.id), drop: !!carried && !together.has(r.id) && !r.routine, over: r.id === nesting });
  const rows = list => list.map(r => (r.children
    ? html`<${Family} key=${r.id} r=${r} rowProps=${rowProps} holds=${carried?.parent === r.id} open=${!folded[r.id]} onToggle=${toggleFold} tree=${tree} />`
    : html`<${Row} key=${r.id} r=${r} ...${rowProps(r)} tree=${tree} />`));
  const section = (id, name, list, body, { drop = true, always = false, menu = null } = {}) => {
    if (!list.length && !always && !(drag && drop)) return null;
    return html`<${Section} key=${id} id=${id} name=${name} count=${withKids(list).length} collapsed=${collapsed} toggle=${toggle} drop=${drop} over=${lands === id} menu=${menu} tree=${tree}>${list.length ? body : drag ? html`<li class="drop-hint">Drop here</li>` : null}<//>`;
  };
  const home = view === HOME_VIEW;
  const group = g => section(g.id, g.name, g.sessions, rows(g.sessions), { always: true, menu: tree.groupMenu(g) });
  const project = ix.projects.find(p => p.id === view);
  const groups = groupsIn(ix, view);
  const adding = !!project && tree.form?.kind === 'group' && tree.form.project === project.id;
  const parts = [
    home && section('routines', 'Routines', ix.routines, ix.routines.map(g => html`<${Fragment} key=${g.name}><${Routine} g=${g} rowProps=${rowProps} open=${openRoutines.has(g.name)} onToggle=${toggleRoutine} tree=${tree} /><//>`), { drop: false }),
    section('pinned', 'Pinned', ix.pinned, rows(ix.pinned)),
    ...groups.map(group),
    adding && tree.groupForm(project),
    project && !groups.length && !adding && html`<${Empty} paths=${icons.folderPlus} title="No groups yet" action=${html`<button class="btn new-group" data-variant="outline" data-size="sm" type="button" onClick=${() => tree.newGroup(project, ['.new-group'])}>New group</button>`}>Make one with New group, or move one here from a group's menu in Home.<//>`,
    home && section('started', LOOSE_NAMES.started, ix.started, rows(ix.started)),
    home && section('ungrouped', LOOSE_NAMES.ungrouped, ix.ungrouped, rows(ix.ungrouped)),
    home && section('other', LOOSE_NAMES.other, ix.other, rows(ix.other)),
  ].filter(Boolean);
  return parts.length ? parts : html`<${Empty} paths=${icons.messageSquarePlus} title="No sessions found">Press <kbd>${newKey}</kbd> to start one.<//>`;
}

// The arrows walk the list like a tree: up and down through headers and rows, left and right to fold a section or the sessions
// nested under a row. Enter opens the focused row, as a link does. With nothing focused, up or down starts at the open session.
const STOPS = '.group-head, a.row[data-id]';

// A header's menu button and a row's menu and fold buttons belong to the header or row beside them, so the arrows carry on from there.
function stopBeside(el) {
  if (el?.matches?.('.more, .fold')) return el.closest('.bar')?.querySelector('.group-head') ?? el.parentElement.querySelector(':scope > a.row');
  return el;
}

function walk(e, box) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !box || e.target.closest?.('input, textarea, form')) return;
  const stops = [...box.querySelectorAll(STOPS)];
  const at = stops.indexOf(stopBeside(document.activeElement));
  // focus() alone would put a stop that was out of view in the middle of the list, so the list scrolls only as far as its nearest edge.
  const go = el => { e.preventDefault(); el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); };
  const to = nextStop(stops.length, at, e.key, Math.max(stops.indexOf(box.querySelector('a.row[aria-current="page"]')), 0));
  if (to >= 0) return go(stops[to]);
  const here = stops[at];
  if (!here || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
  const opening = e.key === 'ArrowRight';
  const item = here.parentElement;
  const fold = here.matches('.group-head') ? here : item.querySelector(':scope > .fold');
  // A nested row goes left to the row it is nested under, and a row with its fold open goes right to the first one nested under it.
  const owner = item.parentElement.closest('.sub-rows')?.parentElement.querySelector(':scope > a.row');
  if (fold && (fold.getAttribute('aria-expanded') === 'true') !== opening) { e.preventDefault(); fold.click(); }
  else if (!opening && owner) go(owner);
  else if (opening) {
    const first = item.querySelector(':scope > .sub-rows a.row');
    if (first) go(first);
  } else if (!here.matches('.group-head')) {
    const head = here.closest('.group')?.querySelector('.group-head');
    if (head) go(head);
  }
}

// Opens a new session. When one is open already the cursor goes to its message box, because setting the same hash does nothing.
export const newSession = () => { if (location.hash === '#/new') document.getElementById('text')?.focus(); else location.hash = '#/new'; };

// A note about something that did not work, which shows with a warning. No reason means no note, and clears an older one.
const problemNote = text => say(text, { problem: true });

const isRunning = r => r.state === 'working' || r.state === 'waiting';
const STOP_DETAIL = "Archiving stops Claude's turn and denies any approval it is waiting for. Undo brings the session back, but not the turn.";

// `projects` is the projects sidebar's state, which the app owns because the search changes it as well.
// `place(id, section)` moves a dropped row and resolves with the reason when the server refuses, or an empty string. `nest(id, parent)`
// does the same for a row nested under another, or taken out of its parent when `parent` is null.
// `edit(path, body)` sends a change to projects or groups and resolves with { problem, made }, where `made` is the project or
// group the server made, changed or removed. `archive(id, archived, { stop })` archives or unarchives a session and resolves with
// { problem, stopped, running }: the reason when the server refuses, whether it stopped a chat that was running, and whether it
// refused because one was running and `stop` was false. `archiveAll(ids, archived, { stop })` does that for several, one after another,
// and resolves with { done, stopped, failed }: the ids it took, how many were running chats it stopped, and { id, message, running } for
// each it refused.
export function SessionList({ ix, projects, error, current, place, nest, edit, archive, archiveAll, onFind, passkeys, banner }) {
  const [collapsed, setCollapsed] = useLocal('collapsed', {});
  const [folded, setFolded] = useLocal('folded', {});
  const { view } = projects;
  const mod = useModifier();
  const [openRoutines, setOpenRoutines] = useState(new Set());
  const [drag, setDrag] = useState(null);
  const [form, setForm] = useState(null);
  const [shown, setShown] = useState(null);
  const [back, setBack] = useState(null);
  const [after, setAfter] = useState(null);
  const [pick, setPick] = useState(NO_PICK);
  const nav = useRef(null);
  const box = useRef(null);
  const opened = useRef(0);
  const latestPlace = useRef(place);
  latestPlace.current = place;
  const latestNest = useRef(null);
  const latestMenu = useRef(null);
  const latestKey = useRef(null);
  const latestStep = useRef(null);
  const pointer = useRef('mouse');
  const toggle = (id, open) => setCollapsed(all => ({ ...all, [id]: open }));
  const toggleRoutine = name => setOpenRoutines(all => { const next = new Set(all); if (!next.delete(name)) next.add(name); return next; });
  // Only a folded family is kept, so the browser does not collect an entry for every session that was ever folded.
  const fold = (id, on) => setFolded(all => ({ ...Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)), ...(on && { [id]: true }) }));
  const toggleFold = id => fold(id, !folded[id]);
  const drawnIds = () => [...box.current.querySelectorAll('a.row[data-id]')].map(a => a.dataset.id);

  // The family of the chat on screen opens once for each chat, as its row arrives, so a session started into a folded family is in
  // view. A family folded while the chat is open stays folded.
  const unfolded = useRef(null);
  useEffect(() => {
    if (!current) { unfolded.current = null; return; }
    if (unfolded.current === current || !findRow(ix, current)) return;
    unfolded.current = current;
    const root = rootOf(ix, current);
    if (root.id !== current && folded[root.id]) fold(root.id, false);
  }, [current, ix]);

  useEffect(() => dragRows(box.current, {
    onStart: id => setDrag({ id, over: null }),
    onOver: over => setDrag(d => d && { ...d, over }),
    onEnd: async (id, to) => {
      setDrag(null);
      if (to) problemNote(to.startsWith(NEST) ? await latestNest.current(id, to.slice(NEST.length)) : await latestPlace.current(id, to));
    },
    onMenu: (id, row, point) => latestMenu.current(id, row, point),
  }), []);

  // With no chat open and nothing focused, up or down steps into the list. With a chat open they are left to scroll it.
  useEffect(() => {
    const onKey = e => {
      if (shortcut(e) === 'archive') return latestKey.current(e);
      const el = document.activeElement;
      if (box.current?.contains(el)) return e.shiftKey ? latestStep.current(e) : walk(e, box.current);
      const idle = (!el || el === document.body) && !document.getElementById('session');
      if (idle && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) walk(e, box.current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Each view starts at the top of the list. A form left open in the view before closes, so a group is never made in a view that is
  // off screen and a form does not come back with its view, except the group form that New group here opens along with the pick, which
  // is scrolled back into sight. New project and a project's rename are in the sidebar, so they stay. This comes before the effects
  // that move the focus, so a header they focus scrolls into sight after the jump to the top.
  useLayoutEffect(() => {
    box.current.scrollTop = 0;
    box.current.querySelector(':scope > .name-form')?.scrollIntoView({ block: 'nearest' });
    // Pinned rows show in every view, so pruning alone would carry their selection into the next.
    setPick(NO_PICK);
    setForm(open => (open && (open.kind === 'project' || open.kind === 'rename' || (open.kind === 'group' && open.project === view)) ? open : null));
  }, [view]);

  // Focus goes to the project or group a closed form made, or back to what it replaced or came from, as soon as the list has been
  // drawn without the form. The first selector that matches wins, so when the list could not be loaded again focus goes to the next
  // one rather than to the page. The sidebar is searched only while it is open, because a sheet that is closing is still in the page and
  // must not take the focus. It scrolls into view, so `focus()` must never be given preventScroll.
  useLayoutEffect(() => {
    if (back === null) return;
    back.map(to => nav.current.querySelector(to) || (projects.open ? projects.box.current?.querySelector(to) : null)).find(Boolean)?.focus();
    setBack(null);
  }, [back]);

  // A view picked in the search gets the focus on its first group, or the New group button of a project with none, then on the first
  // header, then on the opener, once the list shows it. A focus still waiting for a row gives way to it.
  useLayoutEffect(() => {
    if (!projects.landing) return;
    const { view: landed } = projects.landing;
    const first = ix && landed && groupsIn(ix, landed)[0];
    const to = (first && nav.current.querySelector(headOf(first.id))) || (landed && nav.current.querySelector('.new-group'))
      || box.current.querySelector('.group-head') || projects.opener.current;
    to?.focus();
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
  // routine's earlier runs, past the newest 60), and the form is then dropped rather than coming back unasked later. A project's rename
  // form goes when a reload no longer lists the project.
  useLayoutEffect(() => {
    if (form?.kind === 'session' && !box.current?.querySelector('.name-form')) setForm(null);
    if (form?.kind === 'rename' && ix && !ix.projects.some(p => p.id === form.project)) setForm(null);
  });

  // The selection only holds rows that are drawn, so a fold, a reload or a rename form takes its rows out of it, and so does an open chat
  // that hides the list below 56rem, whose rows stay in the page. The update works on the selection as it stands, so a view change that
  // cleared it a moment ago is not undone by a prune of the one before.
  useLayoutEffect(() => {
    const drawn = box.current.getClientRects().length ? drawnIds() : [];
    if (prune(pick, drawn) !== pick) setPick(now => prune(now, drawn));
  });

  // Sends one change to the layout. It resolves with what the server made, changed or removed, or with null when it refused,
  // and then shows the reason at the top of the list.
  async function change(path, body) {
    const { problem, made } = await edit(path, body);
    problemNote(problem);
    return problem ? null : made;
  }

  // Starts a change that takes the row out of its place and resolves with what `start` resolves with. The focus moves on to the row
  // beside it at once, with its ring if `ring`, and back to the row if the change is refused. With no row left beside it, a ring goes
  // to the first header, or to the Projects button when no header is left, so the keyboard stays in the list and a press too many
  // archives nothing.
  async function leaving(id, start, ring = false) {
    const ids = drawnIds();
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
    if (problem) problemNote(problem);
    else say(`${stopped ? 'Stopped and archived' : 'Archived'} “${title}”.`, { action: undoAction({ id, title, reopen: onScreen }) });
  }

  const confirmStop = (id, title, { back, ring } = {}) => ask({ action: 'Stop and archive', title, detail: STOP_DETAIL, back, run: () => archiveRow(id, title, { ring }) });

  // The same for several rows leaving together. The focus goes to the row beside them, or back to them if none of them went.
  async function leavingAll(ids, start, ring = false) {
    const order = drawnIds();
    // As in `leaving`, a routine's next run takes the place of its latest, unless it leaves too.
    const next = ix.routines.find(g => g.latest.id === order.findLast(id => ids.includes(id)))?.earlier[0]?.id;
    const to = next && !ids.includes(next) ? next : stayAfter(order, ids);
    const done = start();
    setAfter(to ? { to: rowOf(to), ring } : ring ? { to: '.group-head', ring } : null);
    const result = await done;
    if (!result.done.length) setAfter({ to: ids.map(rowOf).join(', '), ring });
    return result;
  }

  // Archives the picked sessions. One goes the way any archive does, so its note and Undo are the same. Several that include a running
  // chat are asked about once, and Cancel leaves the selection as it was.
  function archiveMany(ids, { ring = false, back } = {}) {
    const rows = ids.map(id => findRow(ix, id)).filter(Boolean);
    if (rows.length < 2) {
      const [r] = rows;
      if (r) (isRunning(r) ? confirmStop(r.id, r.title || UNTITLED, { ring, back }) : archiveRow(r.id, r.title || UNTITLED, { ask: true, ring }));
      return;
    }
    const running = rows.filter(isRunning).length;
    const every = rows.map(r => r.id);
    if (!running) return archiveBatch(every, { ring });
    ask({ action: 'Stop and archive', title: sessions(every.length), detail: stopDetail(running), back, run: () => archiveBatch(every, { stop: true, ring }) });
  }

  // Sends the batch and says what happened, with one Undo for the sessions that went. A chat that turned out to be running when none
  // were meant to be stopped is asked about once more, and `tally` carries what the first round did into the note after it.
  async function archiveBatch(ids, { stop = false, ring = false, tally = { count: ids.length, done: [], stopped: 0, refused: [], reopen: null } } = {}) {
    setPick(NO_PICK);
    const { done, stopped, failed } = await leavingAll(ids, () => archiveAll(ids, true, { stop }), ring);
    const running = failed.filter(f => f.running).map(f => f.id);
    const all = { ...tally, done: [...tally.done, ...done], stopped: tally.stopped + stopped, refused: [...tally.refused, ...failed.filter(f => !f.running)] };
    // The session on screen goes to the list when it was archived, and Undo reopens it.
    if (!all.reopen) all.reopen = all.done.find(id => location.hash === `#/s/${encodeURIComponent(id)}`) ?? null;
    if (all.reopen && location.hash === `#/s/${encodeURIComponent(all.reopen)}`) location.hash = '#/';
    const settled = all.count - running.length;
    if (settled) {
      const note = archiveNote({ archived: all.done.length, total: settled, stopped: all.stopped, reason: all.refused[0]?.message });
      say(note, { problem: all.done.length < settled, action: all.done.length ? undoManyAction(all.done, all.reopen) : undefined });
    }
    if (!running.length) return;
    setAfter(null);
    ask({ action: 'Stop and archive', title: sessions(running.length), detail: stopDetail(running.length), back: () => box.current.querySelector(running.map(rowOf).join(', ')), run: () => archiveBatch(running, { stop: true, ring, tally: all }) });
  }

  // Moves a session the way a drop does, and says where it went or why it did not. `where` names the place in the note.
  async function moveRow(id, title, section, where) {
    const { problem } = await leaving(id, async () => ({ problem: await latestPlace.current(id, section) }));
    say(problem || (section === 'pinned' ? `Pinned “${title}”.` : `Moved “${title}” to ${where}.`), { problem: !!problem });
  }

  // A family opens when a session joins it, so the row is there to be seen where it went. This is the one way a drop and a menu nest.
  latestNest.current = (id, parent) => {
    const root = parent && rootOf(ix, parent);
    if (root) fold(root.id, false);
    return nest(id, parent);
  };

  // Nests a session the way a drop does, or takes it out of its parent when `parent` is null, and says where it went or why it did not.
  async function nestSession(id, title, parent, parentTitle) {
    const { problem } = await leaving(id, async () => ({ problem: await latestNest.current(id, parent) }));
    say(problem || (parent ? `Nested “${title}” under “${parentTitle}”.` : `Moved “${title}” out of “${parentTitle}”.`), { problem: !!problem });
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
    if (problem) say(problem, { problem: true, action: undoAction({ id, title, reopen }) });
    else say(`Unarchived “${title}”.`);
  }

  const undoAction = note => ({ label: 'Undo', onClick: () => undo(note) });

  // Takes a batch back with one reload at the end, and puts the focus on the first row that returns. A session that did not come back
  // keeps an Undo button on the note to try again.
  async function undoMany({ ids, reopen }) {
    const { done, failed } = await archiveAll(ids, false);
    if (done.length) {
      setAfter({ to: done.map(rowOf).join(', ') });
      if (reopen && done.includes(reopen) && (!location.hash || location.hash === '#/')) location.hash = `#/s/${encodeURIComponent(reopen)}`;
    }
    const note = { restored: done.length, total: ids.length, reason: failed[0]?.message };
    if (failed.length) say(unarchiveNote(note), { problem: true, action: undoManyAction(failed.map(f => f.id), reopen) });
    else say(unarchiveNote(note));
  }

  const undoManyAction = (ids, reopen) => ({ label: 'Undo', onClick: () => undoMany({ ids, reopen }) });

  // The menu of a row, opened by a right click or a long press at the pointer, or by the menu key under the row. Move to opens the
  // places in a menu beside it. A chat the list shows running is stopped as it is archived, and the item says so. Archive on a chat
  // that turns out to be running asks first, as the key does.
  latestMenu.current = (id, row, point, entry = null) => {
    const r = findRow(ix, id);
    if (!r) return;
    const title = r.title || UNTITLED;
    const chosen = inOrder(pick, drawnIds());
    // A menu on a row outside the selection ends it, as in Finder, and a menu on a row inside it is the whole selection's.
    if (chosen.length && !chosen.includes(id)) setPick(NO_PICK);
    if (chosen.length > 1 && chosen.includes(id)) {
      const back = () => box.current.querySelector(rowOf(id));
      return setShown({
        id: ++opened.current,
        key: 'row',
        session: id,
        anchor: row,
        point,
        entry,
        label: `Actions for ${sessions(chosen.length)}`,
        items: [
          { label: `Archive ${sessions(chosen.length)}`, icon: icons.archive, danger: chosen.some(c => { const row = findRow(ix, c); return row && isRunning(row); }), hint: archiveHint(), run: () => archiveMany(chosen, { back }) },
          { label: 'Clear selection', icon: icons.x, run: () => setPick(NO_PICK) },
        ],
      });
    }
    const picked = chosen.includes(id);
    const running = isRunning(r);
    const targets = sessionTargets(ix, r);
    const parent = findRow(ix, r.parent);
    const under = nestTargets(ix, r);
    const choice = (label, section, where) => ({ label, run: () => moveRow(id, title, section, where) });
    const entries = targets.map(t => (t.group
      ? { group: t.group, items: t.items.map(i => choice(i.label, i.section, `${i.label} in ${t.group}`)) }
      : choice(t.label, t.section, t.label)));
    // What follows the projects' groups is Home's, and takes a heading of its own so the sections read alike.
    const lastProject = targets.map(t => !!t.group).lastIndexOf(true);
    const tail = lastProject >= 0 ? entries.splice(lastProject + 1) : [];
    if (tail.length) entries.push({ group: 'Home', items: tail });
    const places = entries.flatMap((entry, n) => (n && (entry.group || entries[n - 1].group) ? [{ separator: true }, entry] : [entry]));
    setShown({
      id: ++opened.current,
      key: 'row',
      session: id,
      anchor: row,
      point,
      entry,
      label: `Actions for ${title}`,
      items: [
        { label: 'Rename', icon: icons.pencil, run: () => setForm({ kind: 'session', session: id }) },
        ...(parent ? [{ label: `Move out of “${parent.title || UNTITLED}”`, icon: icons.indentDecrease, run: () => nestSession(id, title, null, parent.title || UNTITLED) }] : []),
        ...(under.length ? [{ label: 'Nest under', icon: icons.indentIncrease, items: under.map(t => ({ label: t.title || UNTITLED, run: () => nestSession(id, title, t.id, t.title || UNTITLED) })) }] : []),
        ...(places.length ? [{ label: 'Move to', icon: icons.folderInput, items: places }] : []),
        { label: picked ? 'Deselect' : 'Select', icon: icons.squareCheck, run: () => setPick(p => toggleRow(p, id)) },
        { separator: true },
        { label: running ? 'Stop and archive' : 'Archive', icon: icons.archive, danger: running, hint: archiveHint(), run: () => archiveRow(id, title, { ask: !running }) },
      ],
    });
  };

  // Cmd+A archives the selection, or else the row with the focus ring, or else the open session. A click leaves a stale focus with no
  // ring, so it is ignored. An open menu takes the key for its own row or none, or the selection when its row is in it, and a ring on
  // anything else in the list or the sidebar takes it for none. A search, a form in the list or the projects sidebar, or nothing to
  // archive leaves the key to the browser.
  latestKey.current = e => {
    const el = document.activeElement;
    const inList = !!(nav.current?.contains(el) || projects.box.current?.contains(el));
    const ringed = inList && el.matches(':focus-visible');
    const row = ringed && el.matches('a.row[data-id]');
    const target = archiveTarget({
      modal: !!document.querySelector('[aria-modal="true"], [data-slot$="dialog-content"], [data-mobile="true"]'),
      menu: shown && { session: shown.session },
      form: inList && !!el.closest('form'),
      ringed: row ? el.dataset.id : null,
      ringedOther: ringed && !row,
      current,
      listed: id => !!findRow(ix, id),
      picked: inOrder(pick, drawnIds()),
    });
    if (!target) return;
    e.preventDefault();
    if (e.repeat || target.id === null) return;
    if (shown) {
      if (shown.anchor.isConnected) shown.anchor.focus({ preventScroll: true });
      setShown(null);
    }
    if (target.ids) return archiveMany(target.ids, { ring: true });
    const r = findRow(ix, target.id);
    const title = r.title || UNTITLED;
    if (isRunning(r)) confirmStop(r.id, title, { ring: true });
    else archiveRow(r.id, title, { ask: true, ring: true });
  };

  // Shift+Down and Shift+Up from a row move the focus to the next or the one before and pick the rows from the anchor to it.
  latestStep.current = e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest?.('input, textarea, form')) return;
    const from = stopBeside(document.activeElement);
    if (!from?.matches?.('a.row[data-id]') || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const go = step(pick, drawnIds(), from.dataset.id, e.key);
    if (!go) return;
    setPick(go.state);
    const to = box.current.querySelector(rowOf(go.to));
    to.focus({ preventScroll: true });
    to.scrollIntoView({ block: 'nearest' });
  };

  // Esc in the list ends a selection, unless a menu, dialog or tooltip has used it or the focus is in a text field. It is marked used, so
  // the composer's Esc, which hears it next, does not also stop the open chat's turn.
  const escapeList = e => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !pick.ids.length || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    setPick(NO_PICK);
  };

  // Shift picks the rows from the anchor to the row clicked and Cmd, or Ctrl off a Mac, picks that row alone, and neither opens it. A
  // tap on a phone picks too while anything is picked. A plain click opens the row as a link does, makes it the anchor and ends the
  // selection. Ctrl-click on a Mac is the context menu.
  const clickRow = e => {
    const row = e.target.closest?.('a.row[data-id]');
    if (!row || e.altKey || (onMac() && e.ctrlKey)) return;
    const id = row.dataset.id;
    const range = e.shiftKey;
    if (!range && !(onMac() ? e.metaKey : e.ctrlKey) && !(pointer.current === 'touch' && e.detail > 0 && pick.ids.length)) return setPick(p => anchorAt(p, id));
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    row.focus({ preventScroll: true });
    setPick(p => (range ? extend(p, drawnIds(), id) : toggleRow(p, id)));
  };

  // A Shift press would start a text selection through the rows before the click picks them.
  const pressRow = e => { if (e.shiftKey && e.target.closest?.('a.row[data-id]')) e.preventDefault(); };

  // The Clear button goes with the selection, so the focus moves to the anchor row.
  const clearPick = () => {
    setPick(NO_PICK);
    if (pick.anchor) setAfter({ to: rowOf(pick.anchor) });
  };

  const closeForm = (...focus) => { setForm(null); setBack(focus); };
  const headOf = id => `.group-head[data-key="${CSS.escape(id)}"]`;
  const scopeOf = id => (id ? `.scope[data-key="${CSS.escape(id)}"]` : '.scope.home');
  // A button's menu closes when its button is pressed again. A key that asks for the first or last item (`entry`) opens it afresh.
  // A `rail` menu is a project's, drawn by the sidebar.
  const pop = (key, { label, items }, anchor, { entry = null, point = null, rail = false } = {}) =>
    setShown(open => (open?.key === key && !entry ? null : { id: ++opened.current, key, anchor, point, entry, label, items, rail }));

  // A new session needs nothing from the list, so the + opens before the list has loaded, with only New session until it has.
  // An open + menu gains New group when the list arrives. The group goes in the view on screen, and New project is in the sidebar.
  const addMenu = {
    label: 'New session or group',
    items: [
      { label: 'New session', icon: icons.messageSquarePlus, hint: keyHint(mod, 'N'), run: newSession },
      ...(ix ? [{ label: 'New group', icon: icons.folderPlus, run: () => setForm({ kind: 'group', project: view, back: ['.add'] }) }] : []),
    ],
  };

  const addTrigger = opener((button, entry) => pop('add', addMenu, button, { entry }));

  // A moved group leaves the view on screen, so the note says where it went and the focus goes to the group beside it.
  async function moveGroup(g, project) {
    const beside = neighbour(groupsIn(ix, view).map(x => x.id), g.id);
    const to = ix.projects.find(p => p.id === project)?.name ?? 'Home';
    const moved = await change('api/layout/group/move', { id: g.id, project });
    if (moved) say(`Moved “${g.name}” to ${to}.`);
    setBack(moved ? [beside && headOf(beside), '.add'].filter(Boolean) : [headOf(g.id)]);
  }

  async function addProject(name) {
    const { problem, made } = await edit('api/layout/project/add', { name });
    if (!made) return problem || 'Could not add the project.';
    projects.pick(made.id);
    closeForm(scopeOf(made.id), '.new-group', '.add');
    return '';
  }

  async function addGroup(name, project) {
    const made = await change('api/layout/group/add', { name, project });
    if (made) closeForm(headOf(made.id), '.add');
    return !!made;
  }

  // Asks before a project goes, and says what happens to its groups. Cancel has the focus, so Enter does no harm. A view whose project is
  // gone falls back to Home by itself, which closes the sheet and, unlike a pick, leaves a chat under it open. Afterwards the focus goes
  // to the row of the view in use, or to the + button once the sheet has closed. Over a chat the + is hidden, so the sheet gives the
  // focus back to where it was.
  function deleteProject(p) {
    const groups = ix.groups.filter(g => g.project === p.id).length;
    const detail = groups ? `Its ${groups === 1 ? 'group moves' : `${groups} groups move`} to Home. No group or session is deleted.` : 'It has no groups.';
    ask({
      action: 'Delete project',
      title: p.name,
      detail,
      back: () => projects.box.current?.querySelector(scopeOf(p.id)) ?? nav.current.querySelector('.add'),
      run: async () => {
        if (!(await change('api/layout/project/remove', { id: p.id }))) return;
        setBack([scopeOf(view === p.id ? HOME_VIEW : view), '.add']);
      },
    });
  }

  const tree = {
    form,
    shown,
    pop,
    renaming: form?.kind === 'session' ? form.session : null,
    shut: () => setShown(null),
    renamingProject: form?.kind === 'rename' ? form.project : null,
    cancelRename: () => closeForm(scopeOf(form.project)),
    rowMenu: (id, button, entry) => (shown?.session === id && shown.anchor === button && !entry ? setShown(null) : latestMenu.current(id, button, null, entry)),
    newGroup: (p, back) => { projects.pick(p.id); setForm({ kind: 'group', project: p.id, back }); },
    sessionForm: r => html`<${NameForm} label="Rename session" value=${form.sent ?? r.title} action="Save" max=${TITLE_MAX} onCancel=${() => closeForm(rowOf(r.id))} onSubmit=${text => renameRow(r, text)} />`,
    groupMenu: g => {
      const to = moveTargets(ix.projects, g);
      return to.length ? { label: `Move ${g.name}`, items: to.map(t => ({ label: t.label, run: () => moveGroup(g, t.project) })) } : null;
    },
    projectMenu: p => ({
      label: `Actions for ${p.name}`,
      items: [
        { label: 'New group here', icon: icons.folderPlus, run: () => tree.newGroup(p, [scopeOf(p.id), '.add']) },
        { label: 'Rename', icon: icons.pencil, run: () => setForm({ kind: 'rename', project: p.id }) },
        { separator: true },
        { label: 'Delete project', icon: icons.trash, danger: true, run: () => deleteProject(p) },
      ],
    }),
    groupForm: p => html`<${NameForm} label=${`New group in ${p.name}`} action="Create" onSubmit=${name => addGroup(name, p.id)} onCancel=${() => closeForm(...form.back)} />`,
    renameForm: p => html`<${NameForm} label="Rename project" value=${p.name} action="Save" onCancel=${() => closeForm(scopeOf(p.id))}
      onSubmit=${async name => {
        const done = await change('api/layout/project/rename', { id: p.id, name });
        if (done) closeForm(scopeOf(p.id));
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
  <${ProjectsPanel} ix=${ix} projects=${projects} tree=${tree} creating=${form?.kind === 'project'} onNew=${() => setForm({ kind: 'project' })}
    onCancel=${() => closeForm('.new-project')} onCreate=${addProject} />
  <nav class="list" aria-label="Sessions" ref=${nav} onKeyDown=${escapeList}>
    <header class="list-head">
      <${ProjectsToggle} projects=${projects} />
      <div class="brand"><${Shell} class="brand-mark" /><h1>GhostShell</h1><span class="station">${STATION}</span></div>
      <div class="list-actions">
        <button class="btn add" data-variant="ghost" data-size="icon-sm" type="button" aria-label=${addMenu.label} data-tip=${addMenu.label} data-tip-key=${keyHint(mod, 'N')} aria-haspopup="menu" aria-expanded=${shown?.key === 'add'} aria-controls=${shown?.key === 'add' ? layerId(shown.id) : null} data-state=${shown?.key === 'add' ? 'open' : 'closed'} ...${addTrigger}><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        <button class="btn find" data-variant="ghost" data-size="icon-sm" type="button" aria-label="Find a session" data-tip="Find a session" data-tip-key=${keyHint(mod, 'K')} onClick=${onFind}><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12.6 12.6 17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
    </header>
    <p class="problem" id="problem" hidden=${!ix?.problem}>${ix?.problem ? `${ix.problem}.` : ''}</p>
    ${banner}
    ${topForm}
    <div class="sections" id="sections" ref=${box} onDblClick=${renameAt} onClick=${clickRow} onMouseDown=${pressRow} onPointerDown=${e => { pointer.current = e.pointerType; }}>
      ${ix
        ? html`<${Sections} ix=${ix} view=${view} current=${current} collapsed=${collapsed} toggle=${toggle} folded=${folded} toggleFold=${toggleFold} openRoutines=${openRoutines} toggleRoutine=${toggleRoutine} drag=${drag} tree=${tree} picked=${new Set(pick.ids)} newKey=${keyHint(mod, 'N')} />`
        : html`<p class="quiet pad">${error ? `Could not load sessions: ${error}` : 'Loading sessions'}</p>`}
    </div>
    <span class="sr" role="status">${pick.ids.length ? `${pick.ids.length} selected` : ''}</span>
    ${pick.ids.length
      ? html`<div class="pick-bar" role="group" aria-label="Selection">
        <span class="pick-count">${pick.ids.length} selected</span>
        <button class="btn" data-variant="outline" data-size="sm" type="button" onClick=${e => archiveMany(inOrder(pick, drawnIds()), { ring: e.detail === 0 })}>${draw(icons.archive)}Archive</button>
        <button class="btn" data-variant="ghost" data-size="icon-sm" type="button" aria-label="Clear selection" data-tip="Clear selection" onClick=${clearPick}>${draw(icons.x)}</button>
      </div>`
      : null}
    <footer class="list-foot">
      <a class="btn" data-variant="ghost" data-size="sm" href="#/passkeys" aria-current=${passkeys ? 'page' : null}>Passkeys</a>
      <form method="post" action="logout"><button class="btn" data-variant="ghost" data-size="sm" type="submit">Sign out</button></form>
    </footer>
    <${Menu} menu=${shown && !shown.rail ? (shown.key === 'add' ? { ...shown, items: addMenu.items } : shown) : null} onClose=${() => setShown(null)} />
  </nav>
<//>`;
}
