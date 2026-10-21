// The rules of the sidebar tree that need no page, so node can test them.

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

// The list with a session taken out of every place it shows. A routine whose latest run it was shows its next run instead,
// and a routine with no run left is gone.
export function withoutRow(ix, id) {
  const without = list => list.filter(r => r.id !== id);
  return {
    ...ix,
    pinned: without(ix.pinned),
    groups: ix.groups.map(g => ({ ...g, sessions: without(g.sessions) })),
    routines: ix.routines.flatMap(g => {
      if (g.latest.id !== id) return [{ ...g, earlier: without(g.earlier) }];
      const [latest, ...earlier] = g.earlier;
      return latest ? [{ ...g, latest, earlier }] : [];
    }),
    started: without(ix.started),
    ungrouped: without(ix.ungrouped),
    other: without(ix.other),
  };
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
