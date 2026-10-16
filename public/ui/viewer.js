// The image viewer: one picture of a chat over the page, with the others a step away. It sits beside the app so the
// app can be made inert while it is open.
import { dataUrlToBlob, isDataUrl, nearestThumb, position, stepIndex, swipeStep, tabTarget } from './gallery.js';
import { useStore } from './hooks.js';
import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { createStore } from './store.js';

const viewer = createStore({ open: null });

// `images` are the chat's pictures as threadImages lists them, `index` the one to show and `from` the element that was clicked.
export const openViewer = (images, index, from) => viewer.set({ open: { images, index, from } });
export const closeViewer = () => viewer.set({ open: null });

const Close = () => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>`;
const NewTab = () => html`<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M8.5 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5v-3M11.5 4H16v4.5M16 4l-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const Prev = () => html`<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M12 4.5 6.5 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
const Next = () => html`<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M8 4.5 13.5 10 8 15.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

const isBackdrop = el => el.dataset?.backdrop !== undefined;

// A thumbnail someone can see. Chromium and WebKit keep the boxes of what a closed details hides, so having a box is not enough.
const isOnScreen = el => !!el?.isConnected && el.getClientRects().length > 0 && !el.closest('details:not([open])');

function Viewer({ images, start, from }) {
  const root = useRef(null);
  const press = useRef({ backdrop: false, swipe: null });
  const [at, setAt] = useState(start);
  const [actual, setActual] = useState(false);
  const [seen, setSeen] = useState({});
  const total = images.length;
  const image = images[at];

  const step = by => setAt(i => stepIndex(i, by, total));

  // Keys are caught before the page behind sees them, so Esc closes this instead of also stopping a running chat.
  // With the app inert, Tab would leave through the browser's own controls, so it is kept moving among ours.
  useLayoutEffect(() => {
    const el = root.current;
    const app = document.getElementById('app');
    const controls = () => [...el.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')];
    const onKey = e => {
      if (e.isComposing) return;
      if (e.altKey || e.ctrlKey || e.metaKey) { e.stopPropagation(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeViewer(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); step(e.key === 'ArrowLeft' ? -1 : 1); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        const list = controls();
        (list[tabTarget(list.length, list.indexOf(document.activeElement), e.shiftKey)] || el).focus();
      }
    };
    const onFocus = e => { if (!el.contains(e.target)) el.focus(); };
    el.focus({ preventScroll: true });
    app?.setAttribute('inert', '');
    app?.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.add('viewing');
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      document.documentElement.classList.remove('viewing');
      app?.removeAttribute('inert');
      app?.removeAttribute('aria-hidden');
      // Focus goes back to where the person clicked, not to the picture they stepped to. If that thumbnail is gone, as
      // when a message still being sent was saved, the one at the same place in the thread takes it, else the nearest.
      const found = [...document.querySelectorAll('[data-image]')];
      const onScreen = found.filter(isOnScreen);
      const thread = [...new Set(found.map(t => t.dataset.image))];
      const near = onScreen[nearestThumb(onScreen.map(t => t.dataset.image), thread, start)];
      (isOnScreen(from) ? from : near || onScreen[onScreen.length - 1])?.focus();
    };
  }, []);

  useEffect(() => {
    for (const near of [images[at - 1], images[at + 1]]) if (near && !isDataUrl(near.src)) new Image().src = near.src;
  }, [at]);

  const mark = state => setSeen(s => (s[image.key] === state ? s : { ...s, [image.key]: state }));
  const status = seen[image.key];

  const openHere = () => {
    const blob = URL.createObjectURL(dataUrlToBlob(image.src));
    window.open(blob, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(blob), 60_000);
  };

  // Only a touch or pen swipe steps, and only at fit-to-screen, where nothing else on the stage scrolls.
  const onDown = e => {
    press.current = { backdrop: isBackdrop(e.target), swipe: e.pointerType !== 'mouse' && e.isPrimary && !actual ? { x: e.clientX, y: e.clientY } : null };
  };
  const onUp = e => {
    const { swipe } = press.current;
    press.current.swipe = null;
    if (swipe) step(swipeStep(e.clientX - swipe.x, e.clientY - swipe.y));
  };
  // A click closes only if it began on the backdrop too, so dragging off the picture and letting go outside does not.
  const onClick = e => { if (press.current.backdrop && isBackdrop(e.target)) closeViewer(); };

  const note = status === 'failed'
    ? html`<p class="viewer-note" role="alert">This image could not be loaded.</p>`
    : status ? null : html`<p class="viewer-note">Loading</p>`;

  return html`<div class="viewer" ref=${root} role="dialog" aria-modal="true" aria-label="Image viewer" tabindex="-1" data-backdrop
      onPointerDown=${onDown} onPointerUp=${onUp} onPointerCancel=${() => { press.current.swipe = null; }} onClick=${onClick}>
    <div class="viewer-bar" data-backdrop>
      <button class="icon-btn viewer-fit" type="button" onClick=${() => setActual(a => !a)}>${actual ? 'Fit to screen' : 'Actual size'}</button>
      ${isDataUrl(image.src)
        ? html`<button class="icon-btn" type="button" aria-label="Open in new tab" title="Open in new tab" onClick=${openHere}><${NewTab} /></button>`
        : html`<a class="icon-btn" href=${image.src} target="_blank" rel="noopener" aria-label="Open in new tab" title="Open in new tab"><${NewTab} /></a>`}
      <button class="icon-btn" type="button" aria-label="Close" title="Close (Esc)" onClick=${closeViewer}><${Close} /></button>
    </div>
    <div class="viewer-stage" data-backdrop data-size=${actual ? 'actual' : 'fit'} tabindex=${actual ? 0 : undefined} role=${actual ? 'group' : undefined} aria-label=${actual ? 'Image at actual size' : undefined}>
      <img class="viewer-img" key=${image.key} src=${image.src} alt=${image.alt} draggable=${false} data-state=${status || 'loading'}
        onLoad=${() => mark('ready')} onError=${() => mark('failed')} />
      ${note}
    </div>
    ${total > 1 ? html`<div class="viewer-pager" data-backdrop>
      <button class="icon-btn" type="button" aria-label="Previous image" title="Previous (←)" disabled=${at === 0} onClick=${() => step(-1)}><${Prev} /></button>
      <p class="viewer-count" aria-live="polite" aria-atomic="true">${position(at, total)}</p>
      <button class="icon-btn" type="button" aria-label="Next image" title="Next (→)" disabled=${at === total - 1} onClick=${() => step(1)}><${Next} /></button>
    </div>` : null}
  </div>`;
}

export function ViewerHost() {
  const open = useStore(viewer, s => s.open);
  return open ? html`<${Viewer} key=${open} images=${open.images} start=${open.index} from=${open.from} />` : null;
}
