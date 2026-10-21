import { counted } from './layer-rules.js';

// What Radix's modal layers, which are shadcn's menus and dialogs, do to the page under them. These are shared, so two layers at once
// lock and unlock it once.

let savedPointer = '';

// The body stops taking the pointer, so a press outside a layer lands on the page itself and not on what lies under it. A layer
// takes the pointer back for itself in CSS.
export const holdPointer = counted(
  () => { savedPointer = document.body.style.pointerEvents; document.body.style.pointerEvents = 'none'; },
  () => { document.body.style.pointerEvents = savedPointer; },
);

export const holdScroll = counted(
  () => document.body.setAttribute('data-scroll-locked', ''),
  () => document.body.removeAttribute('data-scroll-locked'),
);

const hiddenBy = new Map();

// Hides the rest of the page from a screen reader while `content` is open, keeping live regions and the ancestors of both. Returns
// the way to show it again.
export function hideOthers(content) {
  const keep = [content, ...document.querySelectorAll('[aria-live]')];
  const mine = [];
  const walk = parent => {
    for (const child of parent.children) {
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(child.tagName) || keep.includes(child)) continue;
      if (keep.some(k => child.contains(k))) { walk(child); continue; }
      const count = hiddenBy.get(child) ?? 0;
      if (!count && child.getAttribute('aria-hidden') === 'true') continue;
      hiddenBy.set(child, count + 1);
      if (!count) child.setAttribute('aria-hidden', 'true');
      mine.push(child);
    }
  };
  walk(document.body);
  return () => {
    for (const el of mine) {
      const left = hiddenBy.get(el) - 1;
      if (left) hiddenBy.set(el, left);
      else { hiddenBy.delete(el); el.removeAttribute('aria-hidden'); }
    }
  };
}

// The elements inside `root` that a Tab key reaches, in the order it reaches them.
export const tabbables = root => [...root.querySelectorAll('*')].filter(el => (
  el.tabIndex >= 0 && !el.disabled && !el.hidden && el.type !== 'hidden' && !el.closest('[inert]')
  && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'));

// Calls `dismiss(event)` for a press outside, as Radix does: at once for a mouse or a pen, and on the click that follows for a touch,
// which may turn out to be a scroll. `inside(target)` says whether a press belongs to the layer. Returns the way to stop listening.
export function onPressOutside(inside, dismiss) {
  let waiting = null;
  const forget = () => { if (waiting) document.removeEventListener('click', waiting); waiting = null; };
  const press = e => {
    forget();
    if (inside(e.target)) return;
    if (e.pointerType !== 'touch') { dismiss(e); return; }
    waiting = () => { waiting = null; dismiss(e); };
    document.addEventListener('click', waiting, { once: true });
  };
  document.addEventListener('pointerdown', press, true);
  return () => { forget(); document.removeEventListener('pointerdown', press, true); };
}

const stack = [];

// The layers that can be closed with Escape, in the order they opened. Only the last of them answers.
export function enter(layer) {
  stack.push(layer);
  return () => { const at = stack.indexOf(layer); if (at >= 0) stack.splice(at, 1); };
}

export const topmost = layer => stack[stack.length - 1] === layer;
