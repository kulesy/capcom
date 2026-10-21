// The projects sidebar, which picks the view the session list shows. From 56rem up it is a column beside the list that stays open
// until it is closed. Below that there is no room beside the list, so it is a level of its own, as the list and the chat are, and
// it takes the list's place while it shows. It is one element at both sizes, so a name half typed in the level survives the window
// growing to 56rem when the column is open there.
import { NameForm } from './forms.js';
import { STATE_LABEL } from './format.js';
import { useLocal, useWide } from './hooks.js';
import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { countOf, EVERY_VIEW, HOME_VIEW, holder, lampOf, NO_VIEW, othersWaiting, viewIn } from './scopes.js';
import { nextStop } from './tree.js';

const PANEL = 'projectsPanel';

// The view in use, kept in this browser as a project id or null for Home, and whether the column is open. The level is plain state
// and never kept, so a phone always starts on the list. It shows only while `listed` says the list's place is on screen, and it ends
// when the route or the view changes, when the list gives way to a chat or a page, and when the window grows wide. Opening the chat at
// `current` switches to the view that has its row, once for each chat. `box` is the panel and `opener` the button that opens it.
export function useProjects(ix, current, hash, listed) {
  const [chosen, choose] = useLocal('scope', null);
  const [docked, setDocked] = useLocal('projectsDocked', false);
  const [level, setLevel] = useState(false);
  const [landing, setLanding] = useState(null);
  const wide = useWide();
  const opener = useRef(null);
  const box = useRef(null);
  const toOpener = useRef(false);
  const revealed = useRef(null);
  const view = ix ? viewIn(ix, chosen) : chosen;
  const open = wide ? docked : level && listed;

  // This runs before the screen is drawn, so a route that hides the list never shows the level beside it. The first list can open a
  // chat with no change of route, so the list giving way closes the level too.
  useLayoutEffect(() => { setLevel(false); }, [hash, view, wide, listed]);

  // Safari does not focus a button that is clicked, so the focus is put on the opener here once the list shows it again.
  useLayoutEffect(() => {
    if (level || !toOpener.current) return;
    toOpener.current = false;
    opener.current?.focus();
  }, [level]);

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

  const closeLevel = (focusOpener = true) => {
    toOpener.current = focusOpener;
    setLevel(false);
  };

  // The search picks a view. The chat on screen counts as looked for, so its row cannot switch the view back, and `landing` has the
  // list put the focus on the view's header once it shows the view. Only a pick moves the focus; revealing a chat never does.
  const show = id => {
    revealed.current = current;
    toOpener.current = false;
    choose(id);
    setLevel(false);
    setLanding({ view: ix ? viewIn(ix, id) : id });
  };

  return {
    view,
    // A view picked by hand counts as looking for the open chat, so a later list cannot switch away from it.
    choose: id => {
      revealed.current = current;
      choose(id);
    },
    wide,
    open,
    box,
    opener,
    landing,
    closeLevel,
    show,
    settle: () => setLanding(null),
    toggle: () => {
      if (wide) setDocked(on => !on);
      else { toOpener.current = false; setLevel(true); }
    },
    elsewhere: !!ix && !open && othersWaiting(ix, view),
  };
}

const sidebar = () => html`<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.25" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.75 4v12" stroke="currentColor" stroke-width="1.6"/></svg>`;

// The button at the left of the list's header. A dot on it says a chat in a view that is not on screen needs you.
export function ProjectsToggle({ projects }) {
  const { open, toggle, opener, elsewhere } = projects;
  return html`<button class="icon-btn projects-toggle" type="button" ref=${opener} aria-label="Projects" title="Projects" aria-expanded=${open}
    aria-controls=${open ? PANEL : null} aria-describedby=${elsewhere ? 'projectsElsewhere' : null} onClick=${toggle}>
    ${sidebar()}
    ${elsewhere ? html`<span class="dot" aria-hidden="true"></span><span class="sr" id="projectsElsewhere">A chat in another view needs you</span>` : null}
  </button>`;
}

function Scope({ home, name, count, lamp, current, onPick }) {
  return html`<li><button class=${home ? 'scope home' : 'scope'} type="button" aria-current=${current ? 'true' : null} onClick=${onPick}>
    <span class="lamp" data-state=${lamp || 'idle'} aria-hidden="true"></span>
    <span class="scope-name">${name}</span>
    ${count === undefined ? null : html`<span class="scope-count">${count}</span>`}
    ${lamp ? html`<span class="sr">, ${STATE_LABEL[lamp]}</span>` : null}
  </button></li>`;
}

const plus = () => html`<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

// `creating` is whether the New project form is open, and the list owns it. `onCreate(name)` resolves with the reason the server
// refused, or an empty string. A panel that closes with the form open cancels it.
export function ProjectsPanel({ ix, projects, creating, onNew, onCancel, onCreate }) {
  const { view, choose, wide, open, box, closeLevel } = projects;
  const [reason, setReason] = useState('');
  const toggle = useRef(null);

  useEffect(() => { if (!open && creating) onCancel(); }, [open, creating]);

  // A level opens with the focus on its toggle, which is where the opener was.
  useLayoutEffect(() => { if (open) toggle.current?.focus(); }, [open]);

  const pick = (e, id) => {
    if (wide) e.currentTarget.focus();
    choose(id);
    if (!wide) closeLevel();
  };
  const begin = () => { setReason(''); onNew(); };
  const create = async name => {
    const problem = await onCreate(name);
    setReason(problem);
    return !problem;
  };

  // The arrows move between the buttons, and start at the view in use when none has the focus. Esc takes a level back to the list. It
  // stops here, so it does not also stop a chat that is running.
  const key = e => {
    if (!wide && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLevel(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('input, textarea, form')) return;
    const stops = [...e.currentTarget.querySelectorAll('.scope, .new-project')];
    const start = Math.max(stops.indexOf(e.currentTarget.querySelector('[aria-current="true"]')), 0);
    const to = nextStop(stops.length, stops.indexOf(document.activeElement), e.key, start);
    if (to >= 0) { e.preventDefault(); stops[to].focus(); }
  };

  if (!open) return null;
  const lamp = id => (ix ? lampOf(ix, id) : null);
  return html`<nav class="rail" id=${PANEL} ref=${box} aria-labelledby="projectsTitle" onKeyDown=${key}>
    <div class="rail-head">
      ${wide ? null : html`<button class="icon-btn projects-toggle" type="button" ref=${toggle} aria-label="Projects" title="Projects" aria-expanded="true" onClick=${() => closeLevel()}>${sidebar()}</button>`}
      <h2 class="rail-title" id="projectsTitle">Projects</h2>
    </div>
    <ul class="scopes">
      <${Scope} key="home" home=${true} name="Home" lamp=${lamp(HOME_VIEW)} current=${view === HOME_VIEW} onPick=${e => pick(e, HOME_VIEW)} />
      <li class="scope-rule" aria-hidden="true"></li>
      ${(ix?.projects || []).map(p => html`<${Scope} key=${p.id} name=${p.name} count=${countOf(ix, p.id)} lamp=${lamp(p.id)} current=${view === p.id} onPick=${e => pick(e, p.id)} />`)}
    </ul>
    ${creating
      ? html`<${NameForm} label="New project" action="Create" onSubmit=${create} onCancel=${onCancel} />`
      : html`<button class="new-project" type="button" disabled=${!ix} onClick=${begin}>${plus()}New project</button>`}
    <div role="status">${creating && reason ? html`<p class="problem">${reason}</p>` : null}</div>
  </nav>`;
}
