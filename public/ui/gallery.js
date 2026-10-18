// What the image viewer steps through, and the small decisions it makes. Plain functions on plain data, so they run
// without a browser.
import { toolSource } from './format.js';

// A transcript image is named by its ref. One still being sent has no ref yet, so it goes by the id the page gave it.
export const imageKey = img => img.ref ?? `local:${img.id}`;

export const isDataUrl = src => src.startsWith('data:');

export const fromTool = source => `Image from ${source}`;

// The chat's pictures in the order the transcript draws them, so Previous and Next follow the page.
export function threadImages(items, sending, url, names) {
  const out = [];
  for (const message of [...items, ...sending]) {
    const alt = message.kind === 'tool' ? fromTool(toolSource(message.name, names)) : 'Attached image';
    for (const img of message.images || []) out.push({ key: imageKey(img), src: img.src ?? url(img.ref), alt });
  }
  return out;
}

export const draftImages = images => images.map(img => ({ key: imageKey(img), src: img.src, alt: img.name }));

export const toolShots = (tools, names) => tools.flatMap(t => (t.images || []).map(img => ({ img, source: toolSource(t.name, names) })));

export const TILES = 4;

// With more pictures than tiles the last tile stands for itself and every picture after it; this is how many that is.
export const overflow = total => (total > TILES ? total - (TILES - 1) : 0);

export function tileLabel(n, total, source) {
  if (overflow(total) && n === TILES - 1) return `View ${overflow(total)} more images`;
  return total > 1 ? `View image ${n + 1} of ${total}, from ${source}` : `View image from ${source}`;
}

// Which thumbnail on screen takes focus when the viewer closes: one for the picture it opened on (`opened`), else the one now at
// its place in the thread, else the nearest, else -1. `keys` are the thread's pictures as they stand now, because a message
// is saved under new keys once it has sent.
export function nearestThumb(shown, keys, start, opened) {
  for (const key of [opened, keys[start]]) if (shown.includes(key)) return shown.indexOf(key);
  let best = -1;
  let gap = Infinity;
  shown.forEach((key, n) => {
    const at = keys.indexOf(key);
    if (at !== -1 && Math.abs(at - start) < gap) { best = n; gap = Math.abs(at - start); }
  });
  return best;
}

export const stepIndex = (index, by, total) => Math.min(Math.max(index + by, 0), total - 1);

// The pictures from before the loaded messages go in front of the loaded ones, leaving out any the loaded list already has.
export function joinEarlier(earlier, images) {
  if (!earlier.length) return images;
  const loaded = new Set(images.map(i => i.key));
  return [...earlier.filter(i => !loaded.has(i.key)), ...images];
}

// The key of the picture `by` steps from `key`. A key that is not in the list steps from the first picture.
export function stepKey(list, key, by) {
  const at = Math.max(0, list.findIndex(i => i.key === key));
  return list[stepIndex(at, by, list.length)].key;
}

export const position = (index, total) => `${index + 1} of ${total}`;

const SWIPE = 48;

export function swipeStep(dx, dy) {
  if (Math.abs(dx) < SWIPE || Math.abs(dx) < 1.5 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

export const tabTarget = (count, at, back) => (at < 0 ? (back ? count - 1 : 0) : (at + (back ? count - 1 : 1)) % count);

// A browser will not open a data URL in a new tab, so a picture still being sent opens from a blob instead.
export function dataUrlToBlob(src) {
  const text = atob(src.slice(src.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let n = 0; n < text.length; n++) bytes[n] = text.charCodeAt(n);
  return new Blob([bytes], { type: src.slice(5, src.indexOf(';')) });
}
