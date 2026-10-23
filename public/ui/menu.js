import { pointIn } from './drag.js';
import { Fragment, html, useEffect, useLayoutEffect, useRef, useState } from './html.js';
import { enter, holdPointer, onPressOutside, topmost } from './layer.js';
import { isSecondary } from './layer-rules.js';
import { graceArea, inside, keyedItem, nextMatch, place, roleOf, stepIn } from './menu-rules.js';
import { usePresence } from './presence.js';
import { shortcut } from './shortcuts.js';

// shadcn's dropdown and context menus, which are Radix's, and modal as they are: the page under an open menu takes no press.
// `items` are { label, run, icon, hint, danger, disabled }, { separator: true }, { group, items } for items under a heading, or
// { label, icon, items } for an item that opens a sub-menu. `hint` names the key that does the same. A group with `heading: false` keeps
// its name for assistive technology and draws none. An item can also have:
// `checked` (true or false) to be a radio item, which draws a check in place of its hint when true; `switch` (true or false) to be a switch;
// `value` for muted text at the right; `warn` for a warning icon there; `key`, one character that picks the item while this menu has the
// focus, ahead of typing to find an item; `tip`, the words of a tooltip; and `id`, which keeps the focus on the item when the items
// before it change, as they do when the CLI's models arrive.

// Whether the last input was a key. A menu opened by a key lights its first item, and one opened by a pointer lights none.
let keyboard = false;
document.addEventListener('keydown', () => { keyboard = true; }, true);
document.addEventListener('pointerdown', () => { keyboard = false; }, true);
document.addEventListener('pointermove', () => { keyboard = false; }, true);

// Lucide's 24px outlines, as the paths shadcn's menus draw.
export const icons = {
  pencil: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z', 'm15 5 4 4'],
  folderInput: ['M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1', 'M2 13h10', 'm9 16 3-3-3-3'],
  archive: ['M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', 'M10 12h4'],
  messageSquarePlus: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', 'M12 7v6', 'M9 10h6'],
  folderPlus: ['M12 10v6', 'M9 13h6', 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
  trash: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  indentIncrease: ['M21 12H11', 'M21 18H11', 'M21 6H11', 'm3 8 4 4-4 4'],
  indentDecrease: ['M21 12H11', 'M21 18H11', 'M21 6H11', 'm7 8-4 4 4 4'],
  check: ['M20 6 9 17l-5-5'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  squareCheck: ['M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.5', 'm9 11 3 3L22 4'],
  triangleAlert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
};

export const draw = (paths, className) => html`<svg class=${className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths.map(d => html`<path d=${d} />`)}</svg>`;

// The id of a menu's element, which the button that opened it names in aria-controls. `path` names a sub-menu: 2.0 is the first item
// of the third item's menu.
export const layerId = (menu, path = '') => `menu-${menu}${path ? `-${path.replace(/\./g, '-')}` : ''}`;

// Where each kind of layer sits against what opened it: a sub-menu beside its item, a context menu beside the pointer, a dropdown
// under its button.
const RULES = {
  sub: { side: 'right', align: 'start', offset: 0 },
  point: { side: 'right', align: 'start', offset: 2 },
  button: { side: 'bottom', align: 'end', offset: 4 },
};

const rectOf = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });

// Whether something the menu is drawn in is animating, such as the sheet while it slides in. An animation that has ended but holds its
// last frame, or one that follows a scroll, does not count, or the menu would follow it for as long as it is open.
const animating = el => {
  for (let up = el.parentElement; up; up = up.parentElement) if (up.getAnimations().some(a => a.playState === 'running' && a.timeline === document.timeline)) return true;
  return false;
};

function Layer({ open, onGone, ...rest }) {
  const box = useRef(null);
  const present = usePresence(open, box, onGone);
  return present ? html`<${Panel} box=${box} open=${open} ...${rest} />` : null;
}

