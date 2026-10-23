// The rules of the sidebar's multi-select that need no page, so node can test them. A row is named by its id, and `order` is the ids of
// the drawn rows in screen order. A selection is { ids, base, anchor }: `ids` is what is picked, `anchor` the row a Shift range runs
// from, and `base` what was picked before that anchor was set, which every range is added to.
export const NO_PICK = { ids: [], base: [], anchor: null };

// A plain click: the row is the anchor and nothing is picked.
export const anchorAt = (state, id) => (!state.ids.length && state.anchor === id ? state : { ids: [], base: [], anchor: id });

// A row picked on its own, as the row menu's Select does.
export const only = id => ({ ids: [id], base: [id], anchor: id });

// Cmd-click: the row is picked or let go, and becomes the anchor.
export function toggle(state, id) {
  const ids = state.ids.includes(id) ? state.ids.filter(x => x !== id) : [...state.ids, id];
  return { ids, base: ids, anchor: id };
}

// Shift-click: everything from the anchor to `id` is picked, on top of `base`. With no anchor on screen it picks just `id`.
export function extend(state, order, id) {
  const to = order.indexOf(id);
  if (to < 0) return state;
  const from = order.indexOf(state.anchor);
  if (from < 0) return only(id);
  const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
  return { ...state, ids: [...new Set([...state.base, ...range])] };
}

// Shift+Arrow from the focused row `from`: the row the focus moves to and the selection grown to it, or null at the end of the list.
// A focus that plain arrows moved off the range, or an anchor that is no longer drawn, makes `from` the anchor over what is picked.
export function step(state, order, from, key) {
  const at = order.indexOf(from);
  const to = at + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0);
  if (at < 0 || to === at || to < 0 || to >= order.length) return null;
  const chained = order.includes(state.anchor) && (from === state.anchor || state.ids.includes(from));
  const start = chained ? state : { ids: state.ids, base: state.ids, anchor: from };
  return { to: order[to], state: extend(start, order, order[to]) };
}

// The selection with only the rows that are drawn, or the same object when every one is.
export function prune(state, order) {
  const drawn = new Set(order);
  const ids = state.ids.filter(id => drawn.has(id));
  const base = state.base.filter(id => drawn.has(id));
  const anchor = drawn.has(state.anchor) ? state.anchor : null;
  return ids.length === state.ids.length && base.length === state.base.length && anchor === state.anchor ? state : { ids, base, anchor };
}

// The picked rows in screen order.
export const inOrder = (state, order) => order.filter(id => state.ids.includes(id));

// The row that takes the focus once `ids` leave the list: the one after the last of them, or else the one before the first, or else
// the last one left, so the focus stays in the list while any row does.
export function stayAfter(order, ids) {
  const at = order.flatMap((id, i) => (ids.includes(id) ? [i] : []));
  if (!at.length) return null;
  return order[at.at(-1) + 1] ?? order[at[0] - 1] ?? order.findLast(id => !ids.includes(id)) ?? null;
}

export const sessions = n => (n === 1 ? '1 session' : `${n} sessions`);

const sentence = text => (/[.!?]$/.test(text) ? text : `${text}.`);

// What the question before a batch says: how many of the sessions are running, and what archiving them does.
export function stopDetail(running) {
  const one = running === 1;
  return `${one ? '1 of them is running' : `${running} of them are running`}. Archiving stops Claude's turn in ${one ? 'it' : 'each'} and denies any approval it is waiting for. Undo brings the sessions back, but not the ${one ? 'turn' : 'turns'}.`;
}

// The note once a batch has been archived, or part of it. `reason` is the first refusal, and is read only when some were not archived.
export function archiveNote({ archived, total, stopped = 0, reason = '' }) {
  const stops = stopped ? ` and stopped ${stopped}` : '';
  if (archived === total) return `Archived ${sessions(total)}${stops}.`;
  if (!archived) return `Not archived: ${sentence(reason)}`;
  return `Archived ${archived} of ${sessions(total)}${stops}. Not archived: ${sentence(reason)}`;
}

// The note once a batch has been brought back, or part of it.
export function unarchiveNote({ restored, total, reason = '' }) {
  if (restored === total) return `Unarchived ${sessions(total)}.`;
  if (!restored) return `Not unarchived: ${sentence(reason)}`;
  return `Unarchived ${restored} of ${sessions(total)}. Not unarchived: ${sentence(reason)}`;
}
