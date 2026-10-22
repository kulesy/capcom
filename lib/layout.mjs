// Capcom's own projects, groups, pins, nesting and session titles, in layout.json in its state folder. Desktop writes over its files, so
// Capcom copies Desktop's layout once and owns the copy. See docs/adr/20261015-own-session-layout-seeded-from-desktop.md.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_NAME = 80;
// The length readHead in lib/transcripts.mjs cuts a first prompt to. Desktop's titles and the CLI's custom titles are not cut, so a
// longer one shows as it is until it is renamed here. The page keeps its own copy of this limit in public/ui/tree.js.
const MAX_TITLE = 120;
const EMPTY = { seededAt: null, projects: [], groups: [], pinned: [], assignments: {}, unarchived: [], archived: {}, titles: {}, parents: {} };

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = (status, message) => Object.assign(new Error(message), { status });
const without = (byId, id) => Object.fromEntries(Object.entries(byId).filter(([key]) => key !== id));
const withoutProject = ({ project, ...group }) => group;
const withLinks = (layout, links) => ({ ...layout, parents: { ...layout.parents, ...links } });

const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/gu;
const SHOWS_NOTHING = /^[\p{Default_Ignorable_Code_Point}\s\u2800]*$/u;

// One line of text, whatever was typed or pasted. Markup in it stays text, since the page only ever shows a name as text.
// A name that draws nothing is refused, but the invisible characters inside emoji (joiners, variation selectors) stay.
function nameOf(value, max = MAX_NAME) {
  const name = typeof value === 'string' ? value.replace(BIDI_CONTROLS, '').replace(/[\p{Cc}\s]+/gu, ' ').trim() : '';
  if (SHOWS_NOTHING.test(name)) throw refuse(400, 'Give it a name.');
  if ([...name].length > max) throw refuse(400, `Names run to ${max} characters at most.`);
  return name;
}

function known(list, id, what) {
  const found = list.find(item => item.id === id);
  if (!found) throw refuse(404, `Unknown ${what}.`);
  return found;
}

// Desktop's groups, memberships and pins keyed by CLI session id, the id Capcom uses everywhere. Desktop shows a session
// that is both pinned and in a group as pinned only, so it is copied as pinned only.
function fromDesktop(desk) {
  const byCli = new Map(desk.sessions.map(r => [r.id, r]));
  const cliId = new Map([...byCli.values()].map(r => [r.localId, r.id]));
  const pinned = [...new Set(desk.pinned.map(local => cliId.get(local)).filter(Boolean))];
  const pins = new Set(pinned);
  const known = new Set(desk.groups.map(g => g.id));
  const assignments = {};
  for (const r of byCli.values()) {
    const group = desk.assignments[r.localId];
    if (known.has(group) && !pins.has(r.id)) assignments[r.id] = group;
  }
  return { groups: desk.groups.map(({ id, name }) => ({ id, name })), pinned, assignments };
}

