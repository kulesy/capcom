// Drags a session row onto a section with pointer events, so a mouse and a finger share the code. A mouse drags after a few
// pixels, so a click still opens the session. A finger drags after a long press, so a swipe still scrolls the list. A right click,
// or a long press let go without moving, asks for the row's menu instead.
const MOUSE_SLOP = 5;
const HOLD_MS = 350;
const HOLD_SLOP = 8;
const EDGE = 56;
const SCROLL_STEP = 16;

// The place of a click if it is inside the element. The menu key reports one that can be far from it, so it gets null.
export function pointIn(el, e) {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? { x: e.clientX, y: e.clientY } : null;
}

// `box` is the scrolling list. Rows are `a.row[data-id]` and drop targets carry `data-drop`. `onOver` gets the target under
// the pointer, or null. `onEnd` gets the target dropped on, or null when the drag was cancelled. `onMenu` gets the row's id and
// element, and where the click or the finger was, or null for the menu key.
// Returns a function that stops it.
export function dragRows(box, { onStart, onOver, onEnd, onMenu }) {
  let press = null;
  let drag = null;
  let stop = null;
  let frame = 0;
  let quiet = 0;

  const swallow = e => { e.preventDefault(); e.stopPropagation(); };
  const swallowing = on => {
    for (const type of ['click', 'mousedown']) window[on ? 'addEventListener' : 'removeEventListener'](type, swallow, true);
  };

  function down(e) {
    const row = e.target.closest('a.row[data-id]');
    if (!row || !e.isPrimary || e.button !== 0) return;
    // On a Mac a Ctrl click is a right click, which asks for the menu, so it must not start a drag.
    if (e.ctrlKey && e.pointerType === 'mouse') return;
    if (stop) lost();
    clearTimeout(quiet);
    swallowing(false);
    const at = { x: e.clientX, y: e.clientY };
    press = { row, start: at, now: at, touch: e.pointerType !== 'mouse', timer: 0 };
    if (press.touch) press.timer = setTimeout(() => lift(press.now.x, press.now.y), HOLD_MS);
    stop = new AbortController();
    const { signal } = stop;
    document.addEventListener('pointermove', move, { signal });
    document.addEventListener('pointerup', up, { signal });
    document.addEventListener('pointercancel', up, { signal });
    document.addEventListener('keydown', escape, { signal, capture: true });
    window.addEventListener('blur', lost, { signal });
  }

  // The drag's place. A touch that leaves the circle it was held in has moved for good, even if it comes back.
  function reach(d, x, y) {
    Object.assign(d, { x, y });
    if (Math.hypot(x - d.start.x, y - d.start.y) > HOLD_SLOP) d.moved = true;
  }

  function move(e) {
    if (!e.isPrimary) return;
    if (drag) {
      reach(drag, e.clientX, e.clientY);
      return follow();
    }
    if (!press) return;
    press.now = { x: e.clientX, y: e.clientY };
    const moved = Math.hypot(press.now.x - press.start.x, press.now.y - press.start.y);
    if (!press.touch && moved >= MOUSE_SLOP) lift(press.now.x, press.now.y);
    else if (press.touch && moved > HOLD_SLOP) release();
  }

  function lift(x, y) {
    const { row, start, touch } = press;
    const at = row.getBoundingClientRect();
    const copy = row.cloneNode(true);
    copy.classList.add('lifted');
    for (const attr of ['href', 'data-id', 'aria-current', 'data-lifted']) copy.removeAttribute(attr);
    copy.setAttribute('aria-hidden', 'true');
    copy.style.width = `${at.width}px`;
    document.body.append(copy);
    document.body.classList.add('dragging');
    clearTimeout(press.timer);
    press = null;
    drag = { id: row.dataset.id, row, touch, start, copy, grabX: start.x - at.left, grabY: start.y - at.top, x, y, over: null, moved: !touch };
    swallowing(true);
    onStart(drag.id);
    follow();
    frame = requestAnimationFrame(autoscroll);
  }

  function follow() {
    drag.copy.style.transform = `translate(${drag.x - drag.grabX}px, ${drag.y - drag.grabY}px)`;
    const over = document.elementFromPoint(drag.x, drag.y)?.closest('[data-drop]')?.dataset.drop ?? null;
    if (over !== drag.over) {
      drag.over = over;
      onOver(over);
    }
  }

  // Near the top or bottom of the list it scrolls, faster the closer the pointer is to the edge, so a far section can be reached.
  // A finger that has not moved since the long press holds still, so the list holds still under it.
  function autoscroll() {
    if (!drag) return;
    const r = box.getBoundingClientRect();
    const pull = !drag.moved || drag.x < r.left || drag.x > r.right ? 0 : Math.max(drag.y - (r.bottom - EDGE), 0) - Math.max(r.top + EDGE - drag.y, 0);
    if (pull) {
      const was = box.scrollTop;
      box.scrollTop += Math.sign(pull) * Math.ceil(SCROLL_STEP * Math.min(Math.abs(pull), EDGE) / EDGE);
      if (box.scrollTop !== was) follow();
    }
    frame = requestAnimationFrame(autoscroll);
  }

  function discard() {
    cancelAnimationFrame(frame);
    drag.copy.remove();
    document.body.classList.remove('dragging');
    drag = null;
  }

  // The click after a drag must not open the session. A touch can send it a moment after the pointer goes up, so it is swallowed for a while.
  // So is the mouse down before it, which would take the focus off the menu a long press opens.
  function release() {
    clearTimeout(press?.timer);
    press = null;
    stop?.abort();
    stop = null;
    if (drag) discard();
    quiet = setTimeout(() => swallowing(false), 250);
  }

  function up(e) {
    if (!e.isPrimary) return;
    const carried = drag;
    const dropped = carried && e.type === 'pointerup';
    if (dropped) {
      reach(carried, e.clientX, e.clientY);
      follow();
    }
    const still = dropped && carried.touch && !carried.moved;
    const target = dropped && !still ? carried.over : null;
    release();
    if (carried) onEnd(carried.id, target);
    if (still) onMenu(carried.id, carried.row, { x: carried.x, y: carried.y });
  }

  function escape(e) {
    if (e.key !== 'Escape' || !drag) return;
    e.preventDefault();
    e.stopPropagation();
    const { id } = drag;
    discard();
    onEnd(id, null);
  }

  function lost() {
    const carried = drag;
    release();
    if (carried) onEnd(carried.id, null);
  }

  function menu(e) {
    if (press?.touch || drag) return e.preventDefault();
    const row = e.target.closest('a.row[data-id]');
    if (!row) return;
    e.preventDefault();
    onMenu(row.dataset.id, row, pointIn(row, e));
  }

  const life = new AbortController();
  const { signal } = life;
  box.addEventListener('pointerdown', down, { signal });
  box.addEventListener('dragstart', e => e.preventDefault(), { signal });
  box.addEventListener('contextmenu', menu, { signal });
  // NOTE: [15 Oct 2026] EK - Keep this touchmove listener non-passive and registered up front, not added at the long press.
  // dnd-kit does the same to stop the list scrolling under a touch drag, and says iOS Safari needs it.
  // See https://github.com/clauderic/dnd-kit/blob/master/packages/core/src/sensors/touch/TouchSensor.ts.
  box.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { signal, passive: false });

  return () => {
    life.abort();
    lost();
  };
}
