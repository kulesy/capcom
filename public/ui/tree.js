// The rules of the sidebar tree that need no page, so node can test them.

// The stop the arrows go to. `at` is the focused stop, or -1 when none is, and then up and down land on `start`.
// It returns -1 when the key is not for the walk or there is no stop that way.
export function nextStop(count, at, key, start = 0) {
  if (!count) return -1;
  if (at < 0) return key === 'ArrowDown' || key === 'ArrowUp' ? start : -1;
  const to = key === 'ArrowDown' ? at + 1 : key === 'ArrowUp' ? at - 1 : key === 'Home' ? 0 : key === 'End' ? count - 1 : -1;
  return to < count ? to : -1;
}

// Where a group can go from where it is: the top level when it is in a project, and each project it is not in.
export const moveTargets = (projects, group) => [
  ...(group.project ? [{ label: 'Move to top level', project: null }] : []),
  ...projects.filter(p => p.id !== group.project).map(p => ({ label: `Move to ${p.name}`, project: p.id })),
];

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
