// The projects sidebar, which picks the view the session list shows. From 56rem up it is a column beside the list that stays open
// until it is closed. Below that there is no room beside the list, so it is shadcn's mobile sidebar: a sheet that slides in over the
// page, on the dialog layer, and closes when a view is picked.
import { Dialog } from './dialog.js';
import { NameForm } from './forms.js';
import { STATE_LABEL } from './format.js';
import { useLocal, useModifier, useWide } from './hooks.js';
import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { countOf, EVERY_VIEW, HOME_VIEW, holder, lampOf, NO_VIEW, othersWaiting, viewIn } from './scopes.js';
import { keyHint } from './shortcuts.js';
import { nextStop } from './tree.js';

const PANEL = 'projectsPanel';

// The view in use, kept in this browser as a project id or null for Home, and whether the column is open. The sheet is plain state
// and never stored, so a phone always starts with it shut. It opens over whatever is on screen, a chat included, and it ends when the
// route or the view changes and when the window grows wide. Opening the chat at `current` switches to the view that has its row, once
// for each chat. `box` is the panel and `opener` the button that opens it. `toList()` puts the list on screen, for a view picked
// where a chat has the screen.
export function useProjects(ix, current, hash, toList) {
  const [chosen, choose] = useLocal('scope', null);
  const [docked, setDocked] = useLocal('projectsDocked', false);
  const [sheet, setSheet] = useState(false);
  const [landing, setLanding] = useState(null);
  const wide = useWide();
  const opener = useRef(null);
  const box = useRef(null);
  const revealed = useRef(null);
  const view = ix ? viewIn(ix, chosen) : chosen;
  const open = wide ? docked : sheet;

  // This runs before the screen is drawn, so a route that hides the list never shows the sheet over it.
  useLayoutEffect(() => { setSheet(false); }, [hash, view, wide]);

  // A new chat's row arrives a little after its route, so this waits for the row. A pinned row is in every view, so it never switches.
  // Once a chat has been looked for, a later list does not switch the view again, or a list refresh would undo a view picked by hand.
  useEffect(() => {
    if (!current) { revealed.current = null; return; }
    if (!ix || revealed.current === current) return;
    const held = holder(ix, current);
    if (held === NO_VIEW) return;
    revealed.current = current;
    if (held !== EVERY_VIEW && held !== view) choose(held);
  }, [ix, current]);

  // A view picked by hand counts as looking for the open chat, so a later list cannot switch away from it. In the sheet the pick
  // also shuts the sheet and puts the list on screen.
  const pick = id => {
    revealed.current = current;
    choose(id);
    if (wide) return;
    toList();
    setSheet(false);
  };

  // The search picks a view. The chat on screen counts as looked for, so its row cannot switch the view back, and `landing` has the
  // list put the focus on the view's header once it shows the view. Only a pick moves the focus; revealing a chat never does.
  const show = id => {
    revealed.current = current;
    choose(id);
    if (!wide) { toList(); setSheet(false); }
    setLanding({ view: ix ? viewIn(ix, id) : id });
  };

  const toggle = () => {
    if (wide) setDocked(on => !on);
    else setSheet(on => !on);
  };

  return {
    view,
    pick,
    wide,
    open,
    box,
    opener,
    landing,
    show,
    close: () => setSheet(false),
    settle: () => setLanding(null),
    toggle,
    // Ctrl+B or Cmd+B. The column leaves the focus where it is, unless the focus is in the column as it closes, when it goes to the
    // button that opens it. The sheet opens and closes as its button does.
    flip: () => {
      if (wide && docked && box.current?.contains(document.activeElement)) opener.current?.focus();
      toggle();
    },
    elsewhere: !!ix && !open && othersWaiting(ix, view),
  };
}

