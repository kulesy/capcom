// Run with `npm test`. What Capcom reads of Claude Desktop's records and settings: the lineage rule that links a session to its parent,
// the sort key and the facts a row's mark is worked out from, how Desktop sorts each of its lists, and the unread and acknowledged
// marks in its Local Storage. Each test builds a made-up Desktop folder.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDesktop } from '../lib/desktop.mjs';
import { batch, logOf, set } from './leveldb-fixture.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-desktop-test-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const ORIGIN = 'https://claude.ai';
const GROUPS = { 'dframe-group-scopes': { scope: { groups: [{ id: 'cg-a', name: 'Alpha' }, { id: 'cg-b', name: 'Bravo' }] } } };

// A Desktop folder with a record for each of `records` and a settings file. `store` is a list of [key, value] for its Local Storage.
function folder({ records = [], prefs = GROUPS, store } = {}) {
  const dir = fs.mkdtempSync(path.join(base, 'desktop-'));
  const sessions = path.join(dir, 'claude-code-sessions', 'account', 'org');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(dir, 'claude_desktop_config.json'), JSON.stringify({ preferences: { epitaxyPrefs: prefs } }));
  for (const r of records) fs.writeFileSync(path.join(sessions, `${r.sessionId}.json`), JSON.stringify(r));
  if (store) {
    const leveldb = path.join(dir, 'Local Storage', 'leveldb');
    fs.mkdirSync(leveldb, { recursive: true });
    fs.writeFileSync(path.join(leveldb, '000003.log'), logOf([batch(1, ...store.map(([key, value]) => set(key, value, ORIGIN)))]));
  }
  return dir;
}

// A cache of 0 reads the folder again, which each test needs since each has its own.
const load = options => loadDesktop(folder(options), 0);
const rec = (id, fields = {}) => ({ sessionId: `local_${id}`, cliSessionId: id, title: id, cwd: '/work', lastActivityAt: 1000, ...fields });
const links = options => Object.fromEntries(load(options).links);
const recordOf = (desk, id) => desk.sessions.find(r => r.id === id);

const side = (parent, more = {}) => ({ spawnedFrom: { sessionId: `local_${parent}`, sideSession: true }, ...more });
const task = parent => ({ spawnedFrom: { sessionId: `local_${parent}` } });
const fork = parent => ({ forkedFromSessionId: `local_${parent}` });

test('a side session, a fork and a suggested task each link to the session they came from', () => {
  assert.deepEqual(links({ records: [rec('a'), rec('b', side('a')), rec('c', fork('a')), rec('d', task('a'))] }), { b: 'a', c: 'a', d: 'a' });
});

test('a fork wins over what a session was spawned from, unless the fork is that same parent or the parent it lost', () => {
  const lost = { spawnedFrom: { sessionId: 'local_a', sideSession: true, deletedParent: { sessionId: 'local_z' } }, ...fork('z') };
  assert.deepEqual(links({
    records: [
      rec('a'), rec('z'),
      rec('b', { ...side('a'), ...fork('z') }),
      rec('c', { ...side('a'), ...fork('a') }),
      rec('d', lost),
      rec('e', { ...task('a'), ...fork('z') }),
    ],
  }), { b: 'z', c: 'a', d: 'a', e: 'z' });
});

test('a record that is detached, or that is a user\'s fork, links to nothing', () => {
  assert.deepEqual(links({
    records: [
      rec('a'), rec('z'),
      rec('cut', { ...side('a'), lineageDetached: true }),
      rec('cutfork', { ...fork('a'), lineageDetached: true }),
      rec('kept', { ...side('a'), lineageDetached: false }),
      rec('user', { spawnedFrom: { sessionId: 'local_a', userFork: true } }),
      rec('usersde', { spawnedFrom: { sessionId: 'local_a', sideSession: true, userFork: true }, ...fork('z') }),
      rec('notuser', { spawnedFrom: { sessionId: 'local_a', userFork: false } }),
    ],
  }), { kept: 'a', notuser: 'a' });
});

