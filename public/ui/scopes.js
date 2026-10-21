// What each view of the session list holds, as rules that need no page, so node can test them. A view is Home (null), which
// holds everything outside the projects, or a project id, which holds that project's groups. Pinned rows show in every view.

export const HOME_VIEW = null;
export const EVERY_VIEW = Symbol('every view');
export const NO_VIEW = Symbol('no view');

// The view in use: the one chosen while the list still has that project, and Home otherwise.
export const viewIn = (ix, chosen) => (ix.projects.some(p => p.id === chosen) ? chosen : HOME_VIEW);

// A group whose project is not in the list shows in Home, as the server's list says.
const groupView = (ix, g) => viewIn(ix, g.project);

export const groupsIn = (ix, view) => ix.groups.filter(g => groupView(ix, g) === view);

// The view whose list has this session: Home, a project, EVERY_VIEW for a pinned one, or NO_VIEW when the list does not have it.
export function holder(ix, id) {
  if (ix.pinned.some(r => r.id === id)) return EVERY_VIEW;
  const group = ix.groups.find(g => g.sessions.some(r => r.id === id));
  if (group) return groupView(ix, group);
  const runs = ix.routines.flatMap(g => [g.latest, ...g.earlier]);
  return [...runs, ...ix.started, ...ix.ungrouped, ...ix.other].some(r => r.id === id) ? HOME_VIEW : NO_VIEW;
}

// Pinned rows are left out: they show in every view, so they say nothing about this one.
const rowsIn = (ix, view) => (view === HOME_VIEW
  ? [...ix.routines.flatMap(g => [g.latest, ...g.earlier]), ...groupsIn(ix, HOME_VIEW).flatMap(g => g.sessions), ...ix.started, ...ix.ungrouped, ...ix.other]
  : groupsIn(ix, view).flatMap(g => g.sessions));

// 'waiting' if a chat in the view needs you, else 'working' if one is running, else null.
export function lampOf(ix, view) {
  const states = rowsIn(ix, view).map(r => r.state);
  return states.includes('waiting') ? 'waiting' : states.includes('working') ? 'working' : null;
}

export const countOf = (ix, project) => groupsIn(ix, project).reduce((n, g) => n + g.sessions.length, 0);

// Every view, Home first and then each project in the order the list gives them. Home has no count, because it holds everything
// outside the projects.
export const viewsOf = ix => [
  { id: HOME_VIEW, name: 'Home', lamp: lampOf(ix, HOME_VIEW) },
  ...ix.projects.map(p => ({ id: p.id, name: p.name, lamp: lampOf(ix, p.id), count: countOf(ix, p.id) })),
];

// The views whose name has every one of the lower case words. No words keep every view.
export const viewsNamed = (ix, words) => viewsOf(ix).filter(v => words.every(w => v.name.toLowerCase().includes(w)));

// Whether a view other than the one in use has a chat that needs you.
export const othersWaiting = (ix, view) => [HOME_VIEW, ...ix.projects.map(p => p.id)].some(v => v !== view && lampOf(ix, v) === 'waiting');
