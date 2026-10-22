// The rules of the sidebar tree that need no page, so node can test them.
import { byRecent, byTitle } from './order.js';

// The stop the arrows go to. `at` is the focused stop, or -1 when none is, and then up and down land on `start`.
// It returns -1 when the key is not for the walk or there is no stop that way.
export function nextStop(count, at, key, start = 0) {
  if (!count) return -1;
  if (at < 0) return key === 'ArrowDown' || key === 'ArrowUp' ? start : -1;
  const to = key === 'ArrowDown' ? at + 1 : key === 'ArrowUp' ? at - 1 : key === 'Home' ? 0 : key === 'End' ? count - 1 : -1;
  return to < count ? to : -1;
}

// Dropped on any of these, a session leaves its group and shows in the one that matches the app it came from.
export const LOOSE_HOME = { capcom: 'started', desktop: 'ungrouped', cli: 'other' };
export const LOOSE_NAMES = { started: 'Started here', ungrouped: 'Ungrouped', other: 'Terminal and other' };
export const looseHome = row => (row.routine ? null : LOOSE_HOME[row.source]);
export const LOOSE = Object.values(LOOSE_HOME);

// The longest session title the rename form allows. The server holds the same limit as MAX_TITLE in lib/layout.mjs.
export const TITLE_MAX = 120;

// Where a group can go from where it is: Home when it is in a project, and each project it is not in.
export const moveTargets = (projects, group) => [
  ...(group.project ? [{ label: 'Move to Home', project: null }] : []),
  ...projects.filter(p => p.id !== group.project).map(p => ({ label: `Move to ${p.name}`, project: p.id })),
];

// Where a session can go from where it is, in sidebar order, with its own place left out. A project's groups come as one
// { group, items } entry under the project's name. A routine run in a group or pinned can go back to Routines.
export function sessionTargets(ix, row) {
  const own = row.pinned ? null : row.group;
  const placed = row.pinned || !!row.group;
  const groups = list => list.filter(g => g.id !== own).map(g => ({ label: g.name, section: g.id }));
  const home = placed ? looseHome(row) : null;
  return [
    ...(row.routine && placed ? [{ label: 'Routines', section: 'routines' }] : []),
    ...(row.pinned ? [] : [{ label: 'Pinned', section: 'pinned' }]),
    ...ix.projects.map(p => ({ group: p.name, items: groups(ix.groups.filter(g => g.project === p.id)) })).filter(entry => entry.items.length),
    ...groups(ix.groups.filter(g => !g.project)),
    ...(home ? [{ label: LOOSE_NAMES[home], section: home }] : []),
  ];
}

// A list of rows with the sessions nested under each, which the server puts in `children` and in no list of their own.
export const withKids = rows => rows.flatMap(r => [r, ...(r.children ?? [])]);

export const everyRow = ix => withKids([...ix.pinned, ...ix.groups.flatMap(g => g.sessions), ...ix.routines.flatMap(g => [g.latest, ...g.earlier]), ...ix.started, ...ix.ungrouped, ...ix.other]);

export const findRow = (ix, id) => (ix ? everyRow(ix).find(r => r.id === id) || null : null);

// The row a session shows under, or itself when it is not nested.
export function rootOf(ix, id) {
  const row = findRow(ix, id);
  return findRow(ix, row?.parent) ?? row;
}

// Every list that holds nested rows, handed to `edit` with the order it keeps and its name. A routine run holds none.
const mapLists = (ix, edit) => ({
  ...ix,
  pinned: edit(ix.pinned, byRecent, 'pinned'),
  groups: ix.groups.map(g => ({ ...g, sessions: edit(g.sessions, byTitle, g.id) })),
  started: edit(ix.started, byRecent, 'started'),
  ungrouped: edit(ix.ungrouped, byRecent, 'ungrouped'),
  other: edit(ix.other, byRecent, 'other'),
});

const setChildren = ({ children, ...bare }, list) => (list.length ? { ...bare, children: list } : bare);

// A row's children go in the order of the list the row is in.
const reorder = (row, order) => (row.children ? { ...row, children: [...row.children].sort(order) } : row);

