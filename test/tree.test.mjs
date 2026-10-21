// Run with `npm test`. The rules of the sidebar tree that need no page: where the arrow keys go, where a group or a session can be
// moved, what the list shows once a session is archived, which row takes the focus, and which session Cmd+A archives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveTarget, LOOSE_HOME, LOOSE_NAMES, looseHome, moveTargets, neighbour, nextStop, sessionTargets, withoutRow } from '../public/ui/tree.js';

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

test('a group in Home can go to any project, and one in a project can also go back to Home', () => {
  assert.deepEqual(moveTargets(PROJECTS, { id: 'cg-a', project: null }), [{ label: 'Move to Capcom', project: 'cp-a' }, { label: 'Move to Notes', project: 'cp-b' }]);
  assert.deepEqual(moveTargets(PROJECTS, { id: 'cg-a', project: 'cp-a' }), [{ label: 'Move to Home', project: null }, { label: 'Move to Notes', project: 'cp-b' }]);
});

test('a group has nowhere to go with no project, and in the only project it can only leave', () => {
  assert.deepEqual(moveTargets([], { id: 'cg-a', project: null }), []);
  assert.deepEqual(moveTargets([PROJECTS[0]], { id: 'cg-a', project: 'cp-a' }), [{ label: 'Move to Home', project: null }]);
});

const PLACES = {
  projects: [{ id: 'cp-a', name: 'Capcom' }, { id: 'cp-b', name: 'Notes' }, { id: 'cp-c', name: 'Solo' }],
  groups: [
    { id: 'cg-1', name: 'Work', project: 'cp-a' },
    { id: 'cg-2', name: 'Home', project: null },
    { id: 'cg-3', name: 'Ideas', project: 'cp-b' },
    { id: 'cg-4', name: 'Review', project: 'cp-a' },
    { id: 'cg-5', name: 'Only', project: 'cp-c' },
    { id: 'cg-6', name: 'Later', project: null },
  ],
};
const WORK = { group: 'Capcom', items: [{ label: 'Work', section: 'cg-1' }, { label: 'Review', section: 'cg-4' }] };
const IDEAS = { group: 'Notes', items: [{ label: 'Ideas', section: 'cg-3' }] };
const ONLY = { group: 'Solo', items: [{ label: 'Only', section: 'cg-5' }] };
const TOP = [{ label: 'Home', section: 'cg-2' }, { label: 'Later', section: 'cg-6' }];
const PINNED = { label: 'Pinned', section: 'pinned' };
const ROUTINES = { label: 'Routines', section: 'routines' };
const targets = (extra = {}) => sessionTargets(PLACES, { id: 'x', source: 'desktop', group: null, pinned: false, routine: null, ...extra });

test('a session leaves for the loose list of the app it came from, and a routine run has no loose list', () => {
  assert.deepEqual(LOOSE_HOME, { capcom: 'started', desktop: 'ungrouped', cli: 'other' });
  assert.deepEqual(LOOSE_NAMES, { started: 'Started here', ungrouped: 'Ungrouped', other: 'Terminal and other' });
  assert.deepEqual(['capcom', 'desktop', 'cli'].map(source => looseHome({ source, routine: null })), ['started', 'ungrouped', 'other']);
  assert.equal(looseHome({ source: 'desktop', routine: 'nightly' }), null);
});

test('a loose session can go to Pinned, then each project\'s groups under the project, then the top-level groups, and not back where it is', () => {
  assert.deepEqual(targets(), [PINNED, WORK, IDEAS, ONLY, ...TOP]);
  assert.deepEqual(targets({ source: 'capcom' }), [PINNED, WORK, IDEAS, ONLY, ...TOP]);
  assert.deepEqual(targets({ source: 'cli' }), [PINNED, WORK, IDEAS, ONLY, ...TOP]);
});

test('a session in a group can go to every place but that group, and back to the loose list of the app it came from', () => {
  assert.deepEqual(targets({ group: 'cg-4' }), [PINNED, { group: 'Capcom', items: [WORK.items[0]] }, IDEAS, ONLY, ...TOP, { label: 'Ungrouped', section: 'ungrouped' }]);
  assert.deepEqual(targets({ group: 'cg-2', source: 'capcom' }), [PINNED, WORK, IDEAS, ONLY, TOP[1], { label: 'Started here', section: 'started' }]);
  assert.deepEqual(targets({ group: 'cg-6', source: 'cli' }).at(-1), { label: 'Terminal and other', section: 'other' });
});

test('a pinned session has no Pinned to go to, and can go to every group and back to its loose list', () => {
  assert.deepEqual(targets({ pinned: true }), [WORK, IDEAS, ONLY, ...TOP, { label: 'Ungrouped', section: 'ungrouped' }]);
  assert.deepEqual(targets({ pinned: true, group: 'cg-1' }), [WORK, IDEAS, ONLY, ...TOP, { label: 'Ungrouped', section: 'ungrouped' }], 'a pinned session shows in Pinned, not in the group it was left assigned to');
});