// One menu: its items, and beside it the sub-menu of the item that opens one, which is a layer of its own so the scrolling and
// clipping of this one cannot cut it off. `root` holds what the layers share.
function Panel({ root, box, items, path, open, label, labelledBy, trigger, entry, back }) {
  const id = layerId(root.id, path);
  const flat = items.flatMap(it => (it.group ? it.items : it.separator ? [] : [it]));
  const [at, setAt] = useState(null);
  const [sub, setSub] = useState(null);
  const rows = useRef([]);
  const size = useRef(null);
  const typed = useRef({ text: '', timer: 0 });
  const wait = useRef(0);
  const pressed = useRef(null);
  const placed = at !== null;
  const subPath = n => (path ? `${path}.${n}` : String(n));
  const enabled = () => [...box.current.querySelectorAll('[role^="menuitem"]:not([data-disabled])')];
  const lit = el => { if (el && document.activeElement !== el) el.focus({ preventScroll: true }); };
  // focus() alone would put an item that was out of view in the middle of the menu, so the menu scrolls only as far as its nearest
  // edge. The first item of a group brings the group's label with it, as the search does with its headings.
  const reach = el => {
    el.focus({ preventScroll: true });
    const group = el.closest('[role="group"]');
    if (group?.querySelector('[role^="menuitem"]:not([data-disabled])') === el) group.querySelector('.menu-label')?.scrollIntoView({ block: 'nearest' });
    el.scrollIntoView({ block: 'nearest' });
  };
  const openSub = (n, which = null) => setSub({ at: n, entry: which && { which } });

  const lay = () => {
    const from = trigger ? trigger() : root.anchor;
    const anchor = !trigger && root.point ? { x: root.point.x, y: root.point.y, width: 0, height: 0 } : rectOf(from.getBoundingClientRect());
    const v = window.visualViewport;
    const view = v ? { x: v.offsetLeft, y: v.offsetTop, width: v.width, height: v.height } : { width: innerWidth, height: innerHeight };
    const kind = trigger ? 'sub' : root.point ? 'point' : 'button';
    const at = place({ anchor, size: size.current, view, pad: 8, dpr: window.devicePixelRatio || 1, ...RULES[kind] });
    // A transformed ancestor, such as the sheet while it slides in, is the containing block of a fixed menu, so its left and top count
    // from that block's corner and not the window's. A probe beside the menu finds the corner.
    const probe = document.createElement('div');
    probe.style.cssText = `position:${getComputedStyle(box.current).position};left:0;top:0;width:0;height:0;margin:0;visibility:hidden`;
    box.current.after(probe);
    const corner = probe.getBoundingClientRect();
    probe.remove();
    return { ...at, x: at.x - corner.x, y: at.y - corner.y };
  };

  // A reload can take away the row or button a menu was opened from, and a menu with nothing to hang from has nowhere to sit.
  useLayoutEffect(() => {
    if (!(trigger ? trigger() : root.anchor)?.isConnected) { root.shut(false); return; }
    const r = box.current.getBoundingClientRect();
    size.current = { width: r.width, height: r.height };
    setAt(lay());
  }, []);

  const again = () => {
    const next = lay();
    setAt(now => (now && now.x === next.x && now.y === next.y && now.room === next.room && now.side === next.side ? now : next));
  };

  // The + menu grows when the list arrives, and a menu taller than its room is cut to it, so a change of size places it again.
  useEffect(() => {
    const watch = new ResizeObserver(([e]) => {
      // A menu that has just been removed reports a size of 0 before this observer is disconnected.
      if (!e.target.isConnected) return;
      const b = e.borderBoxSize?.[0] ?? { inlineSize: e.contentRect.width, blockSize: e.contentRect.height };
      const was = size.current;
      if (!was || (Math.abs(was.width - b.inlineSize) < 0.01 && Math.abs(was.height - b.blockSize) < 0.01)) return;
      size.current = { width: b.inlineSize, height: b.blockSize };
      again();
    });
    watch.observe(box.current);
    return () => watch.disconnect();
  }, []);

  // A menu opened while the sheet slides in is kept inside the window from where the sheet is at that moment, and the slide then carries
  // it too far, so it is placed again on each frame until the slide is over.
  useEffect(() => {
    let frame = 0;
    const follow = () => {
      again();
      if (animating(box.current)) frame = requestAnimationFrame(follow);
    };
    if (animating(box.current)) frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, []);

  // The menu takes the focus once it is in place. A key, or an arrow on the + button, lights the first or last item as well. A
  // sub-menu opened by the pointer leaves the focus on its item.
  useLayoutEffect(() => {
    if (!open || !placed) return;
    const which = entry?.which ?? (!trigger && keyboard ? 'first' : null);
    if (!trigger) box.current.focus({ preventScroll: true });
    if (!which) return;
    const list = enabled();
    list[which === 'last' ? list.length - 1 : 0]?.focus();
  }, [open, placed, entry]);

  // Focus that lands anywhere but on the open sub-menu or its item closes it, as the pointer moving on to another item does.
  useEffect(() => {
    if (!sub) return;
    const base = subPath(sub.at);
    const away = e => {
      const layer = e.target.closest?.(`.menu[data-menu-id="${root.id}"]`);
      if (layer && (layer.dataset.path === base || layer.dataset.path.startsWith(`${base}.`))) return;
      if (e.target !== rows.current[sub.at]) setSub(null);
    };
    document.addEventListener('focusin', away);
    return () => document.removeEventListener('focusin', away);
  }, [sub?.at]);

  useEffect(() => () => { clearTimeout(typed.current.timer); clearTimeout(wait.current); }, []);

  function key(e) {
    const list = enabled();
    const here = list.indexOf(document.activeElement);
    const asked = shortcut(e);
    // The key goes on to do its job, which can move the list from under a menu fixed to the screen. Cmd+A is left to the list, which
    // reads the open menu for the row to archive and closes it when there is one.
    if (asked) { if (asked !== 'archive') root.shut(true); return; }
    if (e.key === 'Tab') { e.preventDefault(); return; }
    const opens = list[here]?.hasAttribute('aria-haspopup');
    const typing = typed.current.text !== '';
    if (e.key === 'Enter' || (e.key === ' ' && !typing)) {
      e.preventDefault();
      if (opens) openSub(Number(list[here].dataset.at), 'first');
      else list[here]?.click();
      return;
    }
    if (e.key === 'ArrowRight' && opens) { e.preventDefault(); openSub(Number(list[here].dataset.at), 'first'); return; }
    if (e.key === 'ArrowLeft' && back) { e.preventDefault(); back(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!e.shiftKey) {
      const to = stepIn(list.length, here, e.key);
      if (to >= 0) { e.preventDefault(); reach(list[to]); return; }
    }
    if (e.key.length !== 1) return;
    const keyed = keyedItem(flat, e.key);
    if (keyed >= 0) { e.preventDefault(); root.pick(flat[keyed]); return; }
    const t = typed.current;
    clearTimeout(t.timer);
    t.text += e.key;
    t.timer = setTimeout(() => { t.text = ''; }, 1000);
    if (e.key === ' ') e.preventDefault();
    const hit = nextMatch(list.map(el => el.querySelector('.menu-text').textContent.trim()), t.text, here);
    if (hit >= 0) reach(list[hit]);
  }

  const toward = e => !!root.grace && root.dir === root.grace.side && inside({ x: e.clientX, y: e.clientY }, root.grace.area);

  function leave(e, el, n) {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(wait.current);
    wait.current = 0;
    if (sub?.at === n) {
      const subEl = document.getElementById(layerId(root.id, subPath(n)));
      if (subEl) {
        const side = subEl.dataset.side;
        root.grace = { area: graceArea({ x: e.clientX, y: e.clientY }, subEl.getBoundingClientRect(), side), side };
        clearTimeout(root.timer);
        root.timer = setTimeout(() => { root.grace = null; }, 300);
      } else root.grace = null;
    }
    // A pointer that jumps from one layer straight into another has not left the menu, and the item it lands on takes the focus.
    const into = e.relatedTarget?.closest?.(`.menu[data-menu-id="${root.id}"]`);
    if (toward(e) || (into && into !== box.current)) return;
    box.current.focus({ preventScroll: true });
  }

  function hover(e, def, el, n) {
    if (e.pointerType !== 'mouse') return;
    if (def.disabled) { leave(e, el, n); return; }
    if (toward(e)) return;
    lit(el);
    if (def.items && sub?.at !== n && !wait.current) {
      root.grace = null;
      wait.current = setTimeout(() => { wait.current = 0; openSub(n); }, 100);
    }
  }

  // A press that began on the button that opened the menu, or on another item, and ends on an item picks it, as Radix's items do.
  function release(e, def) {
    const started = pressed.current;
    pressed.current = null;
    if (started !== e.currentTarget && e.pointerType === 'mouse' && e.button === 0 && !def.disabled) e.currentTarget.click();
  }

  function pick(def, el, n) {
    if (def.disabled) return;
    if (!def.items) { root.pick(def); return; }
    lit(el);
    if (sub?.at !== n) openSub(n);
  }

  const row = def => {
    const n = flat.indexOf(def);
    const opens = !!def.items;
    const shown = opens && open && sub?.at === n;
    const { role, checked } = roleOf(def);
    return html`<div key=${def.id ?? n} class="menu-item" role=${role} aria-checked=${checked} tabindex="-1" id=${`${id}-item-${n}`} data-at=${n} data-tip=${def.tip || null}
      data-variant=${def.danger ? 'destructive' : null} data-disabled=${def.disabled ? '' : null} aria-disabled=${def.disabled ? 'true' : null}
      data-state=${opens ? (shown ? 'open' : 'closed') : null} aria-haspopup=${opens ? 'menu' : null} aria-expanded=${opens ? shown : null}
      aria-controls=${opens ? layerId(root.id, subPath(n)) : null} ref=${el => { rows.current[n] = el; }}
      onClick=${e => pick(def, e.currentTarget, n)} onPointerDown=${e => { pressed.current = e.currentTarget; }} onPointerUp=${e => release(e, def)}
      onPointerMove=${e => hover(e, def, e.currentTarget, n)} onPointerLeave=${e => leave(e, e.currentTarget, n)}>
      ${def.icon ? draw(def.icon) : null}<span class="menu-text">${def.label}</span>${def.value ? html`<span class="menu-value">${def.value}</span>` : null}${def.warn ? draw(icons.triangleAlert, 'menu-warning') : null}${role === 'menuitemradio' && checked ? draw(icons.check, 'menu-check') : def.hint ? html`<span class="menu-shortcut">${def.hint}</span>` : null}${role === 'menuitemcheckbox' ? html`<span class="menu-switch" data-state=${checked ? 'checked' : 'unchecked'} aria-hidden="true"><span class="menu-switch-thumb"></span></span>` : null}${opens ? draw(['m9 18 6-6-6-6'], 'menu-chevron') : null}
    </div>`;
  };

  const body = items.map(it => (it.separator
    ? html`<div class="menu-separator" role="separator"></div>`
    : it.group
      ? html`<div role="group" aria-label=${it.group}>${it.heading === false ? null : html`<div class="menu-label" aria-hidden="true">${it.group}</div>`}${it.items.map(row)}</div>`
      : row(it)));

  const style = at
    ? `left:${at.x}px;top:${at.y}px;--menu-origin:${at.origin};--menu-room:${at.room}px`
    : 'left:0;top:0;visibility:hidden;animation:none';

  return html`<${Fragment}>
    <div class="menu" id=${id} role="menu" ref=${box} tabindex="-1" aria-orientation="vertical" aria-label=${label || null} aria-labelledby=${labelledBy || null}
      data-menu-id=${root.id} data-path=${path} data-sub=${path ? '' : null} data-state=${open ? 'open' : 'closed'}
      data-side=${at?.side || null} data-align=${at?.align || null} inert=${!open} style=${style} onKeyDown=${key}>${body}</div>
    ${flat.map((it, n) => (it.items
      ? html`<${Layer} key=${n} root=${root} items=${it.items} path=${subPath(n)} open=${open && sub?.at === n} labelledBy=${`${id}-item-${n}`}
          trigger=${() => rows.current[n]} entry=${sub?.at === n ? sub.entry : null} back=${() => { rows.current[n]?.focus(); setSub(null); }} />`
      : null))}
  <//>`;
}

// What a menu keeps while it is open, and the listeners that close it.
function Tree({ menu, open, onClose, onGone }) {
  const close = useRef(onClose);
  close.current = onClose;
  const shared = useRef(null);
  if (!shared.current) {
    const root = { id: menu.id, anchor: menu.anchor, point: menu.point || null, dir: 'right', grace: null, timer: 0 };
    // A press outside puts the focus back after the press has moved it, which it does once the pointer events are over.
    root.shut = (back, later) => {
      const focus = () => { if (root.anchor.isConnected) root.anchor.focus({ preventScroll: true }); };
      if (back) { if (later) setTimeout(focus); else focus(); }
      close.current();
    };
    // The menu closes first, so a choice that opens a form or moves the focus is not undone by the menu leaving. An item with nothing
    // to run, such as the checked one, hands the focus back to the button as Esc does.
    root.pick = item => { if (!item.run) return root.shut(true); close.current(); item.run(); };
    shared.current = root;
  }
  const root = shared.current;
  const entry = useRef(menu.entry ? { which: menu.entry } : null).current;
  const me = useRef({}).current;

  // The page under a menu takes no press until the menu has faded out, so the first press outside only closes it and a second lands on
  // the page just the same.
  useLayoutEffect(() => holdPointer(), []);

  // A menu is a layer on the stack until it has faded out, so in a sheet Esc and the first press outside close only the menu, and a press
  // while it fades closes nothing.
  useLayoutEffect(() => enter(me), []);

  // A list that reloads can scroll without the button moving, so only a scroll that moves the anchor closes the menu.
  useEffect(() => {
    if (!open) return;
    const { anchor } = root;
    const start = anchor.getBoundingClientRect();
    const moved = () => { const now = anchor.getBoundingClientRect(); return Math.abs(now.top - start.top) > 1 || Math.abs(now.left - start.left) > 1; };
    const within = el => !!el.closest?.(`.menu[data-menu-id="${root.id}"]`);
    const escape = e => { if (e.key === 'Escape' && topmost(me)) { e.preventDefault(); e.stopPropagation(); root.shut(true); } };
    const scrolled = e => { if (!within(e.target) && moved()) close.current(); };
    const away = () => close.current();
    const noNativeMenu = e => e.preventDefault();
    let lastX = 0;
    const track = e => { if (e.clientX !== lastX) { root.dir = e.clientX > lastX ? 'right' : 'left'; lastX = e.clientX; } };
    const stop = onPressOutside(within, e => root.shut(!isSecondary(e), true));
    document.addEventListener('keydown', escape, true);
    document.addEventListener('contextmenu', noNativeMenu, true);
    document.addEventListener('pointermove', track);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', away);
    return () => {
      stop();
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('contextmenu', noNativeMenu, true);
      document.removeEventListener('pointermove', track);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', away);
      clearTimeout(root.timer);
    };
  }, [open]);

  return html`<${Layer} root=${root} items=${menu.items} path="" open=${open} label=${menu.label} entry=${entry} onGone=${onGone} />`;
}

let pressedTrigger = null;

// The handlers of a button that opens a menu, as Radix's trigger has them. A mouse opens the menu when the button is pressed, so
// pressing, dragging to an item and letting go there picks it. A touch or a key opens it on the click, and the up and down arrows
// open it with the last or first item lit. `open(button, entry)` opens the menu.
export function opener(open) {
  return {
    onPointerDown(e) {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.ctrlKey) return;
      e.preventDefault();
      pressedTrigger = e.currentTarget;
      document.addEventListener('pointerup', () => setTimeout(() => { pressedTrigger = null; }), { once: true, capture: true });
      open(e.currentTarget);
    },
    onClick(e) {
      if (pressedTrigger === e.currentTarget && e.detail > 0) return;
      open(e.currentTarget);
    },
    onKeyDown(e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      open(e.currentTarget, e.key === 'ArrowDown' ? 'first' : 'last');
    },
  };
}

// A finger held still for this long asks for the menu, within this far of where it came down. These are drag.js's numbers, which ask
// the same of a session row.
const HOLD_MS = 350;
const HOLD_SLOP = 8;

let touching = false;
let endPress = null;
let quiet = 0;

const swallow = e => { e.preventDefault(); e.stopPropagation(); };
const swallowing = on => {
  for (const type of ['click', 'mousedown']) window[on ? 'addEventListener' : 'removeEventListener'](type, swallow, true);
};

// The handlers of an area that opens a menu as Radix's context menu trigger does: on a right click, at the pointer, on the menu key,
// with no point, and on a finger held still for HOLD_MS, at the finger. `open(area, point, from)` opens the menu, and `from` is the
// element the event came from, such as a menu button inside the area. The click that follows a long press is swallowed, so it picks
// nothing. A menu button inside the area keeps its own touches.
export function contextOpener(open) {
  return {
    onContextMenu(e) {
      e.preventDefault();
      if (!touching) open(e.currentTarget, keyboard ? null : pointIn(e.currentTarget, e), e.target);
    },
    onPointerDown(e) {
      if (e.pointerType === 'mouse' || !e.isPrimary || e.button !== 0) return;
      const area = e.currentTarget;
      const from = e.target;
      const start = { x: e.clientX, y: e.clientY };
      let now = start;
      let fired = false;
      endPress?.();
      clearTimeout(quiet);
      swallowing(false);
      touching = true;
      const timer = from.closest('[aria-haspopup="menu"]') ? 0 : setTimeout(() => {
        fired = true;
        swallowing(true);
        open(area, now, from);
      }, HOLD_MS);
      const stop = new AbortController();
      const end = () => {
        clearTimeout(timer);
        stop.abort();
        touching = false;
        endPress = null;
        if (fired) quiet = setTimeout(() => swallowing(false), 250);
      };
      endPress = end;
      document.addEventListener('pointermove', m => {
        if (!m.isPrimary) return;
        now = { x: m.clientX, y: m.clientY };
        if (Math.hypot(now.x - start.x, now.y - start.y) > HOLD_SLOP) clearTimeout(timer);
      }, { signal: stop.signal });
      document.addEventListener('pointerup', end, { signal: stop.signal });
      document.addEventListener('pointercancel', end, { signal: stop.signal });
    },
  };
}

// `menu` is { id, anchor, point, label, items, entry } while a menu is open, and null when none is. `id` is new for each opening.
// `anchor` is the button or row the menu hangs from and gives the focus back to, and `point` ({ x, y }) opens it at the pointer
// instead. `entry` is 'first' or 'last' to light that item on opening. A menu that has closed stays until it has faded out.
export function Menu({ menu, onClose }) {
  const last = useRef(null);
  const [ended, setEnded] = useState(0);
  if (menu) last.current = menu;
  const drawn = menu ?? (last.current?.id === ended ? null : last.current);
  if (!drawn) return null;
  return html`<${Tree} key=${drawn.id} menu=${drawn} open=${!!menu} onClose=${onClose} onGone=${() => setEnded(drawn.id)} />`;
}
