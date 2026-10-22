// Run with `npm test`. The rules of the sidebar tree that need no page: where the arrow keys go, where a group or a session can be
// moved or nested, what the list shows once a session is archived, moved or nested, which row takes the focus, and which session Cmd+A
// archives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveTarget, everyRow, findRow, LOOSE_HOME, LOOSE_NAMES, looseHome, moveTargets, neighbour, nestRow, nestTargets, nextStop, placeRow, rootOf, sessionTargets, unnestRow, withKids, withoutRow } from '../public/ui/tree.js';

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

const person = (id, extra = {}) => ({ id, title: id, source: 'desktop', routine: null, group: null, pinned: false, lastActivityAt: 0, ...extra });
const kid = (id, parent, extra = {}) => person(id, { parent, ...extra });
// Work holds g1 with two children, Pinned holds p1 with one, and the loose list holds two sessions with none.
const FAM = {
  station: 'mac',
  problem: null,
  projects: [],
  pinned: [person('p1', { pinned: true, lastActivityAt: 50, children: [kid('pk', 'p1', { pinned: true, lastActivityAt: 40 })] })],
  groups: [
    { id: 'cg-a', name: 'Work', project: null, sessions: [person('g1', { group: 'cg-a', children: [kid('k1', 'g1', { group: 'cg-a' }), kid('k2', 'g1', { group: 'cg-a' })] }), person('g2', { group: 'cg-a' })] },
    { id: 'cg-b', name: 'Home', project: null, sessions: [] },
  ],
  routines: [{ name: 'nightly', latest: person('r1', { routine: 'nightly' }), earlier: [] }],
  started: [],
  ungrouped: [person('u1', { lastActivityAt: 30 }), person('u2', { lastActivityAt: 20 })],
  other: [],
};

// A list as ids, each session with its children after it in brackets.
const describe = r => (r.children ? `${r.id}[${r.children.map(c => c.id).join(',')}]` : r.id);
const shapeOf = ix => ({ pinned: ix.pinned.map(describe), groups: Object.fromEntries(ix.groups.map(g => [g.id, g.sessions.map(describe)])), ungrouped: ix.ungrouped.map(describe) });
const work = ix => shapeOf(ix).groups['cg-a'];

test('a nested session is found like any other, and its root is the session it shows under', () => {
  assert.deepEqual(everyRow(FAM).map(r => r.id).sort(), ['g1', 'g2', 'k1', 'k2', 'p1', 'pk', 'r1', 'u1', 'u2']);
  assert.deepEqual(withKids([FAM.pinned[0], person('x')]).map(r => r.id), ['p1', 'pk', 'x']);
  assert.equal(findRow(FAM, 'k1').parent, 'g1');
  assert.equal(findRow(FAM, 'nobody'), null);
  assert.equal(findRow(null, 'k1'), null);
  assert.deepEqual(['k1', 'g1', 'pk', 'u1'].map(id => rootOf(FAM, id).id), ['g1', 'g1', 'p1', 'u1']);
  assert.equal(rootOf(FAM, 'nobody'), null);
});

test('a session taken out hands the sessions nested under it to its list, in the order that list keeps', () => {
  const out = withoutRow(FAM, 'g1');
  assert.deepEqual(work(out), ['g2', 'k1', 'k2']);
  assert.deepEqual(out.groups[0].sessions.map(r => r.parent ?? null), [null, null, null]);
  assert.deepEqual(shapeOf(withoutRow(FAM, 'p1')).pinned, ['pk']);
  assert.deepEqual(work(withoutRow(FAM, 'g1', { withChildren: true })), ['g2'], 'with `withChildren` they go with it');
});

test('a nested session leaves its parent, and a parent with no child left has no children list', () => {
  const one = withoutRow(FAM, 'k1');
  assert.deepEqual(work(one), ['g1[k2]', 'g2']);
  const none = withoutRow(one, 'k2');
  assert.deepEqual(work(none), ['g1', 'g2']);
  assert.equal('children' in none.groups[0].sessions[0], false);
});

test('a dropped parent takes its children along, in the place it is dropped on', () => {
  const home = placeRow(FAM, 'g1', 'cg-b');
  assert.deepEqual(shapeOf(home).groups, { 'cg-a': ['g2'], 'cg-b': ['g1[k1,k2]'] });
  assert.deepEqual(home.groups[1].sessions[0].children.map(c => [c.group, c.pinned, c.parent]), [['cg-b', false, 'g1'], ['cg-b', false, 'g1']]);
  const pinned = placeRow(FAM, 'g1', 'pinned');
  assert.deepEqual(shapeOf(pinned).pinned, ['p1[pk]', 'g1[k1,k2]']);
  assert.deepEqual(pinned.pinned[1].children.map(c => [c.group, c.pinned]), [[null, true], [null, true]]);
});

