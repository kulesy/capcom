// What only Capcom knows about the chats it runs, in marks.json in its state folder: `edges`, `seen`, `unread` and `errors`, each a time
// in milliseconds by CLI session id. docs/adr/20261022-list-order-and-row-marks.md says what each means.
import fs from 'node:fs';
import path from 'node:path';

const KEEP_MS = 14 * 86400_000;
const KEEP = 1000;
const MAPS = ['edges', 'seen', 'unread', 'errors'];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// The newest entries that are not too old, so the file stays small however many chats Capcom has run.
const newest = (map, now) => Object.fromEntries([...map].filter(([, at]) => now - at < KEEP_MS).sort((a, b) => b[1] - a[1]).slice(0, KEEP));

export function makeMarks(stateDir) {
  const file = path.join(stateDir, 'marks.json');

  // Each map as a Map of id to time. The file is read each time, and one that cannot be read counts as empty and is replaced by the next
  // write, since a mark is only a hint for the list and the turns that follow write it again.
  function read() {
    let data = null;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* an empty list of marks */ }
    return Object.fromEntries(MAPS.map(name => [name, new Map(isObject(data?.[name]) ? Object.entries(data[name]).filter(([, at]) => Number.isFinite(at)) : [])]));
  }

  function change(edit) {
    const marks = read();
    edit(marks);
    const now = Date.now();
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(Object.fromEntries(MAPS.map(name => [name, newest(marks[name], now)])), null, 2)}\n`);
    fs.renameSync(temp, file);
  }

  return {
    read,

    // A turn began in a chat Capcom runs, which clears the error of the turn before.
    started: (id, at) => change(m => { m.edges.set(id, at); m.errors.delete(id); }),

    // A turn ended. With no page open on the chat it is unread until a page opens it.
    ended: (id, at, watched) => change(m => { m.edges.set(id, at); if (!watched) m.unread.set(id, at); }),

    failed: (id, at) => change(m => { m.errors.set(id, at); }),

    // A page opened the chat, which reads it, or closed it.
    opened: (id, at) => change(m => { m.seen.set(id, at); m.unread.delete(id); }),
    closed: (id, at) => change(m => { m.seen.set(id, at); }),
  };
}