test('a project is left out when the only group it has is the session\'s own', () => {
  assert.deepEqual(targets({ group: 'cg-5', source: 'capcom' }), [PINNED, WORK, IDEAS, ...TOP, { label: 'Started here', section: 'started' }]);
});

test('a routine run in a group or pinned can also go back to Routines, which comes first, and has no loose list to go to', () => {
  assert.deepEqual(targets({ routine: 'nightly', group: 'cg-1' }), [ROUTINES, PINNED, { group: 'Capcom', items: [WORK.items[1]] }, IDEAS, ONLY, ...TOP]);
  assert.deepEqual(targets({ routine: 'nightly', pinned: true }), [ROUTINES, WORK, IDEAS, ONLY, ...TOP]);
});

test('a routine run that is neither in a group nor pinned is already under its routine', () => {
  assert.deepEqual(targets({ routine: 'nightly' }), [PINNED, WORK, IDEAS, ONLY, ...TOP]);
});

test('with no projects or groups a session can only be pinned or unpinned, and one with nowhere to go has no targets', () => {
  const bare = { projects: [], groups: [] };
  assert.deepEqual(sessionTargets(bare, { id: 'x', source: 'desktop', group: null, pinned: false, routine: null }), [PINNED]);
  assert.deepEqual(sessionTargets(bare, { id: 'x', source: 'desktop', group: null, pinned: true, routine: null }), [{ label: 'Ungrouped', section: 'ungrouped' }]);
  assert.deepEqual(sessionTargets(bare, { id: 'x', source: 'unknown', group: null, pinned: true, routine: null }), []);
});

test('the targets are plain data and the list they were made from is not changed', () => {
  const before = JSON.stringify(PLACES);
  const made = targets({ group: 'cg-1' });
  assert.deepEqual(JSON.parse(JSON.stringify(made)), made);
  assert.equal(JSON.stringify(PLACES), before);
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

const LISTED = ['a', 'b', 'c'];
const target = facts => archiveTarget({ listed: id => LISTED.includes(id), ...facts });

test('with nothing open the key archives the row showing the focus ring, and that row beats the open session', () => {
  assert.deepEqual(target({ ringed: 'a' }), { id: 'a' });
  assert.deepEqual(target({ ringed: 'a', current: 'b' }), { id: 'a' });
});

test('with no ring the key archives the open session', () => {
  assert.deepEqual(target({ current: 'b' }), { id: 'b' });
  assert.deepEqual(target({ ringed: null, current: 'b' }), { id: 'b' });
});

test('a row or an open session that is not listed is no target, so the browser keeps the key', () => {
  assert.equal(target({ current: 'gone' }), null);
  assert.equal(target({ ringed: 'gone', current: 'b' }), null);
});

test('with no ring and no open session there is nothing to archive and the browser keeps the key', () => {
  assert.equal(target({}), null);
  assert.equal(target({ ringed: null, current: null }), null);
});

test('a row menu names its own row, ahead of the ring and the open session', () => {
  assert.deepEqual(target({ menu: { session: 'c' }, ringed: 'a', current: 'b' }), { id: 'c' });
});

test('a header or plus menu takes the key and archives nothing, and so does a row menu whose row has gone', () => {
  assert.deepEqual(target({ menu: {}, ringed: 'a', current: 'b' }), { id: null });
  assert.deepEqual(target({ menu: { session: null }, current: 'b' }), { id: null });
  assert.deepEqual(target({ menu: { session: 'gone' }, current: 'b' }), { id: null });
});

test('a form or confirm in the list keeps the key, whatever else could be archived', () => {
  assert.equal(target({ form: true, ringed: 'a', current: 'b' }), null);
  assert.equal(target({ form: true, current: 'b' }), null);
});

test('anything modal keeps the key, even with a menu open behind it', () => {
  assert.equal(target({ modal: true, ringed: 'a', current: 'b' }), null);
  assert.equal(target({ modal: true, menu: { session: 'c' }, form: true, ringed: 'a', current: 'b' }), null);
});

test('a ring on a header or a button in the list takes the key and archives nothing, so a press too many spares the open session', () => {
  assert.deepEqual(target({ ringedOther: true, current: 'b' }), { id: null });
  assert.deepEqual(target({ ringedOther: true }), { id: null });
});

test('a menu, a form and anything modal each come before a ring on a header or a button', () => {
  assert.deepEqual(target({ menu: { session: 'c' }, ringedOther: true, current: 'b' }), { id: 'c' });
  assert.equal(target({ form: true, ringedOther: true, current: 'b' }), null);
  assert.equal(target({ modal: true, ringedOther: true, current: 'b' }), null);
});