const sidebar = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.25" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.75 4v12" stroke="currentColor" stroke-width="1.6"/></svg>`;

// The button at the left of the list's header. A dot on it says a chat in a view that is not on screen needs you.
export function ProjectsToggle({ projects }) {
  const { open, toggle, opener, elsewhere, wide } = projects;
  const mod = useModifier();
  return html`<button class="btn projects-toggle" data-variant="ghost" data-size="icon-sm" type="button" ref=${opener} aria-label="Projects" data-tip="Projects" data-tip-key=${keyHint(mod, 'B')}
    aria-haspopup=${wide ? null : 'dialog'} aria-expanded=${open} aria-controls=${open ? PANEL : null} aria-describedby=${elsewhere ? 'projectsElsewhere' : null} onClick=${toggle}>
    ${sidebar()}
    ${elsewhere ? html`<span class="dot" aria-hidden="true"></span><span class="sr" id="projectsElsewhere">A chat in another view needs you</span>` : null}
  </button>`;
}

function Scope({ home, name, count, lamp, current, onPick }) {
  return html`<li><button class=${home ? 'scope home' : 'scope'} type="button" aria-current=${current ? 'true' : null} onClick=${onPick}>
    <span class="lamp" data-state=${lamp || 'idle'} aria-hidden="true"></span>
    <span class="scope-name">${name}</span>
    ${count === undefined ? null : html`<span class="badge scope-count">${count}</span>`}
    ${lamp ? html`<span class="sr">, ${STATE_LABEL[lamp]}</span>` : null}
  </button></li>`;
}

const plus = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

// `creating` is whether the New project form is open, and the list owns it. `onCreate(name)` resolves with the reason the server
// refused, or an empty string. A panel that closes with the form open cancels it.
export function ProjectsPanel({ ix, projects, creating, onNew, onCancel, onCreate }) {
  const { view, wide, open, box, opener, pick, close } = projects;
  const [reason, setReason] = useState('');
  const toggle = useRef(null);
  const mod = useModifier();

  useEffect(() => { if (!open && creating) onCancel(); }, [open, creating]);

  const choosing = (e, id) => {
    if (wide) e.currentTarget.focus();
    pick(id);
  };
  const begin = () => { setReason(''); onNew(); };
  const create = async name => {
    const problem = await onCreate(name);
    setReason(problem);
    return !problem;
  };

  // The arrows move between the buttons, and start at the view in use when none has the focus.
  const key = e => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('input, textarea, form')) return;
    const stops = [...e.currentTarget.querySelectorAll('.scope, .new-project')];
    const start = Math.max(stops.indexOf(e.currentTarget.querySelector('[aria-current="true"]')), 0);
    const to = nextStop(stops.length, stops.indexOf(document.activeElement), e.key, start);
    if (to >= 0) { e.preventDefault(); stops[to].focus(); }
  };

  const lamp = id => (ix ? lampOf(ix, id) : null);
  const panel = html`<nav class="rail" id=${PANEL} ref=${box} aria-labelledby="projectsTitle" onKeyDown=${key}>
    <div class="rail-head">
      ${wide ? null : html`<button class="btn projects-toggle" data-variant="ghost" data-size="icon-sm" type="button" ref=${toggle} aria-label="Projects" data-tip="Projects" data-tip-key=${keyHint(mod, 'B')} aria-expanded="true" onClick=${close}>${sidebar()}</button>`}
      <h2 class="rail-title" id="projectsTitle">Projects</h2>
    </div>
    <ul class="scopes">
      <${Scope} key="home" home=${true} name="Home" lamp=${lamp(HOME_VIEW)} current=${view === HOME_VIEW} onPick=${e => choosing(e, HOME_VIEW)} />
      <li class="scope-rule" aria-hidden="true"></li>
      ${(ix?.projects || []).map(p => html`<${Scope} key=${p.id} name=${p.name} count=${countOf(ix, p.id)} lamp=${lamp(p.id)} current=${view === p.id} onPick=${e => choosing(e, p.id)} />`)}
      <li>${creating
        ? html`<${NameForm} label="New project" action="Create" onSubmit=${create} onCancel=${onCancel} />`
        : html`<button class="scope new-project" type="button" disabled=${!ix} onClick=${begin}>${plus()}<span class="scope-name">New project</span></button>`}</li>
    </ul>
    <div role="status">${creating && reason ? html`<p class="problem">${reason}</p>` : null}</div>
  </nav>`;
  if (wide) return open ? panel : null;

  // Esc leaves a half typed project name first, as it does in the column, and then the sheet. The focus goes back to the button that
  // opened the sheet when that is on screen, and otherwise to where it was when the sheet opened, as over a chat.
  const dismiss = why => (why === 'escape' && creating ? onCancel() : close());
  const opened = () => (opener.current?.getClientRects().length ? opener.current : null);
  return html`<${Dialog} open=${open} sheet="left" labelledBy="projectsTitle" initial=${toggle} restoreTo=${opened} onClose=${dismiss}>${panel}<//>`;
}