test('a link to itself is no link, and a record that links to itself in one way still has the other', () => {
  assert.deepEqual(links({
    records: [
      rec('a'),
      rec('selfspawn', { spawnedFrom: { sessionId: 'local_selfspawn', sideSession: true } }),
      rec('selffork', fork('selffork')),
      rec('mixed', { spawnedFrom: { sessionId: 'local_mixed' }, ...fork('a') }),
      rec('other', { ...fork('other'), ...task('a') }),
    ],
  }), { mixed: 'a', other: 'a' });
});

test('a parent with no record, or a record with no CLI session, leaves the child with no link', () => {
  assert.deepEqual(links({
    records: [
      rec('a'),
      { sessionId: 'local_nocli', title: 'No CLI session yet' },
      rec('orphan', side('nobody')),
      rec('stuck', task('nocli')),
      rec('fine', side('a')),
    ],
  }), { fine: 'a' });
});

test('an id that is not a string is no link', () => {
  assert.deepEqual(links({
    records: [
      rec('a'),
      rec('num', { spawnedFrom: { sessionId: 5, sideSession: true } }),
      rec('list', { spawnedFrom: { sessionId: ['local_a'] } }),
      rec('forknum', { forkedFromSessionId: 7 }),
      rec('forkempty', { forkedFromSessionId: '' }),
      rec('spawnnull', { spawnedFrom: null }),
      rec('spawntext', { spawnedFrom: 'local_a' }),
    ],
  }), {});
});

// Record A has no link. B is a suggested task from A. C is spawned from A but detached in Desktop, so it stays at the top level. D and E
// are suggested tasks from C that were not detached, so they nest under C, which heads a family of its own.
test('a detached session keeps the sessions that came from it, so a family can head from a session that left another', () => {
  assert.deepEqual(links({
    records: [
      rec('A'),
      rec('B', task('A')),
      rec('C', { ...task('A'), lineageDetached: true }),
      rec('D', { ...task('C'), lineageDetached: false }),
      rec('E', task('C')),
    ],
  }), { B: 'A', D: 'C', E: 'C' });
});

test('a record carries its created time, its sort key and what its mark is worked out from, and keeps its last activity', () => {
  const desk = load({ records: [rec('a', { createdAt: 500, lastTurnEdgeAt: 3000, lastActivityAt: 2000, postTurnSummary: { status_category: 'need_input' }, error: 'The turn failed.', errorAt: 2500 })] });
  const a = recordOf(desk, 'a');
  assert.deepEqual([a.createdAt, a.sortKey, a.lastActivityAt, a.verdict, a.error, a.errorAt], [500, 3000, 2000, 'need_input', true, 2500]);
});

test('the sort key is the last turn edge, else the last activity, else the created time, and a time of zero is still a time', () => {
  const desk = load({
    records: [
      rec('edge', { lastTurnEdgeAt: 7000, lastActivityAt: 5000, createdAt: 3000 }),
      rec('activity', { lastActivityAt: 5000, createdAt: 3000 }),
      rec('created', { lastActivityAt: undefined, createdAt: 3000 }),
      rec('nothing', { lastActivityAt: undefined }),
      rec('zero', { lastTurnEdgeAt: 0, lastActivityAt: 5000 }),
      rec('text', { lastTurnEdgeAt: '2026-10-01T00:00:00.000Z', lastActivityAt: 5000 }),
    ],
  });
  assert.deepEqual(Object.fromEntries(desk.sessions.map(r => [r.id, r.sortKey])), { edge: 7000, activity: 5000, created: 3000, nothing: 0, zero: 0, text: Date.parse('2026-10-01T00:00:00.000Z') });
  assert.equal(recordOf(desk, 'created').lastActivityAt, 3000, 'the last activity falls back to the created time as it did');
});

test('a record without the facts reads as none: no verdict, no error and no created time', () => {
  const desk = load({
    records: [
      rec('plain'),
      rec('odd', { postTurnSummary: { status_category: 5 }, error: true, errorAt: 'soon' }),
      rec('empty', { postTurnSummary: null, error: '' }),
    ],
  });
  for (const id of ['plain', 'odd', 'empty']) {
    const r = recordOf(desk, id);
    assert.deepEqual([r.createdAt, r.verdict, r.error, r.errorAt], [0, null, false, 0], id);
  }
});