// The list with a session taken out of every place it shows. A routine whose latest run it was shows its next run instead,
// and a routine with no run left is gone. The sessions nested under it move up into its place, unless it keeps them
// (`withChildren`), as it does when it moves. A nested session leaves its parent's children. Under a parent in a group or Pinned they
// stay there, and under one in neither each goes to the loose list of its own app, which a routine run has none of.
export function withoutRow(ix, id, { withChildren = false } = {}) {
  const gone = findRow(ix, id);
  const freed = withChildren ? [] : (gone?.children ?? []).map(c => ({ ...c, parent: null }));
  const homeOf = c => (gone.pinned ? 'pinned' : gone.group ?? looseHome(c));
  const leaves = r => ((r.children ?? []).some(c => c.id === id) ? setChildren(r, r.children.filter(c => c.id !== id)) : r);
  const leave = (list, order, name) => {
    const rest = list.filter(r => r.id !== id).map(leaves);
    const arrive = freed.filter(c => homeOf(c) === name);
    return arrive.length ? [...rest, ...arrive].sort(order) : rest;
  };
  return {
    ...mapLists(ix, leave),
    routines: ix.routines.flatMap(g => {
      if (g.latest.id !== id) return [{ ...g, earlier: g.earlier.filter(r => r.id !== id) }];
      const [latest, ...earlier] = g.earlier;
      return latest ? [{ ...g, latest, earlier }] : [];
    }),
  };
}

// Where a dropped row shows until the server's list arrives and replaces this guess. It returns `ix` itself when the drop changes
// nothing. A nested row drops out of its parent, and a row that holds others takes them along.
export function placeRow(ix, id, section) {
  const row = findRow(ix, id);
  if (!row) return ix;
  const group = ix.groups.some(g => g.id === section) ? section : null;
  const inPlace = !row.parent && (section === 'pinned' ? row.pinned : group ? row.group === group && !row.pinned : !row.group && !row.pinned);
  if (inPlace) return ix;
  const at = { pinned: section === 'pinned', group };
  const moved = { ...row, ...at, parent: null, ...(row.children && { children: row.children.map(c => ({ ...c, ...at })) }) };
  const lands = LOOSE.includes(section) ? looseHome(row) : section;
  return mapLists(withoutRow(ix, id, { withChildren: true }), (list, order, name) => (name === lands ? [...list, reorder(moved, order)].sort(order) : list));
}

// Where a nested row shows until the server's list arrives and replaces this guess. It returns `ix` itself when nesting changes
// nothing: the row is nested there already, or it would go under itself or its own child. A family is one level deep, so the
// sessions nested under the row go under the same parent, and a drop on a nested row nests under that row's parent.
export function nestRow(ix, id, parent) {
  const row = findRow(ix, id);
  const root = rootOf(ix, parent);
  if (!row || !root || root.id === id || row.parent === root.id) return ix;
  const at = { group: root.group, pinned: root.pinned };
  const family = [row, ...(row.children ?? [])].map(({ children, ...r }) => ({ ...r, ...at, parent: root.id }));
  const adopt = (list, order) => (list.some(r => r.id === root.id)
    ? list.map(r => (r.id === root.id ? reorder({ ...r, children: [...(r.children ?? []), ...family] }, order) : r)).sort(order)
    : list);
  return mapLists(withoutRow(ix, id, { withChildren: true }), adopt);
}

// The same for a row taken out of its parent: it stays in Pinned or the group its parent is in, and otherwise shows in the loose list of
// its own app, as the server files it. A routine run has no loose list, so it shows again when the server's list arrives.
// `ix` itself comes back for a row that is not nested.
export function unnestRow(ix, id) {
  const row = findRow(ix, id);
  if (!row?.parent) return ix;
  return placeRow(ix, id, row.pinned ? 'pinned' : row.group ?? looseHome(row));
}

// The sessions a row's menu can nest it under: the other top level sessions in the list it shows in, with no routine run and not
// the parent it has already. Its own children are not in the list.
export function nestTargets(ix, row) {
  const home = row.parent ?? row.id;
  const lists = [ix.pinned, ...ix.groups.map(g => g.sessions), ix.started, ix.ungrouped, ix.other];
  return (lists.find(list => list.some(r => r.id === home)) ?? []).filter(r => r.id !== row.id && r.id !== row.parent && !r.routine);
}

// The row that takes the focus once `id` is archived: the next one in the list, or the one before it when it was the last.
export function neighbour(ids, id) {
  const at = ids.indexOf(id);
  return at < 0 ? null : ids[at + 1] ?? ids[at - 1] ?? null;
}

// The session Cmd+A archives: null leaves the key to the browser, { id: null } takes it and archives nothing, { id } archives that one.
// A modal or a form in the list or the projects sidebar keeps the key, and an open menu names its own row (none for a header's). Then a
// ring on a row names that row, a ring on anything else in the list or the sidebar names none, and only then the open session counts.
export function archiveTarget({ modal, menu, form, ringed, ringedOther, current, listed }) {
  const known = id => id != null && listed(id);
  if (modal) return null;
  if (menu) return { id: known(menu.session) ? menu.session : null };
  if (form) return null;
  if (ringedOther) return { id: null };
  const id = ringed ?? current;
  return known(id) ? { id } : null;
}
