import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';

// A menu under the button or row that opened it, or with its top left at `point` ({ x, y }) when a click made it. It is fixed to the
// screen, so the scrolling list cannot clip it. A choice, Esc, a tap outside it, or a scroll that moves its anchor closes it.
// `items` are { label, run, danger }.
export function Menu({ anchor, point = null, label, items, onClose }) {
  const box = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [at, setAt] = useState(null);

  useLayoutEffect(() => {
    const { width, height } = box.current.getBoundingClientRect();
    const keep = (pos, size, room) => Math.max(8, Math.min(pos, room - size - 8));
    let top;
    let left;
    if (point) {
      top = point.y + height + 8 <= window.innerHeight ? point.y : point.y - height;
      left = point.x + width + 8 <= window.innerWidth ? point.x : point.x - width;
    } else {
      const a = anchor.getBoundingClientRect();
      const room = window.innerHeight - a.bottom;
      top = room >= height + 8 || a.top < height + 8 ? a.bottom + 4 : a.top - height - 4;
      left = a.right - width;
    }
    setAt({ top: keep(top, height, window.innerHeight), left: keep(left, width, window.innerWidth) });
  }, []);

  useLayoutEffect(() => { if (at) box.current.querySelector('button').focus({ preventScroll: true }); }, [at]);

  // A list that reloads can scroll without the button moving, so only a scroll that moves the button closes the menu.
  useEffect(() => {
    const start = anchor.getBoundingClientRect();
    const moved = () => { const now = anchor.getBoundingClientRect(); return Math.abs(now.top - start.top) > 1 || Math.abs(now.left - start.left) > 1; };
    const away = () => close.current();
    const toggles = anchor.matches('button');
    const outside = e => { if (box.current && !box.current.contains(e.target) && !(toggles && anchor.contains(e.target))) away(); };
    const scrolled = e => { if (box.current && !box.current.contains(e.target) && moved()) away(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', away);
    };
  }, []);

  function key(e) {
    const buttons = [...box.current.querySelectorAll('button')];
    const go = to => { e.preventDefault(); buttons[(to + buttons.length) % buttons.length].focus(); };
    const here = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); anchor.focus(); close.current(); }
    else if (e.key === 'ArrowDown') go(here + 1);
    else if (e.key === 'ArrowUp') go(here - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(-1);
    else if (e.key === 'Tab') { anchor.focus({ preventScroll: true }); close.current(); }
  }

  return html`<div class="menu" role="menu" aria-label=${label} ref=${box} onKeyDown=${key}
    style=${at ? `top:${at.top}px;left:${at.left}px` : 'top:0;left:0;visibility:hidden'}>
    ${items.map(item => html`<button type="button" role="menuitem" class=${item.danger ? 'danger' : null} onClick=${() => { close.current(); item.run(); }}>${item.label}</button>`)}
  </div>`;
}
