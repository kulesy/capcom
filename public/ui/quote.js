// Quoting the text selected in a chat's transcript: a Quote button beside the selection, or above the prompt box on a touch screen, where the
// system draws its own menu beside the selection, and Cmd+' or Ctrl+'. The text itself is cleaned in quote-rules.js.
import { addQuote } from './draft.js';
import { useModifier, useStore } from './hooks.js';
import { html, useEffect, useLayoutEffect, useMemo, useRef } from './html.js';
import { draw, icons } from './menu.js';
import { placeButton, quoteText } from './quote-rules.js';
import { keyHint, shortcut } from './shortcuts.js';
import { createStore } from './store.js';

// How long a selection holds still before the button follows it, so dragging a handle or the arrow keys do not make it flicker.
const SETTLE = 150;
// What a copy of the selection drops: a code block's buttons and language label, what a screen reader skips, and what would load again.
// A sent quote is a button that holds words, so it stays.
const LEFT_OUT = 'button:not(.quoted), .code-head, .sr, [aria-hidden="true"], iframe, img, video';

// The selected text as the page shows it. A copy of the selected nodes is laid out off screen inside the transcript, so innerText breaks the
// lines between blocks as the browser would when copying.
function textIn(range, box) {
  const probe = document.createElement('div');
  probe.className = 'quote-probe';
  probe.append(range.cloneContents());
  probe.querySelectorAll(LEFT_OUT).forEach(el => el.remove());
  box.append(probe);
  const raw = probe.innerText;
  probe.remove();
  return quoteText(raw);
}

// The selection when it lies inside the transcript and holds text, with that text.
function selectionIn(box) {
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!box.contains(range.commonAncestorContainer)) return null;
  const text = textIn(range, box);
  return text ? { range, text } : null;
}

// Where the selection's first and last lines are, and the part of the transcript on show, in the window's coordinates.
function whereIs(range, box) {
  const lines = [...range.getClientRects()].filter(r => r.width || r.height);
  if (!lines.length) return null;
  const at = box.getBoundingClientRect();
  const left = at.left + box.clientLeft;
  const top = at.top + box.clientTop;
  const [first, last] = [lines[0], lines[lines.length - 1]];
  return {
    first: { left: first.left, top: first.top },
    last: { right: last.right, bottom: last.bottom },
    view: { left, right: left + box.clientWidth, top, bottom: top + box.clientHeight },
  };
}

// Adds the text to the prompt box as a quote, clears the selection and puts the cursor at the end of the box's text.
function takeQuote(ctrl, quoting, text) {
  addQuote(text, { id: ctrl.id, title: ctrl.store.get().session?.title ?? null });
  document.getSelection().removeAllRanges();
  quoting.set({ pending: null });
  const area = document.getElementById('text');
  if (!area) return;
  area.focus({ preventScroll: true });
  area.setSelectionRange(area.value.length, area.value.length);
}

// Watches the selection in the transcript inside `pane` and returns the store the buttons draw from. `pending` is the quote on offer,
// { text, where }, with `where` null on a touch screen. The text is read when the button shows, because a tap can collapse the selection first.
export function useQuoting(ctrl, pane) {
  const quoting = useMemo(() => createStore({ pending: null }), []);
  useEffect(() => {
    if (ctrl.draft) return undefined;
    const box = pane.current.querySelector('.transcript');
    let timer = 0;
    let dragging = false;
    const hide = () => { if (quoting.get().pending) quoting.set({ pending: null }); };
    const settle = () => {
      const found = dragging ? null : selectionIn(box);
      if (!found) { hide(); return; }
      quoting.set({ pending: { text: found.text, where: matchMedia('(pointer: fine)').matches ? whereIs(found.range, box) : null } });
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(settle, SETTLE);
    };
    // A mouse drag is still choosing the selection, so the button waits for the release. The button's own press is not a drag.
    const press = e => {
      const down = e.pointerType !== 'touch' && e.buttons === 1 && !e.target.closest?.('.quote-pick');
      if (down === dragging) return;
      dragging = down;
      if (!down) later();
    };
    const onKey = e => {
      if (shortcut(e) !== 'quote') return;
      const found = selectionIn(box);
      if (!found) return;
      e.preventDefault();
      takeQuote(ctrl, quoting, found.text);
    };
    const resized = new ResizeObserver(later);
    resized.observe(box);
    resized.observe(box.querySelector('#items'));
    const on = { selectionchange: later, pointerdown: press, pointermove: press, pointerup: press, pointercancel: press, keydown: onKey };
    for (const [type, fn] of Object.entries(on)) document.addEventListener(type, fn, true);
    window.addEventListener('resize', later);
    return () => {
      for (const [type, fn] of Object.entries(on)) document.removeEventListener(type, fn, true);
      window.removeEventListener('resize', later);
      resized.disconnect();
      clearTimeout(timer);
      hide();
    };
  }, [ctrl]);
  return quoting;
}

// A press on the button must not take the selection from the text.
function QuoteButton({ ctrl, quoting, text, buttonRef, dock }) {
  const mod = useModifier();
  const keep = e => e.preventDefault();
  // WebKit drops the click that follows a cancelled touch pointerdown. The text is already read, so a tap may collapse the selection.
  const keepFromMouse = e => { if (e.pointerType !== 'touch') e.preventDefault(); };
  return html`<button class="btn quote-pick" type="button" data-variant="outline" data-size="sm" data-dock=${dock ? '' : undefined} ref=${buttonRef}
    data-tip="Add to your message" data-tip-key=${keyHint(mod, "'")} onPointerDown=${keepFromMouse} onMouseDown=${keep} onClick=${() => takeQuote(ctrl, quoting, text)}>${draw(icons.quote, 'icon')}Quote</button>`;
}

// The button beside the selection, drawn inside the transcript so it scrolls with the text.
export function QuoteFloat({ ctrl, quoting }) {
  const pending = useStore(quoting, s => s.pending);
  const button = useRef(null);
  const where = pending?.where;
  // Measured from where the button sits at 0, 0, so the transcript's borders and scrollbar gutter need no sums.
  useLayoutEffect(() => {
    if (!where) return;
    const el = button.current;
    el.style.left = '0px';
    el.style.top = '0px';
    const origin = el.getBoundingClientRect();
    const spot = placeButton(where, origin);
    el.style.left = `${Math.round(spot.left - origin.left)}px`;
    el.style.top = `${Math.round(spot.top - origin.top)}px`;
  }, [pending]);
  return where ? html`<${QuoteButton} ctrl=${ctrl} quoting=${quoting} text=${pending.text} buttonRef=${button} />` : null;
}

// The button above the prompt box, clear of the menu a touch screen draws beside its selection.
export function QuoteDock({ ctrl, quoting }) {
  const pending = useStore(quoting, s => s.pending);
  return pending && !pending.where ? html`<${QuoteButton} ctrl=${ctrl} quoting=${quoting} text=${pending.text} dock=${true} />` : null;
}