test('a dropped nested session leaves its parent and shows in the section, even the section its family is in', () => {
  const elsewhere = placeRow(FAM, 'k1', 'cg-b');
  assert.deepEqual(shapeOf(elsewhere).groups, { 'cg-a': ['g1[k2]', 'g2'], 'cg-b': ['k1'] });
  assert.deepEqual([elsewhere.groups[1].sessions[0].parent, elsewhere.groups[1].sessions[0].group], [null, 'cg-b']);
  assert.deepEqual(work(placeRow(FAM, 'k1', 'cg-a')), ['g1[k2]', 'g2', 'k1']);
  assert.deepEqual(shapeOf(placeRow(FAM, 'k1', 'other')).ungrouped, ['u1', 'u2', 'k1'], 'a loose list sends it to the one of its own app');
});

test('a session dropped where it already is changes nothing, but a nested one is never in place', () => {
  for (const [id, section] of [['g2', 'cg-a'], ['p1', 'pinned'], ['u1', 'ungrouped'], ['nobody', 'pinned']]) assert.equal(placeRow(FAM, id, section), FAM, `${id} on ${section}`);
  for (const [id, section] of [['k1', 'cg-a'], ['pk', 'pinned']]) assert.notEqual(placeRow(FAM, id, section), FAM, `${id} on ${section}`);
});

test('a session nested under another leaves its list and joins the other\'s children, in the other\'s place', () => {
  const nested = nestRow(FAM, 'u1', 'g1');
  assert.deepEqual(shapeOf(nested), { pinned: ['p1[pk]'], groups: { 'cg-a': ['g1[k1,k2,u1]', 'g2'], 'cg-b': [] }, ungrouped: ['u2'] });
  const joined = nested.groups[0].sessions[0].children.at(-1);
  assert.deepEqual([joined.parent, joined.group, joined.pinned], ['g1', 'cg-a', false]);

  const pinned = nestRow(FAM, 'u1', 'p1');
  assert.deepEqual(shapeOf(pinned).pinned, ['p1[pk,u1]'], 'children of a pinned session go newest first');
  assert.deepEqual([pinned.pinned[0].children[1]].map(c => [c.parent, c.group, c.pinned]), [['p1', null, true]]);
});

test('a parent nests with its children, all under the new parent, and a drop on a nested session nests under that session\'s parent', () => {
  const nested = nestRow(FAM, 'g1', 'g2');
  assert.deepEqual(work(nested), ['g2[g1,k1,k2]']);
  assert.deepEqual(nested.groups[0].sessions[0].children.map(c => [c.parent, 'children' in c]), [['g2', false], ['g2', false], ['g2', false]]);
  assert.deepEqual(work(nestRow(FAM, 'u1', 'k1')), ['g1[k1,k2,u1]', 'g2']);
});

test('a nested session moves from one parent to another', () => {
  assert.deepEqual(work(nestRow(FAM, 'k1', 'g2')), ['g1[k2]', 'g2[k1]']);
});

test('nesting changes nothing when the session is nested there already, would go under itself or its own child, or is not in the list', () => {
  for (const [id, parent] of [['k1', 'g1'], ['k1', 'k2'], ['g1', 'g1'], ['g1', 'k1'], ['nobody', 'g1'], ['u1', 'nobody']]) assert.equal(nestRow(FAM, id, parent), FAM, `${id} under ${parent}`);
});

test('a session taken out of its parent shows in the list its parent is in, and one that is not nested changes nothing', () => {
  const out = unnestRow(FAM, 'k1');
  assert.deepEqual(work(out), ['g1[k2]', 'g2', 'k1']);
  assert.equal(out.groups[0].sessions[2].parent, null);
  assert.deepEqual(shapeOf(unnestRow(FAM, 'pk')).pinned, ['p1', 'pk']);
  assert.equal(unnestRow(FAM, 'g2'), FAM);
  assert.equal(unnestRow(FAM, 'nobody'), FAM);
});

// Ungrouped holds a parent with a child from each app that starts sessions, and a routine run. Started here holds one session already.
const LOOSE_FAM = {
  ...FAM,
  started: [person('s1', { source: 'capcom', lastActivityAt: 100 })],
  ungrouped: [person('lp', { lastActivityAt: 90, children: [
    kid('ld', 'lp', { lastActivityAt: 80 }),
    kid('lc', 'lp', { source: 'capcom', lastActivityAt: 70 }),
    kid('lt', 'lp', { source: 'cli', lastActivityAt: 60 }),
    kid('lr', 'lp', { routine: 'nightly', lastActivityAt: 50 }),
  ] })],
};
const loose = ix => ({ started: ix.started.map(describe), ungrouped: ix.ungrouped.map(describe), other: ix.other.map(describe) });

test('a session taken out of a loose parent shows in the loose list of the app it came from, which is not always its parent\'s', () => {
  assert.deepEqual(loose(unnestRow(LOOSE_FAM, 'ld')), { started: ['s1'], ungrouped: ['lp[lc,lt,lr]', 'ld'], other: [] });
  assert.deepEqual(loose(unnestRow(LOOSE_FAM, 'lc')), { started: ['s1', 'lc'], ungrouped: ['lp[ld,lt,lr]'], other: [] });
  assert.deepEqual(loose(unnestRow(LOOSE_FAM, 'lt')), { started: ['s1'], ungrouped: ['lp[ld,lc,lr]'], other: ['lt'] });
  assert.deepEqual([unnestRow(LOOSE_FAM, 'lc').started[1].parent, unnestRow(LOOSE_FAM, 'lc').started[1].source], [null, 'capcom']);
});

