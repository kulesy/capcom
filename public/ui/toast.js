// A transient note drawn the way Sonner draws one, which is what shadcn's toast is: at the corner of the screen, with an optional
// action beside the text, and kept while the pointer or the focus is on it. Swiping one away and stacking several are not here,
// because the app shows one note at a time.
import { useStore } from './hooks.js';
import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { createStore } from './store.js';

const toasts = createStore({ list: [] });
const EXIT = 200;
let count = 0;
let back = null;

// The one note a screen shows at a time.
export const NOTE = 'note';

// Shows `text`. A note with an action lasts longer, because its owner needs time to reach the action. A call with the id of a note on
// screen replaces it in place and starts its time again.
export function toast(text, { id = `toast-${++count}`, problem = false, action = null, duration = action ? 10_000 : 6000 } = {}) {
  const next = { id, text, problem, action, duration, stamp: ++count, gone: false };
  toasts.set(({ list }) => {
    const at = list.findIndex(t => t.id === id && !t.gone);
    return { list: at < 0 ? [...list.filter(t => t.id !== id), next] : list.map((t, i) => (i === at ? next : t)) };
  });
  return id;
}

export function dismiss(id) {
  if (!toasts.get().list.some(t => t.id === id && !t.gone)) return;
  toasts.set(({ list }) => ({ list: list.map(t => (t.id === id ? { ...t, gone: true } : t)) }));
  setTimeout(() => toasts.set(({ list }) => ({ list: list.filter(t => !(t.id === id && t.gone)) })), EXIT);
}

// Shows the screen's note, and clears it when there is no text, so a change that went well takes an old note away.
export const say = (text, options) => (text ? toast(text, { ...options, id: NOTE }) : dismiss(NOTE));

const Warning = () => html`<svg data-part="sonner-icon-warning" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>`;

function Toast({ note, front, paused }) {
  const box = useRef(null);
  const [mounted, setMounted] = useState(false);
  const left = useRef(note.duration);
  const seen = useRef(note.stamp);

  // The entry transition needs the toast drawn once before it is marked as mounted.
  useLayoutEffect(() => {
    box.current.getBoundingClientRect();
    setMounted(true);
  }, []);

  // Focus on a toast that goes returns to where it came from, as Sonner does.
  useLayoutEffect(() => () => {
    if (box.current?.contains(document.activeElement)) setTimeout(() => { if (document.activeElement === document.body && back?.isConnected) back.focus(); });
  }, []);

  useEffect(() => {
    if (seen.current !== note.stamp) { seen.current = note.stamp; left.current = note.duration; }
    if (paused || note.gone) return;
    const wait = left.current;
    const began = Date.now();
    const timer = setTimeout(() => dismiss(note.id), wait);
    return () => { clearTimeout(timer); left.current = wait - (Date.now() - began); };
  }, [paused, note.gone, note.stamp]);

  return html`<li ref=${box} tabindex="0" data-sonner-toast="" data-styled="true" data-mounted=${mounted} data-removed=${note.gone} data-visible="true"
    data-front=${front} data-type=${note.problem ? 'warning' : undefined} data-y-position="bottom" data-x-position="right" data-dismissible="true">
    ${note.problem ? html`<div data-icon=""><${Warning} /></div>` : null}
    <div data-content=""><div data-title="">${note.text}</div></div>
    ${note.action ? html`<button type="button" data-button="" data-action="" onClick=${() => { dismiss(note.id); note.action.onClick(); }}>${note.action.label}</button>` : null}
  </li>`;
}

// Alt+T moves the focus to the notes, which also holds their time. The section is always drawn, because a live region has to be there
// before its text is added to be announced.
export function ToastHost() {
  const list = useStore(toasts, s => s.list);
  const section = useRef(null);
  const [near, setNear] = useState({ pointer: false, focus: false });
  const [hidden, setHidden] = useState(document.hidden);

  // A toast that goes while the pointer or focus is on it sends no leave event, so the next one would start held.
  useEffect(() => { if (!list.length) setNear({ pointer: false, focus: false }); }, [list.length]);

  useEffect(() => {
    const onHidden = () => setHidden(document.hidden);
    const onKey = e => { if (e.altKey && e.code === 'KeyT') section.current.querySelector('[data-sonner-toast]')?.focus(); };
    document.addEventListener('visibilitychange', onHidden);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const onFocusIn = e => {
    if (e.relatedTarget && !section.current.contains(e.relatedTarget)) back = e.relatedTarget;
    setNear(n => ({ ...n, focus: true }));
  };
  const onFocusOut = e => { if (!section.current.contains(e.relatedTarget)) setNear(n => ({ ...n, focus: false })); };

  return html`<section ref=${section} aria-label="Notifications alt+T" tabindex="-1" aria-live="polite" aria-relevant="additions text" aria-atomic="false">
    ${list.length
      ? html`<ol data-sonner-toaster="" dir="ltr" tabindex="-1" data-y-position="bottom" data-x-position="right"
          onPointerEnter=${() => setNear(n => ({ ...n, pointer: true }))} onPointerLeave=${() => setNear(n => ({ ...n, pointer: false }))}
          onFocusIn=${onFocusIn} onFocusOut=${onFocusOut}>
          ${list.map((note, i) => html`<${Toast} key=${note.id} note=${note} front=${i === list.length - 1} paused=${near.pointer || near.focus || hidden} />`)}
        </ol>`
      : null}
  </section>`;
}