export function makeLayout(stateDir) {
  const file = path.join(stateDir, 'layout.json');

  // Read from disk each time, so a hand edit shows on the next refresh. A missing file is an empty layout. A file that
  // cannot be read is reported and left alone, so a typo is never written over.
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const { seededAt = null, projects = [], groups = [], pinned = [], assignments = {}, unarchived = [], archived = {}, titles = {}, parents = {}, ...rest } = data ?? {};
      if (!isObject(data) || ![projects, groups, pinned, unarchived].every(Array.isArray) || ![assignments, archived, titles, parents].every(isObject)) throw new Error('expected projects, groups, pinned and unarchived as lists and assignments, archived, titles and parents as objects');
      const links = Object.entries(parents).filter(([, parent]) => parent === null || (typeof parent === 'string' && parent));
      return { ...rest, seededAt, projects: projects.filter(p => p?.id), groups: groups.filter(g => g?.id), pinned, assignments, unarchived, archived, titles, parents: Object.fromEntries(links) };
    } catch (e) {
      return e.code === 'ENOENT' ? EMPTY : { ...EMPTY, problem: `layout.json cannot be read: ${e.message}` };
    }
  }

  function write(layout) {
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(layout, null, 2)}\n`);
    fs.renameSync(temp, file);
  }

  function editable() {
    const layout = read();
    if (layout.problem) throw refuse(500, layout.problem);
    return layout;
  }

  return {
    read,

    // Copies Desktop's groups, memberships and pins in, once. It returns the new layout, or null when it did nothing:
    // already copied, Desktop unreadable, or layout.json unreadable. Anything placed here before the copy keeps its place.
    seed(desk) {
      const have = read();
      if (have.problem || have.seededAt || desk.problem) return null;
      const from = fromDesktop(desk);
      const taken = new Set([...have.pinned, ...Object.keys(have.assignments)]);
      const layout = {
        ...have,
        seededAt: new Date().toISOString(),
        groups: [...have.groups, ...from.groups.filter(g => !have.groups.some(h => h.id === g.id))],
        pinned: [...have.pinned, ...from.pinned.filter(id => !taken.has(id))],
        assignments: { ...Object.fromEntries(Object.entries(from.assignments).filter(([id]) => !taken.has(id))), ...have.assignments },
      };
      write(layout);
      return layout;
    },

    // A session is in one place: a group, Pinned or neither. A group of null means ungrouped. Either way it leaves Pinned. With
    // `unlink` it also leaves its parent, which only the caller can tell, since it alone reads Desktop's links.
    // `relink` maps sessions to the parent to link them to in the same write, on this and on every change below.
    move(id, group, { unlink = false, relink = {} } = {}) {
      const layout = editable();
      if (group !== null && !layout.groups.some(g => g.id === group)) throw refuse(400, 'Unknown group.');
      const assignments = without(layout.assignments, id);
      const placed = { ...layout, pinned: layout.pinned.filter(p => p !== id), assignments: group ? { ...assignments, [id]: group } : assignments };
      write(withLinks(placed, { ...relink, ...(unlink && { [id]: null }) }));
    },

    // Desktop's archive flag is read only, so Capcom keeps its own choice here, and that choice wins over the flag.
    archive(id, { relink = {} } = {}) {
      const layout = editable();
      if (Object.hasOwn(layout.archived, id)) return;
      write(withLinks({ ...layout, archived: { ...layout.archived, [id]: new Date().toISOString() }, unarchived: layout.unarchived.filter(u => u !== id) }, relink));
    },

    unarchive(id) {
      const layout = editable();
      const listed = layout.unarchived.includes(id);
      if (listed && !Object.hasOwn(layout.archived, id)) return;
      write({ ...layout, archived: without(layout.archived, id), unarchived: listed ? layout.unarchived : [...layout.unarchived, id] });
    },

    // Capcom's own title, shown in Capcom only. Desktop's record and the CLI's transcript are not Capcom's to write.
    rename(id, title) {
      const layout = editable();
      const name = nameOf(title, MAX_TITLE);
      write({ ...layout, titles: { ...layout.titles, [id]: name } });
      return name;
    },

    // Pinning takes the session out of its group, as Desktop does.
    pin(id, pinned, { unlink = false, relink = {} } = {}) {
      const layout = editable();
      if (typeof pinned !== 'boolean') throw refuse(400, 'Pinned or not?');
      const placed = {
        ...layout,
        pinned: [...layout.pinned.filter(p => p !== id), ...(pinned ? [id] : [])],
        assignments: pinned ? without(layout.assignments, id) : layout.assignments,
      };
      write(withLinks(placed, { ...relink, ...(unlink && { [id]: null }) }));
    },

    // A child shows in its family's place, so its own pin and group go. The caller has resolved `parent` to a top level session.
    nest(id, parent, { relink = {} } = {}) {
      const layout = editable();
      if (typeof parent !== 'string' || !parent || parent === id) throw refuse(400, 'Nest it under another session.');
      write(withLinks({ ...layout, pinned: layout.pinned.filter(p => p !== id), assignments: without(layout.assignments, id) }, { ...relink, [id]: parent }));
    },

    // Takes a session out of its parent, Capcom's or Desktop's, and leaves it in `group` or Pinned, where its family showed it.
    unnest(id, { group = null, pinned = false, relink = {} } = {}) {
      const layout = editable();
      if (group !== null && !layout.groups.some(g => g.id === group)) throw refuse(400, 'Unknown group.');
      const assignments = without(layout.assignments, id);
      write(withLinks({
        ...layout,
        pinned: [...layout.pinned.filter(p => p !== id), ...(pinned ? [id] : [])],
        assignments: group && !pinned ? { ...assignments, [id]: group } : assignments,
      }, { ...relink, [id]: null }));
    },

    // A project holds groups, in the order of `projects`. A group is in at most one, named by its `project`. A group with none,
    // or whose project is gone, is at the top level. Each of these returns the project or group it made or changed.
    addProject(name) {
      const layout = editable();
      const project = { id: `cp-${randomUUID()}`, name: nameOf(name) };
      write({ ...layout, projects: [...layout.projects, project] });
      return project;
    },

    renameProject(id, name) {
      const layout = editable();
      const project = { ...known(layout.projects, id, 'project'), name: nameOf(name) };
      write({ ...layout, projects: layout.projects.map(p => (p.id === id ? project : p)) });
      return project;
    },

    // Its groups go back to the top level. No group and no session is deleted.
    removeProject(id) {
      const layout = editable();
      const project = known(layout.projects, id, 'project');
      write({ ...layout, projects: layout.projects.filter(p => p.id !== id), groups: layout.groups.map(g => (g.project === id ? withoutProject(g) : g)) });
      return project;
    },

    addGroup(name, project = null) {
      const layout = editable();
      if (project !== null) known(layout.projects, project, 'project');
      const group = { id: `cg-${randomUUID()}`, name: nameOf(name), ...(project && { project }) };
      write({ ...layout, groups: [...layout.groups, group] });
      return group;
    },

    // A group keeps its place in `groups` when it moves. A project of null means the top level.
    moveGroup(id, project) {
      const layout = editable();
      const group = known(layout.groups, id, 'group');
      if (project !== null) known(layout.projects, project, 'project');
      const moved = project ? { ...group, project } : withoutProject(group);
      write({ ...layout, groups: layout.groups.map(g => (g.id === id ? moved : g)) });
      return moved;
    },
  };
}