test('a routine run taken out of a loose parent shows in no list until the list is loaded again, and never in a wrong one', () => {
  const out = unnestRow(LOOSE_FAM, 'lr');
  assert.deepEqual(loose(out), { started: ['s1'], ungrouped: ['lp[ld,lc,lt]'], other: [] });
  assert.deepEqual(out.routines, LOOSE_FAM.routines);
  assert.equal(findRow(out, 'lr'), null);
});

test('a session taken out of a parent in a group or Pinned shows there, whatever app it came from', () => {
  const grouped = { ...FAM, groups: [{ ...FAM.groups[0], sessions: [person('g1', { group: 'cg-a', children: [kid('kc', 'g1', { group: 'cg-a', source: 'capcom' }), kid('kt', 'g1', { group: 'cg-a', source: 'cli' })] })] }, FAM.groups[1]] };
  assert.deepEqual(shapeOf(unnestRow(grouped, 'kc')).groups, { 'cg-a': ['g1[kt]', 'kc'], 'cg-b': [] });
  assert.deepEqual(shapeOf(unnestRow(grouped, 'kt')).groups, { 'cg-a': ['g1[kc]', 'kt'], 'cg-b': [] });
  const pinned = { ...FAM, pinned: [person('p1', { pinned: true, children: [kid('pc', 'p1', { pinned: true, source: 'capcom' })] })] };
  assert.deepEqual(shapeOf(unnestRow(pinned, 'pc')).pinned, ['p1', 'pc']);
  assert.deepEqual(unnestRow(pinned, 'pc').started, []);
});

test('archiving a loose parent frees each child into the loose list of its own app, and a routine run to none', () => {
  const out = withoutRow(LOOSE_FAM, 'lp');
  assert.deepEqual(loose(out), { started: ['s1', 'lc'], ungrouped: ['ld'], other: ['lt'] });
  assert.equal(findRow(out, 'lr'), null);
  assert.deepEqual([out.started[1], out.ungrouped[0], out.other[0]].map(r => r.parent), [null, null, null]);
});

test('archiving a parent in a group or Pinned frees its children into that list, whatever app they came from', () => {
  const grouped = { ...FAM, groups: [{ ...FAM.groups[0], sessions: [person('g1', { group: 'cg-a', children: [kid('kc', 'g1', { group: 'cg-a', source: 'capcom' }), kid('kt', 'g1', { group: 'cg-a', source: 'cli' })] })] }, FAM.groups[1]] };
  assert.deepEqual(shapeOf(withoutRow(grouped, 'g1')).groups, { 'cg-a': ['kc', 'kt'], 'cg-b': [] });
  const pinned = { ...FAM, pinned: [person('p1', { pinned: true, children: [kid('pc', 'p1', { pinned: true, source: 'cli' })] })] };
  assert.deepEqual(shapeOf(withoutRow(pinned, 'p1')).pinned, ['pc']);
  assert.deepEqual(withoutRow(pinned, 'p1').other, []);
});

test('a session can be nested under the other top level sessions in the list it shows in, but not a routine run, its parent or itself', () => {
  const targets = (ix, id) => nestTargets(ix, findRow(ix, id)).map(r => r.id);
  assert.deepEqual(targets(FAM, 'u1'), ['u2']);
  assert.deepEqual(targets(FAM, 'g1'), ['g2']);
  assert.deepEqual(targets(FAM, 'k1'), ['g2'], 'a nested session is offered the others beside its parent, and not its parent');
  assert.deepEqual(targets(FAM, 'p1'), []);
  assert.deepEqual(targets(FAM, 'pk'), [], 'the only other pinned session is its parent');
  assert.deepEqual(targets(FAM, 'r1'), [], 'a routine run has no list to nest in');
  const mixed = { ...FAM, groups: [{ ...FAM.groups[0], sessions: [...FAM.groups[0].sessions, person('run', { group: 'cg-a', routine: 'nightly' })] }, FAM.groups[1]] };
  assert.deepEqual(targets(mixed, 'g2'), ['g1']);
});

test('none of these changes the list it was given', () => {
  const before = JSON.stringify(FAM);
  for (const edit of [ix => placeRow(ix, 'g1', 'cg-b'), ix => placeRow(ix, 'k1', 'pinned'), ix => nestRow(ix, 'u1', 'g1'), ix => nestRow(ix, 'g1', 'g2'), ix => unnestRow(ix, 'k1'), ix => withoutRow(ix, 'g1'), ix => withoutRow(ix, 'k1')]) edit(FAM);
  assert.equal(JSON.stringify(FAM), before);
  const loosely = JSON.stringify(LOOSE_FAM);
  for (const edit of [ix => unnestRow(ix, 'lc'), ix => unnestRow(ix, 'lr'), ix => withoutRow(ix, 'lp')]) edit(LOOSE_FAM);
  assert.equal(JSON.stringify(LOOSE_FAM), loosely);
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
