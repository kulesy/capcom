// The rules of the sidebar tree that need no page, so node can test them.
import { sortFamily, sortRows } from './order.js';

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

// Puts on each row with a turn running the time the turn began by this page's clock, which the row counts from. An answer can only be
// late, so a row still in the same turn keeps its earlier start. `turnStartedAt` is the server's clock and only names the turn.
export function stampTurns(ix, before, receivedAt) {
  const seen = new Map((before ? everyRow(before) : []).map(r => [r.id, r]));
  for (const r of everyRow(ix)) {
    if (!Number.isFinite(r.turnMs)) continue;
    const start = receivedAt - r.turnMs;
    const old = seen.get(r.id);
    r.turnStart = Number.isFinite(old?.turnStart) && old.turnStartedAt === r.turnStartedAt ? Math.min(old.turnStart, start) : start;
  }
  return ix;
}

// The row a session shows under, or itself when it is not nested.
export function rootOf(ix, id) {
  const row = findRow(ix, id);
  return findRow(ix, row?.parent) ?? row;
}

// Every list that holds nested rows, handed to `edit` with the sort the server sent for it and its name. A routine run holds none.
const mapLists = (ix, edit) => ({
  ...ix,
  pinned: edit(ix.pinned, ix.sorts.pinned, 'pinned'),
  groups: ix.groups.map(g => ({ ...g, sessions: edit(g.sessions, g.sort, g.id) })),
  started: edit(ix.started, ix.sorts.sessions, 'started'),
  ungrouped: edit(ix.ungrouped, ix.sorts.sessions, 'ungrouped'),
  other: edit(ix.other, ix.sorts.sessions, 'other'),
});

const setChildren = ({ children, ...bare }, list) => (list.length ? { ...bare, children: list } : bare);

// A row's children go in the order of the list the row is in.
const reorder = (row, sort) => (row.children ? { ...row, children: sortFamily(row, row.children, sort) } : row);

// The list with a session taken out of every place it shows. A routine whose latest run it was shows its next run instead,
// and a routine with no run left is gone. The sessions nested under it move up into its place, unless it keeps them
// (`withChildren`), as it does when it moves. A nested session leaves its parent's children. Under a parent in a group or Pinned they
// stay there, and under one in neither each goes to the loose list of its own app, which a routine run has none of.
export function withoutRow(ix, id, { withChildren = false } = {}) {
  const gone = findRow(ix, id);
  const kids = withChildren ? [] : gone?.children ?? [];
  // A freed session keeps the sessions under it, so each that showed straight under the one that went heads a family, as the server
  // lists them.
  const kin = new Map(kids.map(c => [c.id, c]));
  const headOf = c => {
    for (let n = kids.length; n > 0 && kin.has(c.via); n--) c = kin.get(c.via);
    return c;
  };
  const freed = kids.filter(c => headOf(c) === c).map(h => setChildren({ ...h, parent: null, via: null }, kids.filter(c => c !== h && headOf(c) === h).map(c => ({ ...c, parent: h.id }))));
  const homeOf = c => (gone.pinned ? 'pinned' : gone.group ?? looseHome(c));
  // The sessions straight under a member that leaves show under the one it showed under, as the server links them. A family is placed
  // by its best member, so a list with a family that lost one is placed again.
  const leaves = (r, sort) => ((r.children ?? []).some(c => c.id === id) ? setChildren(r, sortFamily(r, r.children.filter(c => c.id !== id).map(c => (c.via === id ? { ...c, via: gone.via } : c)), sort)) : r);
  const leave = (list, sort, name) => {
    const kept = list.filter(r => r.id !== id);
    const rest = kept.map(r => leaves(r, sort));
    const arrive = freed.filter(c => homeOf(c) === name).map(c => reorder(c, sort));
    return arrive.length || rest.some((r, i) => r !== kept[i]) ? sortRows([...rest, ...arrive], sort) : rest;
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
  const moved = { ...row, ...at, parent: null, via: null, ...(row.children && { children: row.children.map(c => ({ ...c, ...at })) }) };
  const lands = LOOSE.includes(section) ? looseHome(row) : section;
  return mapLists(withoutRow(ix, id, { withChildren: true }), (list, sort, name) => (name === lands ? sortRows([...list, reorder(moved, sort)], sort) : list));
}

// Where a nested row shows until the server's list arrives and replaces this guess. It returns `ix` itself when nesting changes
// nothing: the row is nested there already, or it would go under itself or its own child. A family is one level deep, so the
// sessions nested under the row go under the same parent, and a drop on a nested row nests under that row's parent.
export function nestRow(ix, id, parent) {
  const row = findRow(ix, id);
  const root = rootOf(ix, parent);
  if (!row || !root || root.id === id || row.parent === root.id) return ix;
  const at = { group: root.group, pinned: root.pinned };
  const family = [row, ...(row.children ?? [])].map(({ children, ...r }) => ({ ...r, ...at, parent: root.id, ...(r.id === id && { via: root.id }) }));
  const adopt = (list, sort) => (list.some(r => r.id === root.id)
    ? sortRows(list.map(r => (r.id === root.id ? reorder({ ...r, children: [...(r.children ?? []), ...family] }, sort) : r)), sort)
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

// The session Cmd+A archives: null leaves the key to the browser, { id: null } takes it and archives nothing, { id } archives that one
// and { ids } those. A modal or a form in the list or the projects sidebar keeps the key, and an open menu names its own row (none for a
// header's), or the whole selection when its row is picked. A ring on anything but a row names none. Then the selection counts, one
// picked row as { id }, ahead of a ring on a row, and only then the open session.
export function archiveTarget({ modal, menu, form, ringed, ringedOther, current, listed, picked = [] }) {
  const known = id => id != null && listed(id);
  const chosen = picked.filter(known);
  const selection = () => (chosen.length === 1 ? { id: chosen[0] } : { ids: chosen });
  if (modal) return null;
  if (menu) return chosen.includes(menu.session) ? selection() : { id: known(menu.session) ? menu.session : null };
  if (form) return null;
  if (ringedOther) return { id: null };
  if (chosen.length) return selection();
  const id = ringed ?? current;
  return known(id) ? { id } : null;
}
