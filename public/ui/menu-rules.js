// The rules of a menu that need no page: where it sits, which item a key lands on, which item a typed letter finds, and what role an item has.
// Placement follows Floating UI as Radix uses it: shift along the anchor's edge, flip to the best side, then size to the room left.

const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const OTHER_END = { start: 'end', end: 'start', center: 'center' };
const AT = { start: '0%', center: '50%', end: '100%' };

const isVertical = side => side === 'top' || side === 'bottom';
const clamp = (low, value, high) => Math.max(low, Math.min(value, high));

function coords(a, s, side, align, offset) {
  const centred = { x: a.x + a.width / 2 - s.width / 2, y: a.y + a.height / 2 - s.height / 2 };
  const at = {
    top: { x: centred.x, y: a.y - s.height - offset },
    bottom: { x: centred.x, y: a.y + a.height + offset },
    right: { x: a.x + a.width + offset, y: centred.y },
    left: { x: a.x - s.width - offset, y: centred.y },
  }[side];
  if (align === 'center') return at;
  const slack = isVertical(side) ? a.width / 2 - s.width / 2 : a.height / 2 - s.height / 2;
  const slide = align === 'start' ? -slack : slack;
  return isVertical(side) ? { x: at.x + slide, y: at.y } : { x: at.x, y: at.y + slide };
}

// How far each edge of the menu is past the room it may use. Positive is past, so a menu that fits has none above zero.
function past({ x, y }, s, bounds, pad) {
  return {
    top: bounds.y + pad - y,
    bottom: y + s.height - (bounds.y + bounds.height - pad),
    left: bounds.x + pad - x,
    right: x + s.width - (bounds.x + bounds.width - pad),
  };
}

// Slides the menu along the anchor's edge to stay in view, but never so far that it loses touch with the anchor.
function shift(at, a, s, bounds, pad, side) {
  const o = past(at, s, bounds, pad);
  if (isVertical(side)) {
    const x = clamp(at.x + o.left, at.x, at.x - o.right);
    return { x: clamp(a.x - s.width, x, a.x + a.width), y: at.y };
  }
  const y = clamp(at.y + o.top, at.y, at.y - o.bottom);
  return { x: at.x, y: clamp(a.y - s.height, y, a.y + a.height) };
}

// The two edges across the alignment, so a menu that is wider than its anchor is judged on the edge that sticks out.
function alignEdges(side, align, a, s) {
  const vertical = isVertical(side);
  const length = vertical ? 'width' : 'height';
  let near = vertical ? (align === 'start' ? 'right' : 'left') : (align === 'start' ? 'bottom' : 'top');
  if (a[length] > s[length]) near = OPPOSITE[near];
  return [near, OPPOSITE[near]];
}

// The first side and alignment where the menu fits. When none does, the one that fits on its side and sticks out least across it,
// or else the one that sticks out least in all.
function fit(a, s, bounds, { side, align, offset, pad }) {
  const tries = align === 'center'
    ? [[side, align], [OPPOSITE[side], align]]
    : [[side, align], [side, OTHER_END[align]], [OPPOSITE[side], align], [OPPOSITE[side], OTHER_END[align]]];
  const seen = [];
  for (const [by, how] of tries) {
    const at = shift(coords(a, s, by, how, offset), a, s, bounds, pad, by);
    const o = past(at, s, bounds, pad);
    const [near, far] = alignEdges(by, how, a, s);
    const found = { side: by, align: how, at, overflows: [o[by], o[near], o[far]] };
    if (found.overflows.every(v => v <= 0)) return found;
    seen.push(found);
  }
  const onSide = seen.filter(t => t.overflows[0] <= 0).sort((x, y) => x.overflows[1] - y.overflows[1]);
  const total = t => t.overflows.reduce((sum, v) => sum + Math.max(v, 0), 0);
  return onSide[0] ?? [...seen].sort((x, y) => total(x) - total(y))[0];
}

