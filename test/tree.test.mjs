// Run with `npm test`. The rules of the sidebar tree that need no page: where the arrow keys go, where a group can be moved,
// what the list shows once a session is archived, and which row takes the focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moveTargets, neighbour, nextStop, withoutRow } from '../public/ui/tree.js';

test('down and up step one stop, Home and End jump to the ends, and there is nothing past either end', () => {
  const from = (at, key) => nextStop(5, at, key);
  assert.equal(from(2, 'ArrowDown'), 3);
  assert.equal(from(2, 'ArrowUp'), 1);
  assert.equal(from(3, 'Home'), 0);
  assert.equal(from(1, 'End'), 4);
  assert.equal(from(4, 'ArrowDown'), -1);
  assert.equal(from(0, 'ArrowUp'), -1);
});

test('with no stop focused, down and up land on the start and no other key does anything', () => {
  assert.equal(nextStop(5, -1, 'ArrowDown', 3), 3);
  assert.equal(nextStop(5, -1, 'ArrowUp', 3), 3);
  assert.equal(nextStop(5, -1, 'ArrowDown'), 0);
  for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'Enter', 'a']) assert.equal(nextStop(5, -1, key), -1, key);
});

test('a key that is not for the walk goes nowhere, and neither does any key when the list has no stops', () => {
  for (const key of ['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Tab', 'constructor']) assert.equal(nextStop(5, 2, key), -1, key);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.equal(nextStop(0, -1, key), -1, key);
});

const PROJECTS = [{ id: 'cp-a', name: 'Capcom' }, { id: 'cp-b', name: 'Notes' }];

test('a group at the top level can go to any project, and one in a project can also go back to the top level', () => {
  assert.deepEqual(moveTargets(PROJECTS, { id: 'cg-a', project: null }), [{ label: 'Move to Capcom', project: 'cp-a' }, { label: 'Move to Notes', project: 'cp-b' }]);
  assert.deepEqual(moveTargets(PROJECTS, { id: 'cg-a', project: 'cp-a' }), [{ label: 'Move to top level', project: null }, { label: 'Move to Notes', project: 'cp-b' }]);
});

test('a group has nowhere to go with no project, and in the only project it can only leave', () => {
  assert.deepEqual(moveTargets([], { id: 'cg-a', project: null }), []);
  assert.deepEqual(moveTargets([PROJECTS[0]], { id: 'cg-a', project: 'cp-a' }), [{ label: 'Move to top level', project: null }]);
});

const row = (id, extra = {}) => ({ id, title: id, ...extra });
const LIST = {
  station: 'mac',
  problem: null,
  projects: [{ id: 'cp-a', name: 'Capcom' }],
  pinned: [row('p1', { pinned: true }), row('p2', { pinned: true })],
  groups: [{ id: 'cg-a', name: 'Work', project: 'cp-a', sessions: [row('g1'), row('g2')] }, { id: 'cg-b', name: 'Home', project: null, sessions: [] }],
  routines: [
    { name: 'nightly', latest: row('r3'), earlier: [row('r2'), row('r1')] },
    { name: 'weekly', latest: row('w1'), earlier: [] },
  ],
  started: [row('s1'), row('s2')],
  ungrouped: [row('u1'), row('u2')],
  other: [row('o1')],
};

const idsOf = ix => [ix.pinned, ...ix.groups.map(g => g.sessions), ix.started, ix.ungrouped, ix.other].map(list => list.map(r => r.id));

test('a session is taken out of the one list it is in, and the other lists are left as they were', () => {
  for (const id of ['p2', 'g1', 's2', 'u1', 'o1']) {
    const was = idsOf(LIST);
    assert.equal(was.filter(list => list.includes(id)).length, 1, `${id} is in one list`);
    assert.deepEqual(idsOf(withoutRow(LIST, id)), was.map(list => list.filter(i => i !== id)), id);
    assert.deepEqual(withoutRow(LIST, id).routines, LIST.routines, `${id} is in no routine`);
  }
});

test('the list keeps everything else it had, and the list it was given is not changed', () => {
  const { pinned, groups, routines, started, ungrouped, other, ...rest } = withoutRow(LIST, 'u1');
  assert.deepEqual(rest, { station: 'mac', problem: null, projects: [{ id: 'cp-a', name: 'Capcom' }] });
  assert.deepEqual(groups.map(({ sessions, ...group }) => group), LIST.groups.map(({ sessions, ...group }) => group));
  assert.deepEqual(idsOf(LIST), [['p1', 'p2'], ['g1', 'g2'], [], ['s1', 's2'], ['u1', 'u2'], ['o1']]);
});

test('the latest run of a routine is replaced by the next run, and an earlier run just goes', () => {
  const [nightly, weekly] = withoutRow(LIST, 'r3').routines;
  assert.deepEqual([nightly.name, nightly.latest.id, nightly.earlier.map(r => r.id)], ['nightly', 'r2', ['r1']]);
  assert.deepEqual(weekly, LIST.routines[1]);
  const [after] = withoutRow(LIST, 'r2').routines;
  assert.deepEqual([after.latest.id, after.earlier.map(r => r.id)], ['r3', ['r1']]);
});

test('a routine with one run is gone once that run is, and a session that is not in the list changes nothing', () => {
  assert.deepEqual(withoutRow(LIST, 'w1').routines.map(g => g.name), ['nightly']);
  assert.deepEqual(withoutRow(LIST, 'nobody'), LIST);
});

test('the focus goes to the next row, or to the one before when the row was the last', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(neighbour(ids, 'a'), 'b');
  assert.equal(neighbour(ids, 'b'), 'c');
  assert.equal(neighbour(ids, 'c'), 'b');
});

test('the focus has nowhere to go when the row was the only one or is not in the list', () => {
  assert.equal(neighbour(['a'], 'a'), null);
  assert.equal(neighbour(['a', 'b'], 'x'), null);
  assert.equal(neighbour([], 'a'), null);
});
