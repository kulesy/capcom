// Capcom's own groups and pins, in layout.json in its state folder. Desktop writes over its files, so Capcom copies
// Desktop's layout once and owns the copy. See docs/adr/20261015-own-session-layout-seeded-from-desktop.md.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { seededAt: null, groups: [], pinned: [], assignments: {}, unarchived: [] };

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const refuse = (status, message) => Object.assign(new Error(message), { status });
const without = (assignments, id) => Object.fromEntries(Object.entries(assignments).filter(([key]) => key !== id));

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
      const { seededAt = null, groups = [], pinned = [], assignments = {}, unarchived = [], ...rest } = data ?? {};
      if (!isObject(data) || ![groups, pinned, unarchived].every(Array.isArray) || !isObject(assignments)) throw new Error('expected groups, pinned and unarchived as lists and assignments as an object');
      return { ...rest, seededAt, groups: groups.filter(g => g?.id), pinned, assignments, unarchived };
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

    // A session is in one place: a group, Pinned or neither. A group of null means ungrouped. Either way it leaves Pinned.
    move(id, group) {
      const layout = editable();
      if (group !== null && !layout.groups.some(g => g.id === group)) throw refuse(400, 'Unknown group.');
      const assignments = without(layout.assignments, id);
      write({ ...layout, pinned: layout.pinned.filter(p => p !== id), assignments: group ? { ...assignments, [id]: group } : assignments });
    },

    // Desktop's archive flag is read only, so a session that a message has brought back is remembered here instead.
    unarchive(id) {
      const layout = editable();
      if (!layout.unarchived.includes(id)) write({ ...layout, unarchived: [...layout.unarchived, id] });
    },

    // Pinning takes the session out of its group, as Desktop does.
    pin(id, pinned) {
      const layout = editable();
      if (typeof pinned !== 'boolean') throw refuse(400, 'Pinned or not?');
      write({
        ...layout,
        pinned: [...layout.pinned.filter(p => p !== id), ...(pinned ? [id] : [])],
        assignments: pinned ? without(layout.assignments, id) : layout.assignments,
      });
    },
  };
}