// Where a menu goes. `anchor` is the rect it hangs from ({ x, y, width, height }, with no size for a point), `size` the menu's own,
// `view` the room it may use. It returns the top left, the side and alignment it ended up on, the CSS transform origin that grows it
// from the anchor, and `room`, the height it may have there. A menu taller than that is placed again at that height. The last step
// keeps the menu inside the view even where no side fits, which Floating UI leaves to the page.
export function place({ anchor, size, view, side, align = 'center', offset = 0, pad = 0, dpr = 1 }) {
  const bounds = { x: 0, y: 0, ...view };
  let s = { ...size };
  let found;
  let room;
  for (let pass = 0; pass < 3; pass++) {
    found = fit(anchor, s, bounds, { side, align, offset, pad });
    const o = past(found.at, s, bounds, pad);
    room = Math.max(0, isVertical(found.side) ? Math.min(s.height - o[found.side], bounds.height - 2 * pad) : bounds.height - 2 * pad);
    if (room >= s.height) break;
    s = { ...s, height: room };
  }
  const keep = (v, from, length, own) => clamp(from + pad, v, from + length - pad - own);
  const round = v => Math.round(v * dpr) / dpr;
  const along = AT[found.align];
  const origin = { bottom: `${along} 0px`, top: `${along} ${s.height}px`, right: `0px ${along}`, left: `${s.width}px ${along}` }[found.side];
  return {
    x: round(keep(found.at.x, bounds.x, bounds.width, s.width)),
    y: round(keep(found.at.y, bounds.y, bounds.height, s.height)),
    side: found.side,
    align: found.align,
    origin,
    room,
  };
}

// The item a key moves to among `count` enabled items, or -1 for a key that moves nowhere. `at` is the item that has the focus, or -1
// when the menu itself has it, where Down lands on the first item and Up on the last. The arrows stop at either end.
export function stepIn(count, at, key) {
  if (!count) return -1;
  if (key === 'ArrowDown') return at < 0 ? 0 : Math.min(at + 1, count - 1);
  if (key === 'ArrowUp') return at < 0 ? count - 1 : Math.max(at - 1, 0);
  if (key === 'Home' || key === 'PageUp') return 0;
  if (key === 'End' || key === 'PageDown') return count - 1;
  return -1;
}

// The item that typing `search` finds, from the labels of the enabled items. It looks on from the focused item `at` and wraps. One
// letter skips the focused item, so pressing it again moves on, and a letter typed over and over counts as that one letter. -1 is no
// match, or the match already having the focus.
export function nextMatch(labels, search, at) {
  if (!labels.length || !search) return -1;
  const repeated = search.length > 1 && [...search].every(c => c === search[0]);
  const text = (repeated ? search[0] : search).toLowerCase();
  const start = Math.max(at, 0);
  const order = labels.map((_, i) => (start + i) % labels.length);
  const pool = text.length === 1 ? order.filter(i => i !== at) : order;
  const hit = pool.find(i => labels[i].toLowerCase().startsWith(text));
  return hit === undefined || hit === at ? -1 : hit;
}

// The item that pressing `key` picks, among a menu's items in the order they are drawn: the first enabled one that names the key and
// does not open a sub-menu. -1 when none does.
export function keyedItem(items, key) {
  return items.findIndex(it => it.key === key && !it.disabled && !it.items);
}

// An item's ARIA role and aria-checked. An item with `checked` is a radio item and one with `switch` is a checkbox item, each true or false,
// so one that is off still says so. The fast mode switch is a checkbox item because a menu may own nothing but items.
export function roleOf(item) {
  if (typeof item.checked === 'boolean') return { role: 'menuitemradio', checked: item.checked };
  if (typeof item.switch === 'boolean') return { role: 'menuitemcheckbox', checked: item.switch };
  return { role: 'menuitem', checked: null };
}

// The area a pointer may cross on its way from a sub-menu's trigger to the sub-menu, without the sub-menu closing: where it left
// the trigger, nudged 5px back, then the sub-menu's near and far edges. `side` is the side of the trigger the sub-menu opened on.
export function graceArea(exit, rect, side) {
  const right = side === 'right';
  const near = right ? rect.left : rect.right;
  const far = right ? rect.right : rect.left;
  return [
    { x: exit.x + (right ? -5 : 5), y: exit.y },
    { x: near, y: rect.top },
    { x: far, y: rect.top },
    { x: far, y: rect.bottom },
    { x: near, y: rect.bottom },
  ];
}

// Whether a point is inside a polygon, by counting how many of its edges a ray from the point to the right crosses.
export function inside({ x, y }, polygon) {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) within = !within;
  }
  return within;
}