const section = (id, kind, sortBy, ascending) => ({ id, kind, sortBy, ascending });
const SECTIONS = [
  section('pinned', 'pinned', 'alpha', false),
  section('cg-a', 'manual', 'created', true),
  section('cg-b', 'manual', 'recency', false),
  section('routines', 'routines', 'recency', true),
  section('loose', 'sessions', 'alpha', true),
];

test('each list sorts as the Desktop section it comes from does: pinned, each group by its id, routines and the loose list', () => {
  const { sorts } = load({ prefs: { ...GROUPS, 'dframe-code-sections': { scope: { sections: SECTIONS } } } });
  assert.deepEqual(
    { pinned: sorts.pinned, routines: sorts.routines, sessions: sorts.sessions, groups: Object.fromEntries(sorts.groups) },
    {
      pinned: { by: 'alpha', ascending: false },
      routines: { by: 'recency', ascending: true },
      sessions: { by: 'alpha', ascending: true },
      groups: { 'cg-a': { by: 'created', ascending: true }, 'cg-b': { by: 'recency', ascending: false } },
    },
  );
});

test('a sort Capcom does not know goes by recency, and an ascending that is not true is not ascending', () => {
  const { sorts } = load({
    prefs: {
      ...GROUPS,
      'dframe-code-sections': { scope: { sections: [section('pinned', 'pinned', 'manual', true), section('cg-a', 'manual', undefined, undefined), section('routines', 'routines', 'created', 'yes'), section('loose', 'sessions', 5, 1)] } },
    },
  });
  assert.deepEqual(sorts.pinned, { by: 'recency', ascending: true }, 'an unknown sort keeps the direction it was given');
  assert.deepEqual(sorts.groups.get('cg-a'), { by: 'recency', ascending: false });
  assert.deepEqual(sorts.routines, { by: 'created', ascending: false });
  assert.deepEqual(sorts.sessions, { by: 'recency', ascending: false });
});

test('the sections of the scope that holds the groups are the ones used, and otherwise the first scope that has sections', () => {
  const other = [section('pinned', 'pinned', 'created', false)];
  const mine = [section('pinned', 'pinned', 'alpha', true)];
  const used = options => load({ prefs: { ...GROUPS, 'dframe-code-sections': options } }).sorts.pinned;
  assert.deepEqual(used({ elsewhere: { sections: other }, scope: { sections: mine } }), { by: 'alpha', ascending: true }, 'the scope of the groups, though it comes second');
  assert.deepEqual(used({ elsewhere: { sections: other }, scope: {} }), { by: 'created', ascending: false }, 'the groups\' scope has none');
  assert.deepEqual(used({ first: { sections: 'no' }, second: { sections: other } }), { by: 'created', ascending: false }, 'a scope whose sections are not a list is passed over');
  assert.equal(used({ elsewhere: {}, scope: { sections: [] } }), null, 'a list with no section for pinned');
});

test('with no sections at all every list has no sort, and so does a section that is not an object or has no id', () => {
  const none = load({}).sorts;
  assert.deepEqual([none.pinned, none.routines, none.sessions, none.groups.size], [null, null, null, 0]);
  const odd = load({ prefs: { ...GROUPS, 'dframe-code-sections': { scope: { sections: [null, 'pinned', section(undefined, 'manual', 'alpha', false), section('x', 'weird', 'alpha', false), 7] } } } }).sorts;
  assert.deepEqual([odd.pinned, odd.routines, odd.sessions, odd.groups.size], [null, null, null, 0]);
});

test('the first section of a kind is the one used', () => {
  const { sorts } = load({ prefs: { ...GROUPS, 'dframe-code-sections': { scope: { sections: [section('p1', 'pinned', 'alpha', false), section('p2', 'pinned', 'created', true), section('cg-a', 'manual', 'alpha', false), section('cg-a', 'manual', 'created', true)] } } } });
  assert.deepEqual(sorts.pinned, { by: 'alpha', ascending: false });
  assert.deepEqual(sorts.groups.get('cg-a'), { by: 'alpha', ascending: false });
});

