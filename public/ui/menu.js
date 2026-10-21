import { html, useEffect, useLayoutEffect, useRef, useState } from './html.js';

// A menu under the button or row that opened it, or with its top left at `point` ({ x, y }) when a click made it. It is fixed to the
// screen, so the scrolling list cannot clip it. A choice, Esc, a tap outside it, or a scroll that moves its anchor closes it.
// `items` are { label, run, danger, hint, more, back }, or { group, items } for items under a heading, and the arrows walk them across
// groups. `hint` names a key that does the same. An item with `more` opens another menu, so it shows a chevron and the right arrow
// chooses it. That menu starts with the same item marked `back`, which shows it open and goes back when chosen, as the left arrow
// does through `onBack`. `start` is the index of the item that takes the focus when the menu opens.
export function Menu({ anchor, point = null, label, items, onClose, onBack = null, start = 0 }) {
  const box = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [at, setAt] = useState(null);

  useLayoutEffect(() => {
    // A reload can take away the row a menu was opened on, and a menu with no anchor has nowhere to sit or send the focus back to.
    if (!anchor.isConnected) { close.current(); return; }
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

  useLayoutEffect(() => { if (at) box.current.querySelectorAll('button')[start]?.focus({ preventScroll: true }); }, [at]);

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
    else if (e.key === 'ArrowRight' && buttons[here]?.matches('[aria-haspopup="menu"]')) { e.preventDefault(); buttons[here].click(); }
    else if (e.key === 'ArrowLeft' && onBack) { e.preventDefault(); onBack(); }
    else if (e.key === 'Tab') { anchor.focus({ preventScroll: true }); close.current(); }
  }

  const choice = item => html`<button type="button" role="menuitem" class=${item.danger ? 'danger' : item.back ? 'menu-back' : null}
    aria-haspopup=${item.more ? 'menu' : null} aria-expanded=${item.more ? 'false' : item.back ? 'true' : null}
    onClick=${() => { close.current(); item.run(); }}>${item.label}${item.hint ? html`<kbd>${item.hint}</kbd>` : null}</button>`;

  return html`<div class="menu" role="menu" aria-label=${label} ref=${box} onKeyDown=${key}
    style=${at ? `top:${at.top}px;left:${at.left}px` : 'top:0;left:0;visibility:hidden'}>
    ${items.map(item => (item.group
      ? html`<div role="group" aria-label=${item.group}><span class="menu-heading" aria-hidden="true">${item.group}</span>${item.items.map(choice)}</div>`
      : choice(item)))}
  </div>`;
}
