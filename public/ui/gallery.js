// What the image viewer steps through, and the small decisions it makes. Plain functions on plain data, so they run
// without a browser.

// A transcript image is named by its ref. One still being sent has no ref yet, so it goes by the id the page gave it.
export const imageKey = img => img.ref ?? `local:${img.id}`;

export const isDataUrl = src => src.startsWith('data:');

// Every picture in the chat in the order the thread shows them: saved messages first, then the ones still being sent.
export function threadImages(items, sending, url) {
  const out = [];
  for (const message of [...items, ...sending]) {
    for (const img of message.images || []) out.push({ key: imageKey(img), src: img.src ?? url(img.ref) });
  }
  return out;
}

export const stepIndex = (index, by, total) => Math.min(Math.max(index + by, 0), total - 1);

export const position = (index, total) => `${index + 1} of ${total}`;

const SWIPE = 48;

// Sideways and long enough steps; a tap that slid, or a mostly vertical drag, does not. Swiping left shows the next one.
export function swipeStep(dx, dy) {
  if (Math.abs(dx) < SWIPE || Math.abs(dx) < 1.5 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

// Where Tab goes among `count` controls from the one at `at`, wrapping at both ends. -1 is focus on none of them.
export const tabTarget = (count, at, back) => (at < 0 ? (back ? count - 1 : 0) : (at + (back ? count - 1 : 1)) % count);

// A browser will not open a data URL in a new tab, so a picture still being sent opens from a blob instead.
export function dataUrlToBlob(src) {
  const text = atob(src.slice(src.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let n = 0; n < text.length; n++) bytes[n] = text.charCodeAt(n);
  return new Blob([bytes], { type: src.slice(5, src.indexOf(';')) });
}
