// Run with `npm test`. What Capcom keeps in marks.json about the chats it runs: the edge of each turn, when a page last had a chat open,
// what is unread and what failed. It is written through a temp file and kept small, and a mark that cannot be written costs one dot.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeMarks } from '../lib/marks.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-marks-test-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const DAY = 86400_000;
const NAMES = ['edges', 'seen', 'unread', 'errors'];

function folder(contents) {
  const dir = fs.mkdtempSync(path.join(base, 'state-'));
  const file = path.join(dir, 'marks.json');
  if (contents !== undefined) fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return { marks: makeMarks(dir), dir, file, onDisk: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

// Each map as a plain object, to compare.
const plain = marks => Object.fromEntries(Object.entries(marks.read()).map(([name, map]) => [name, Object.fromEntries(map)]));
const EMPTY = { edges: {}, seen: {}, unread: {}, errors: {} };

test('with no file the marks read as four empty maps, and reading writes nothing', () => {
  const f = folder();
  const read = f.marks.read();
  assert.deepEqual(Object.keys(read), NAMES);
  for (const name of NAMES) assert.ok(read[name] instanceof Map && read[name].size === 0, name);
  assert.equal(fs.existsSync(f.file), false);
});

test('a file that is not JSON, or holds the wrong shapes, reads as empty or as far as it makes sense, and the next write replaces it', () => {
  for (const contents of ['{ not json', '[]', 'null', '"text"', '']) assert.deepEqual(plain(folder(contents).marks), EMPTY, JSON.stringify(contents));
  const odd = folder({ edges: [1, 2], seen: 'later', unread: { a: 'soon', b: 5, c: null, d: Number.POSITIVE_INFINITY }, errors: { e: 7 } });
  assert.deepEqual(plain(odd.marks), { edges: {}, seen: {}, unread: { b: 5 }, errors: { e: 7 } }, 'only a time that is a number is kept');
  const broken = folder('{ not json');
  const at = Date.now();
  broken.marks.closed('a', at);
  assert.deepEqual(broken.onDisk(), { ...EMPTY, seen: { a: at } });
});

test('a turn starting records the edge and clears the error of the turn before, and leaves every other chat\'s marks', () => {
  const at = Date.now();
  const f = folder({ edges: { a: at - 5000, other: at - 9000 }, seen: { a: at - 3000 }, unread: { a: at - 4000 }, errors: { a: at - 4500, other: at - 9000 } });
  f.marks.started('a', at);
  assert.deepEqual(f.onDisk(), { edges: { a: at, other: at - 9000 }, seen: { a: at - 3000 }, unread: { a: at - 4000 }, errors: { other: at - 9000 } });
});

test('a turn ending records the edge, and marks the chat unread only when no page had it open', () => {
  const at = Date.now();
  const f = folder();
  f.marks.ended('quiet', at, false);
  f.marks.ended('watched', at + 1, true);
  assert.deepEqual(f.onDisk(), { ...EMPTY, edges: { quiet: at, watched: at + 1 }, unread: { quiet: at } });
});

test('a turn that failed records the error and leaves the edge as it was', () => {
  const at = Date.now();
  const f = folder({ edges: { a: at - 10 } });
  f.marks.failed('a', at);
  assert.deepEqual(f.onDisk(), { ...EMPTY, edges: { a: at - 10 }, errors: { a: at } });
});

test('a page opening a chat records it seen and clears its unread mark, and closing it records it seen again', () => {
  const at = Date.now();
  const f = folder({ unread: { a: at - 100, other: at - 100 } });
  f.marks.opened('a', at);
  assert.deepEqual(f.onDisk(), { ...EMPTY, seen: { a: at }, unread: { other: at - 100 } });
  f.marks.closed('a', at + 500);
  assert.deepEqual(f.onDisk(), { ...EMPTY, seen: { a: at + 500 }, unread: { other: at - 100 } });
});

test('a turn ending after the page closed the chat leaves it unread, later than the page last saw it', () => {
  const at = Date.now();
  const f = folder();
  f.marks.opened('a', at);
  f.marks.closed('a', at + 10);
  f.marks.ended('a', at + 20, false);
  const { seen, unread } = plain(f.marks);
  assert.ok(unread.a > seen.a);
});

test('a write goes to a temp file in the same folder and is renamed over marks.json, so a reader sees all of the old marks or all of the new', t => {
  const at = Date.now();
  const f = folder({ edges: { old: at - 1000 } });
  const before = fs.readFileSync(f.file, 'utf8');
  const original = fs.renameSync;
  const renames = [];
  t.mock.method(fs, 'renameSync', (from, to) => {
    renames.push({ from, to, target: fs.readFileSync(to, 'utf8'), temp: JSON.parse(fs.readFileSync(from, 'utf8')) });
    return original(from, to);
  });
  f.marks.closed('a', at);
  assert.equal(renames.length, 1);
  const [{ from, to, target, temp }] = renames;
  assert.equal(to, f.file);
  assert.equal(path.dirname(from), f.dir);
  assert.notEqual(from, f.file);
  assert.equal(target, before, 'until the rename the real file is untouched');
  assert.deepEqual(temp, { ...EMPTY, edges: { old: at - 1000 }, seen: { a: at } }, 'and the temp file already holds all of the new');
  assert.deepEqual(f.onDisk(), temp);
  assert.deepEqual(fs.readdirSync(f.dir), ['marks.json'], 'no temp file is left');
});

test('a state folder that is gone makes the write throw rather than make one', () => {
  const marks = makeMarks(path.join(base, 'no', 'such', 'folder'));
  assert.throws(() => marks.closed('a', Date.now()), { code: 'ENOENT' });
  assert.equal(fs.existsSync(path.join(base, 'no')), false);
});

test('a write drops what is older than 14 days, and keeps what is a moment younger', () => {
  const now = Date.now();
  const f = folder({
    edges: { stale: now - 15 * DAY, fresh: now - 13 * DAY },
    seen: { stale: now - 14 * DAY - 1000, fresh: now - 14 * DAY + 60_000 },
    unread: { stale: now - 30 * DAY },
    errors: { stale: now - 20 * DAY, fresh: now - DAY },
  });
  f.marks.closed('new', now);
  assert.deepEqual(f.onDisk(), {
    edges: { fresh: now - 13 * DAY },
    seen: { fresh: now - 14 * DAY + 60_000, new: now },
    unread: {},
    errors: { fresh: now - DAY },
  });
});

test('a write keeps the newest 1000 of each map and no more', () => {
  const now = Date.now();
  const crowd = offset => Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`chat-${i}`, now - offset - i * 1000]));
  const f = folder({ edges: crowd(0), seen: crowd(500), unread: crowd(0), errors: { one: now - 1000 } });
  f.marks.started('new', now);
  const out = f.onDisk();
  assert.deepEqual(NAMES.map(name => Object.keys(out[name]).length), [1000, 1000, 1000, 1]);
  assert.ok('new' in out.edges, 'the newest is kept');
  assert.ok('chat-998' in out.edges && !('chat-999' in out.edges), 'the oldest 201 of the 1201 go');
  assert.ok('chat-999' in out.seen && !('chat-1000' in out.seen), 'each map is cut on its own');
  assert.ok('chat-0' in out.unread && 'chat-999' in out.unread && !('chat-1000' in out.unread));
});

test('a mark for the same chat is replaced, not added, and the file stays valid JSON through a run of writes', () => {
  const f = folder();
  const at = Date.now();
  for (let i = 0; i < 25; i++) {
    f.marks.started('a', at + i * 2);
    f.marks.ended('a', at + i * 2 + 1, i % 2 === 0);
    assert.doesNotThrow(() => f.onDisk(), `after write ${i}`);
  }
  assert.deepEqual(Object.keys(f.onDisk().edges), ['a']);
  assert.equal(f.onDisk().edges.a, at + 48 + 1);
  assert.deepEqual(fs.readdirSync(f.dir), ['marks.json']);
});
