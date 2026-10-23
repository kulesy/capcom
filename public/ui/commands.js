// The prompt box's / list: asks the server what a chat can run, and draws shadcn's command list in a popover above the box. It asks the
// same way for the models the model menu offers. The box keeps the focus and does the choosing (see composer.js), so the / list only
// shows the choice and takes a click or a tap.
import { api } from './api.js';
import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';

const FRESH_MS = 60_000;
const EDGE = 8;
const asked = new Map();

const keyOf = (what, target) => `${what}:${target.id ? `id:${target.id}` : `cwd:${target.cwd}:${target.account || ''}`}`;

// What the server lists under `what` ('commands' or 'models') for a chat (`{ id }`) or a folder (`{ cwd, account }`), as each account has its own. An answer is reused for a
// minute, and a failed ask is forgotten so the next one asks again.
function load(what, target) {
  const key = keyOf(what, target);
  const now = Date.now();
  for (const [k, entry] of asked) if (now - entry.at >= FRESH_MS) asked.delete(k);
  let entry = asked.get(key);
  if (!entry) {
    const promise = api(`api/${what}`, target).then(answer => {
      if (!Array.isArray(answer[what])) throw new Error(`No ${what} came back.`);
      return answer[what];
    });
    entry = { at: now, promise };
    asked.set(key, entry);
    promise.catch(() => { if (asked.get(key)?.promise === promise) asked.delete(key); });
  }
  return entry.promise;
}

export const loadCommands = target => load('commands', target);
export const loadModels = target => load('models', target);

// The list for `target`, asked for each time `wanted` turns on. The list from the last ask stays until the new one arrives.
function useListed(what, target, wanted) {
  const key = keyOf(what, target);
  const latest = useRef(key);
  latest.current = key;
  const [got, setGot] = useState({ key: null });
  useEffect(() => {
    if (!wanted) return;
    setGot(was => (was.error ? { key: null } : was));
    // NOTE: [22 Oct 2026] EK - Only a changed key drops a reply, never `wanted` turning off. The space after /name does that before
    // the list arrives, and a dropped reply loses the argument hint.
    load(what, target).then(
      list => { if (latest.current === key) setGot({ key, [what]: list }); },
      e => { if (latest.current === key) setGot({ key, error: e.message }); },
    );
  }, [wanted, key]);
  return got.key === key ? got : {};
}

export const useCommands = (target, wanted) => useListed('commands', target, wanted);
export const useModels = (target, wanted) => useListed('models', target, wanted);

// The list scrolls inside the room above the prompt box, which on a phone is what the on-screen keyboard leaves.
function useRoom(box) {
  useLayoutEffect(() => {
    const el = box.current;
    const anchor = el.parentElement;
    const view = window.visualViewport;
    // NOTE: [22 Oct 2026] EK - Measure in page coordinates rather than subtract offsetTop. With the on-screen keyboard up, WebKit on iOS
    // measures a rect from the top of the visual viewport while offsetTop still counts from the layout viewport, which left the list no room.
    const fit = () => {
      const top = anchor.getBoundingClientRect().top + window.scrollY - (view ? view.pageTop : window.scrollY);
      const room = top - EDGE;
      el.style.setProperty('--slash-room', `${Math.max(0, Math.round(room))}px`);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(anchor);
    view?.addEventListener('resize', fit);
    view?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, { passive: true });
    return () => {
      watch.disconnect();
      view?.removeEventListener('resize', fit);
      view?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit);
    };
  }, []);
}

function Item({ command, n, selected, onPick, onMove }) {
  return html`<div id=${`slash-${n}`} data-slot="command-item" cmdk-item="" role="option" aria-selected=${selected} data-selected=${selected} data-value=${command.name}
    onClick=${() => onPick(command)} onPointerMove=${onMove}>
    <span data-part="slash-name">/${command.name}</span>
    ${command.description ? html`<span data-part="slash-description">${command.description}</span>` : null}
  </div>`;
}

// `matches` is null while the commands load or when they could not be loaded, and `error` says why in the second case. `follow` is set
// by a key or typing that moved the choice, because the list scrolls to the choice for those but not for the pointer, which chose what it is over.
export function SlashMenu({ matches, error, at, follow, onPick, onSelect }) {
  const box = useRef(null);
  const pointer = useRef(null);
  useRoom(box);

  useLayoutEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    box.current.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at, matches]);

  const moved = n => e => {
    const was = pointer.current;
    pointer.current = [e.clientX, e.clientY];
    if (was && was[0] === e.clientX && was[1] === e.clientY) return;
    onSelect(n);
  };

  return html`<div class="slash-menu" data-slot="popover-content" data-side="top" data-state="open" ref=${box} onMouseDown=${e => e.preventDefault()}>
    <div data-slot="command">
      <div data-slot="command-list" cmdk-list="" id="slash-list" role="listbox" aria-label="Commands">
        ${matches
          ? html`<div data-slot="command-group" cmdk-group="" role="presentation">
              ${matches.map((command, n) => html`<${Item} key=${command.name} command=${command} n=${n} selected=${n === at} onPick=${onPick} onMove=${moved(n)} />`)}
            </div>`
          : html`<div data-slot="command-empty" cmdk-empty="" role="presentation">
              ${error ? html`<div>Could not load the commands.</div><div class="quiet">${error}</div>` : 'Loading commands'}
            </div>`}
      </div>
    </div>
  </div>`;
}
