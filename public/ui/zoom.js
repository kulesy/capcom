// What the image viewer's zoom and pan decide. Plain functions on plain numbers, so they run without a browser.
// A view is { s, x, y }: the picture's scale against its size at fit (1 is fit to screen), and how far its centre has moved
// from where fit puts it, in px. Other fields pass through. A box is the stage and the picture at fit, measured once.

export const FIT = { s: 1, x: 0, y: 0 };

export const DOUBLE_TAP_ZOOM = 2.5;
export const DRAG_PX = 6;
export const TAP_PX = 10;
export const WHEEL_QUIET_MS = 250;

const TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const SETTLE = 1.05;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export const maxScale = box => Math.max(4, box.actual);

export const atOwnSize = box => box.actual <= 1.001;

// `stage` and `pic` are rects (left, top, width, height) and `pic` includes its border. `actual` is the scale at which a
// file pixel is one px.
export function boxOf(stage, pic, border, naturalWidth) {
  const w = pic.width - 2 * border;
  const h = pic.height - 2 * border;
  if (!(w > 0 && h > 0)) return null;
  return {
    sw: stage.width,
    sh: stage.height,
    cx: pic.left + pic.width / 2 - stage.left,
    cy: pic.top + pic.height / 2 - stage.top,
    w,
    h,
    b: border,
    actual: Math.max(1, naturalWidth / w),
  };
}

// Wider than the stage, the picture covers it edge to edge. Narrower, it stays where fit put it, pushed back inside if it
// grew past an edge. The two rules agree where the picture is exactly as wide as the stage, so nothing jumps there.
function along(at, stage, centre, size, border) {
  const half = size / 2 + border;
  return 2 * half > stage ? clamp(at, stage - half - centre, half - centre) : clamp(0, half - centre, stage - half - centre);
}

export const clampView = (view, box) => ({
  ...view,
  x: along(view.x, box.sw, box.cx, box.w * view.s, box.b),
  y: along(view.y, box.sh, box.cy, box.h * view.s, box.b),
});

// Scales by k about the stage point (px, py), so the part of the picture under it stays under it.
export function zoomAt(view, k, px, py, box) {
  const s = clamp(view.s * k, 1, maxScale(box));
  const r = s / view.s;
  return clampView({ ...view, s, x: px - box.cx - (px - box.cx - view.x) * r, y: py - box.cy - (py - box.cy - view.y) * r }, box);
}

export const panBy = (view, dx, dy, box) => clampView({ ...view, x: view.x + dx, y: view.y + dy }, box);

export const toFit = view => ({ ...view, ...FIT });

// The view for a stage that changed from `old` to `box`. The picture keeps its size on screen and the part of it at the middle of the stage
// stays there, unless the scale hit its range, when the offset from the picture's centre follows the size it did get, on each axis.
export function rebox(view, old, box) {
  const s = clamp(view.s * old.w / box.w, 1, maxScale(box));
  if (s === 1) return toFit(view);
  const kx = box.w * s / (old.w * view.s);
  const ky = box.h * s / (old.h * view.s);
  return clampView({ ...view, s, x: box.sw / 2 - box.cx - kx * (old.sw / 2 - old.cx - view.x), y: box.sh / 2 - box.cy - ky * (old.sh / 2 - old.cy - view.y) }, box);
}

// Done when a pinch ends, or when the wheel has been quiet for WHEEL_QUIET_MS after a ctrl+wheel zoom, and never per wheel event,
// where the small steps of a slow pinch would never leave 1.
export const settle = view => (view.s > 1 && view.s < SETTLE ? toFit(view) : view);

// Where to draw a zoomed picture in the stage: its content size, and the top left of its border box.
export function rectOf(view, box) {
  const width = box.w * view.s;
  const height = box.h * view.s;
  return { left: box.cx + view.x - width / 2 - box.b, top: box.cy + view.y - height / 2 - box.b, width, height };
}

export const wheelPx = (delta, mode, page) => delta * (mode === 1 ? 16 : mode === 2 ? page : 1);

// Chromium sends a trackpad pinch as a ctrl+wheel whose deltaY is -100 times the log of the scale. The cap keeps one notch
// of a mouse wheel to a step of about 1.6.
export const wheelZoom = px => Math.exp(-clamp(px, -50, 50) / 100);

export const travelled = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

export const pinchOf = (a, b) => ({ d: travelled(a, b), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Worked from the view and fingers at the pinch's start every time: step by step, the clamps at fit and at the limit would add up,
// since one finger always reports before the other. `start` and `now` are pinchOf results in stage px.
export function pinchTo(from, start, now, box) {
  const s = clamp(from.s * (start.d ? now.d / start.d : 1), 1, maxScale(box));
  const r = s / from.s;
  return clampView({ ...from, s, x: now.x - box.cx - (start.x - box.cx - from.x) * r, y: now.y - box.cy - (start.y - box.cy - from.y) * r }, box);
}

// `down` and `up` are { x, y, t } with t in ms.
export const isTap = (down, up) => up.t - down.t < TAP_MS && travelled(down, up) < TAP_PX;

export const isDoubleTap = (first, second) => second.t - first.t <= TAP_MS && travelled(first, second) <= DOUBLE_TAP_PX;
