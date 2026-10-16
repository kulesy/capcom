// How sessions are put in order, with no DOM in it so the server and the page share one answer.
export const UNTITLED = 'Untitled session';

export const byRecent = (a, b) => b.lastActivityAt - a.lastActivityAt;

// Not \p{Emoji}, which also matches every digit, # and *. Those count only as a keycap, and the rest of a flag or ZWJ sequence follows its first symbol.
const EMOJI_FIRST = /^\s*(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]️?⃣)/u;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' });

export const startsWithEmoji = title => EMOJI_FIRST.test(title);

const titleOf = row => row.title || UNTITLED;
const half = title => (startsWithEmoji(title) ? 0 : 1);

// Inside a group: titles that start with an emoji first, then the rest, each half A to Z. The collator reads
// 2 before 10, ignores case, and gives the same emoji the same weight, so its sessions sit together.
export function byTitle(a, b) {
  const [x, y] = [titleOf(a), titleOf(b)];
  return half(x) - half(y) || collator.compare(x, y) || byRecent(a, b);
}