test('a settings file with no groups says why and still gives the records', () => {
  const dir = folder({ records: [rec('a')], prefs: {} });
  const desk = loadDesktop(dir, 0);
  assert.match(desk.problem, /Desktop groups unavailable/);
  assert.equal(desk.sessions.length, 1);
  assert.deepEqual([desk.sorts.pinned, desk.sorts.groups.size], [null, 0]);
});

const stored = (unread, acked, extra = []) => [
  ...(unread ? [['epitaxy-unread-v1', JSON.stringify({ state: { unreadIds: unread, explicitUnreadIds: extra }, version: 0 })]] : []),
  ...(acked ? [['epitaxy-awaiting-ack-v1', JSON.stringify({ state: { ackedAt: acked }, version: 0 })]] : []),
];

test('the sessions Desktop marks unread, and when it last acknowledged each, come from its Local Storage', () => {
  const desk = load({ store: stored(['local_a', 'local_b'], { local_a: 5000, local_c: 9000 }, ['local_d']) });
  assert.deepEqual([...desk.unread].sort(), ['local_a', 'local_b']);
  assert.deepEqual(Object.fromEntries(desk.acked), { local_a: 5000, local_c: 9000 });
  assert.equal(desk.problem, null);
});

test('with no Local Storage, or one with neither key, both are empty and nothing is wrong', () => {
  for (const options of [{}, { store: [] }, { store: [['unrelated', 'x']] }]) {
    const desk = load({ records: [rec('a')], ...options });
    assert.deepEqual([desk.unread.size, desk.acked.size, desk.problem], [0, 0, null], JSON.stringify(options));
  }
});

test('a key that is absent leaves the other to be read, and the other origin\'s keys are not Desktop\'s', () => {
  const unreadOnly = load({ store: stored(['local_a'], null) });
  assert.deepEqual([[...unreadOnly.unread], unreadOnly.acked.size], [['local_a'], 0]);
  const ackOnly = load({ store: stored(null, { local_a: 5000 }) });
  assert.deepEqual([ackOnly.unread.size, [...ackOnly.acked]], [0, [['local_a', 5000]]]);
  const dir = folder();
  const leveldb = path.join(dir, 'Local Storage', 'leveldb');
  fs.mkdirSync(leveldb, { recursive: true });
  fs.writeFileSync(path.join(leveldb, '000003.log'), logOf([batch(1, set('epitaxy-unread-v1', JSON.stringify({ state: { unreadIds: ['local_a'] } }), 'https://elsewhere.test'))]));
  assert.equal(loadDesktop(dir, 0).unread.size, 0);
});

test('values that do not parse, or are the wrong shape, leave both empty without a problem, and keep what is usable', () => {
  const garbled = load({ store: [['epitaxy-unread-v1', 'not json'], ['epitaxy-awaiting-ack-v1', '{"state":']] });
  assert.deepEqual([garbled.unread.size, garbled.acked.size, garbled.problem], [0, 0, null]);
  const shapes = load({ store: [['epitaxy-unread-v1', JSON.stringify({ state: { unreadIds: 'local_a' } })], ['epitaxy-awaiting-ack-v1', JSON.stringify({ state: { ackedAt: [1, 2] } })]] });
  assert.deepEqual([shapes.unread.size, shapes.acked.size], [0, 0]);
  const mixed = load({ store: stored(['local_a', 5, null, 'local_b'], { local_a: 'later', local_b: 7, local_c: null }) });
  assert.deepEqual([...mixed.unread], ['local_a', 'local_b']);
  assert.deepEqual([...mixed.acked], [['local_b', 7]]);
  const bare = load({ store: [['epitaxy-unread-v1', 'null'], ['epitaxy-awaiting-ack-v1', '{}']] });
  assert.deepEqual([bare.unread.size, bare.acked.size], [0, 0]);
});

test('the marks are read with the rest, inside the same cache', () => {
  const dir = folder({ records: [rec('a')], store: stored(['local_a'], null) });
  const first = loadDesktop(dir, 0);
  assert.deepEqual([...first.unread], ['local_a']);
  fs.rmSync(path.join(dir, 'Local Storage'), { recursive: true });
  assert.equal(loadDesktop(dir), first, 'within the cache, the answer is the one given before');
  assert.deepEqual([...loadDesktop(dir, 0).unread], [], 'and once it has run out the store is read again');
});
