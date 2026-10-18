// Which result the search has selected, with no page in it so node can test it. The selection is held as the key of the result and
// the position it was at, so results that come and go around it do not move it onto another result.

// A selection with no key yet is whatever result is at its position, which starts as the first.
export const FIRST = { key: null, at: 0 };

// The selection on the result at position `at`.
export const holdAt = (keys, at) => ({ key: keys[at] ?? null, at });

// The position selected in `keys`: where the held key is, or the position it was last at when it is gone, kept inside the list.
export function selectedIn(keys, { key, at }) {
  const last = Math.max(keys.length - 1, 0);
  if (key === null || keys[at] === key) return Math.min(at, last);
  const found = keys.indexOf(key);
  return found < 0 ? Math.min(at, last) : found;
}

// The selection one step on from position `at`, stopping at either end of the list.
export const holdStep = (keys, at, by) => holdAt(keys, Math.max(0, Math.min(at + by, keys.length - 1)));

// The selection once the result at position `at` is taken out: the one after it, or the one before it when it was the last.
export function holdBeside(keys, at) {
  if (at + 1 < keys.length) return { key: keys[at + 1], at };
  return at > 0 ? { key: keys[at - 1], at: at - 1 } : FIRST;
}
