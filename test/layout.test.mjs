// Run with `npm test`. Capcom's own layout file: what it keeps, what it refuses to write over, and the changes it makes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeLayout } from '../lib/layout.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'capcom-layout-test-'));

function folder(contents) {
  const dir = fs.mkdtempSync(path.join(base, 'state-'));
  const file = path.join(dir, 'layout.json');
  if (contents !== undefined) fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return { layout: makeLayout(dir), file, onDisk: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

const OLD = { seededAt: '2026-10-15T05:44:17.563Z', groups: [{ id: 'cg-a', name: 'Reviewing' }, { id: 'cg-b', name: 'Backlog' }], pinned: ['p1'], assignments: { s1: 'cg-a', s2: 'cg-b' } };

const FIRST = '2026-10-17T09:30:00.000Z';

// A write replaces the file, so a file dated 1970 shows whether a call wrote it.
const backdate = f => fs.utimesSync(f.file, 1, 1);
const rewritten = f => fs.statSync(f.file).mtimeMs !== 1000;

test('a layout file from before projects, unarchiving and archiving loads as it was, and a missing file is an empty layout', () => {
  const { layout } = folder(OLD);
  assert.deepEqual(layout.read(), { ...OLD, projects: [], unarchived: [], archived: {} });
  assert.deepEqual(folder().layout.read(), { seededAt: null, projects: [], groups: [], pinned: [], assignments: {}, unarchived: [], archived: {} });
});

test('archiving records when, takes the session out of the unarchived list, and keeps everything else in the file, including keys this version does not know', () => {
  const f = folder({ ...OLD, later: { kept: true }, unarchived: ['s1', 's2'] });
  const before = Date.now();
  f.layout.archive('s1');
  const { archived } = f.onDisk();
  assert.deepEqual(Object.keys(archived), ['s1']);
  assert.equal(new Date(archived.s1).toISOString(), archived.s1);
  assert.ok(Date.parse(archived.s1) >= before && Date.parse(archived.s1) <= Date.now(), archived.s1);
  assert.deepEqual(f.onDisk(), { ...OLD, later: { kept: true }, projects: [], archived, unarchived: ['s2'] });
  assert.deepEqual(f.layout.read().archived, archived);
});

test('a session that is archived already keeps its first time, and archiving it again writes nothing', () => {
  const f = folder({ ...OLD, archived: { s1: FIRST } });
  backdate(f);
  f.layout.archive('s1');
  assert.equal(rewritten(f), false);
  assert.deepEqual(f.onDisk().archived, { s1: FIRST });
  f.layout.archive('s2');
  assert.deepEqual(Object.keys(f.onDisk().archived), ['s1', 's2'], 'a second session is added beside the first');
  assert.equal(f.onDisk().archived.s1, FIRST);
});

test('unarchiving takes a session out of the archived list, adds it to the unarchived list once, and keeps everything else in the file, including keys this version does not know', () => {
  const f = folder({ ...OLD, later: { kept: true }, archived: { s1: FIRST, s2: FIRST } });
  f.layout.unarchive('s1');
  f.layout.unarchive('s1');
  f.layout.unarchive('s3');
  assert.deepEqual(f.onDisk(), { ...OLD, later: { kept: true }, projects: [], archived: { s2: FIRST }, unarchived: ['s1', 's3'] });
});

test('unarchiving writes nothing when the session is unarchived already, and a session in both lists leaves the archived one', () => {
  const f = folder({ ...OLD, archived: { s2: FIRST }, unarchived: ['s1'] });
  backdate(f);
  f.layout.unarchive('s1');
  assert.equal(rewritten(f), false);
  const both = folder({ ...OLD, archived: { s1: FIRST }, unarchived: ['s1'] });
  both.layout.unarchive('s1');
  assert.deepEqual({ archived: both.onDisk().archived, unarchived: both.onDisk().unarchived }, { archived: {}, unarchived: ['s1'] });
});

test('archiving and unarchiving leave a session in its group or pin, so it comes back where it was', () => {
  const f = folder({ ...OLD, pinned: ['p1'], assignments: { s1: 'cg-a' } });
  for (const id of ['s1', 'p1']) f.layout.archive(id);
  assert.deepEqual({ pinned: f.onDisk().pinned, assignments: f.onDisk().assignments }, { pinned: ['p1'], assignments: { s1: 'cg-a' } });
  for (const id of ['s1', 'p1']) f.layout.unarchive(id);
  assert.deepEqual({ pinned: f.onDisk().pinned, assignments: f.onDisk().assignments }, { pinned: ['p1'], assignments: { s1: 'cg-a' } });
  assert.deepEqual(f.onDisk().archived, {});
});

test('a layout file that cannot be read is reported, and no change is written over it', () => {
  const edits = [
    l => l.move('s1', null),
    l => l.pin('s1', true),
    l => l.archive('s1'),
    l => l.unarchive('s1'),
    l => l.addProject('Work'),
    l => l.renameProject('cp-a', 'Home'),
    l => l.removeProject('cp-a'),
    l => l.addGroup('Notes'),
    l => l.moveGroup('cg-a', null),
  ];
  for (const text of ['{ not json', JSON.stringify({ ...OLD, groups: 'Reviewing' }), JSON.stringify({ ...OLD, projects: {} }), JSON.stringify({ ...OLD, unarchived: {} }), JSON.stringify({ ...OLD, archived: [] }), JSON.stringify({ ...OLD, archived: 'yesterday' }), JSON.stringify({ ...OLD, archived: null }), '[]']) {
    const f = folder(text);
    assert.match(f.layout.read().problem, /^layout\.json cannot be read: /, text);
    for (const edit of edits) assert.throws(() => edit(f.layout), { status: 500, message: /layout\.json cannot be read/ }, `${edit} on ${text}`);
    assert.equal(fs.readFileSync(f.file, 'utf8'), text, 'the file is as it was');
  }
});

test('the first copy from Desktop keeps what was already in the file, the projects, the unarchived list and the archived sessions included', () => {
  const f = folder({ seededAt: null, projects: [{ id: 'cp-x', name: 'Mine' }], groups: [{ id: 'cg-mine', name: 'Mine', project: 'cp-x' }], pinned: [], assignments: { s9: 'cg-mine' }, unarchived: ['s9'], archived: { s1: FIRST } });
  const desk = {
    problem: null,
    sessions: [{ id: 's1', localId: 'local_1' }, { id: 's9', localId: 'local_9' }],
    groups: [{ id: 'cg-d', name: 'From Desktop' }],
    pinned: [],
    assignments: { local_1: 'cg-d', local_9: 'cg-d' },
  };
  const made = f.layout.seed(desk);
  assert.deepEqual(made.groups, [{ id: 'cg-mine', name: 'Mine', project: 'cp-x' }, { id: 'cg-d', name: 'From Desktop' }]);
  assert.deepEqual(made.projects, [{ id: 'cp-x', name: 'Mine' }]);
  assert.deepEqual(made.assignments, { s1: 'cg-d', s9: 'cg-mine' });
  assert.deepEqual(made.unarchived, ['s9']);
  assert.deepEqual(made.archived, { s1: FIRST });
  assert.deepEqual(f.onDisk().archived, { s1: FIRST });
  assert.equal(f.layout.seed(desk), null, 'it copies once');
});

const WITH_PROJECTS = {
  ...OLD,
  projects: [{ id: 'cp-a', name: 'Capcom' }, { id: 'cp-b', name: 'Garden' }],
  groups: [{ id: 'cg-a', name: 'Reviewing', project: 'cp-a', colour: 'blue' }, { id: 'cg-b', name: 'Backlog', project: 'cp-b' }, { id: 'cg-c', name: 'Loose' }],
  unarchived: ['s5'],
  archived: { s6: FIRST },
};
const ID = /^c[pg]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('a project is added after the others, with an id like a group has, and its name is kept as one line of text', () => {
  const f = folder(WITH_PROJECTS);
  const made = f.layout.addProject('  <img src=x onerror=alert(1)>\n\tand   more  ');
  assert.match(made.id, ID);
  assert.equal(made.id.slice(0, 3), 'cp-');
  assert.equal(made.name, '<img src=x onerror=alert(1)> and more');
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, projects: [...WITH_PROJECTS.projects, made] });
  assert.notEqual(f.layout.addProject('Capcom').id, f.layout.read().projects[0].id, 'a name used already is allowed, and gets its own id');
});

test('a name must be text with something in it and no more than 80 characters, and a refused name writes nothing', () => {
  const f = folder(WITH_PROJECTS);
  const before = fs.readFileSync(f.file, 'utf8');
  const invisible = ['\u200B', ' \u2060 \u00AD ', '\u3164', '\uFEFF', '\u200D', '\uFE0F', '\u2800', '\u202E', '\u2066\u2069'];
  for (const bad of [undefined, null, 5, {}, ['a'], '', '   ', '\n\t', '\u0000\u0007', ...invisible, 'x'.repeat(81), '🙂'.repeat(81)]) {
    for (const edit of [l => l.addProject(bad), l => l.renameProject('cp-a', bad), l => l.addGroup(bad), l => l.addGroup(bad, 'cp-a')]) {
      assert.throws(() => edit(f.layout), { status: 400 }, JSON.stringify(bad));
    }
  }
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
  assert.equal(f.layout.addProject('x'.repeat(80)).name.length, 80);
  assert.equal([...f.layout.addProject('🙂'.repeat(80)).name].length, 80);
});

test('a name keeps the invisible characters that make up an emoji and loses the ones that reorder the text around it', () => {
  const f = folder(WITH_PROJECTS);
  for (const name of ['\u{1F469}\u200D\u{1F4BB} Dev', '\u{1F6E2}\uFE0F Pump', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F} Wales', '\u05E9\u05DC\u05D5\u05DD\u200F']) {
    assert.equal(f.layout.addProject(name).name, name, name);
  }
  assert.equal(f.layout.addProject('abc\u202Edef\u2066 ghi\u2069').name, 'abcdef ghi');
  assert.equal(f.layout.renameProject('cp-a', '\u202Bnotes\u202C').name, 'notes');
});

test('renaming a project changes its name and nothing else', () => {
  const f = folder(WITH_PROJECTS);
  const renamed = f.layout.renameProject('cp-b', ' Garden plans ');
  assert.deepEqual(renamed, { id: 'cp-b', name: 'Garden plans' });
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, projects: [WITH_PROJECTS.projects[0], renamed] });
});

test('a group is added to the end of the groups, inside a project or at the top level', () => {
  const f = folder(WITH_PROJECTS);
  const inside = f.layout.addGroup('Inside', 'cp-b');
  const top = f.layout.addGroup('Top level');
  assert.match(inside.id, ID);
  assert.equal(inside.id.slice(0, 3), 'cg-');
  assert.deepEqual(inside, { id: inside.id, name: 'Inside', project: 'cp-b' });
  assert.deepEqual(top, { id: top.id, name: 'Top level' }, 'a top-level group looks like one Desktop made');
  assert.deepEqual(f.onDisk().groups, [...WITH_PROJECTS.groups, inside, top]);
  assert.deepEqual({ ...f.onDisk(), groups: WITH_PROJECTS.groups }, WITH_PROJECTS);
});

test('a group moves into a project, between projects and back to the top level, and keeps its place and its sessions', () => {
  const f = folder(WITH_PROJECTS);
  const order = () => f.onDisk().groups.map(g => g.id);
  assert.deepEqual(f.layout.moveGroup('cg-c', 'cp-a'), { id: 'cg-c', name: 'Loose', project: 'cp-a' });
  assert.deepEqual(f.layout.moveGroup('cg-a', 'cp-b'), { id: 'cg-a', name: 'Reviewing', project: 'cp-b', colour: 'blue' });
  assert.deepEqual(f.layout.moveGroup('cg-b', null), { id: 'cg-b', name: 'Backlog' });
  assert.deepEqual(f.onDisk().groups, [{ id: 'cg-a', name: 'Reviewing', project: 'cp-b', colour: 'blue' }, { id: 'cg-b', name: 'Backlog' }, { id: 'cg-c', name: 'Loose', project: 'cp-a' }]);
  assert.deepEqual(order(), ['cg-a', 'cg-b', 'cg-c']);
  assert.deepEqual({ ...f.onDisk(), groups: WITH_PROJECTS.groups }, WITH_PROJECTS);
  assert.deepEqual(f.layout.moveGroup('cg-c', null), { id: 'cg-c', name: 'Loose' }, 'a group already at the top level can be moved there');
});

test('deleting a project sends its groups back to the top level and deletes no group, session or pin', () => {
  const f = folder(WITH_PROJECTS);
  assert.deepEqual(f.layout.removeProject('cp-a'), { id: 'cp-a', name: 'Capcom' });
  assert.deepEqual(f.onDisk(), {
    ...WITH_PROJECTS,
    projects: [{ id: 'cp-b', name: 'Garden' }],
    groups: [{ id: 'cg-a', name: 'Reviewing', colour: 'blue' }, { id: 'cg-b', name: 'Backlog', project: 'cp-b' }, { id: 'cg-c', name: 'Loose' }],
  });
  f.layout.removeProject('cp-b');
  assert.deepEqual(f.onDisk(), { ...WITH_PROJECTS, projects: [], groups: [{ id: 'cg-a', name: 'Reviewing', colour: 'blue' }, { id: 'cg-b', name: 'Backlog' }, { id: 'cg-c', name: 'Loose' }] });
});

test('a project or group that is not there is refused with a 404, and a refused change writes nothing', () => {
  const f = folder(WITH_PROJECTS);
  const before = fs.readFileSync(f.file, 'utf8');
  const l = f.layout;
  for (const [edit, what] of [
    [() => l.renameProject('cp-none', 'x'), /Unknown project/],
    [() => l.renameProject('cg-a', 'x'), /Unknown project/],
    [() => l.removeProject('cp-none'), /Unknown project/],
    [() => l.removeProject(undefined), /Unknown project/],
    [() => l.addGroup('x', 'cp-none'), /Unknown project/],
    [() => l.addGroup('x', 'cg-a'), /Unknown project/],
    [() => l.moveGroup('cg-none', null), /Unknown group/],
    [() => l.moveGroup('cp-a', null), /Unknown group/],
    [() => l.moveGroup('cg-a', 'cp-none'), /Unknown project/],
    [() => l.moveGroup('cg-a', ''), /Unknown project/],
  ]) assert.throws(edit, { status: 404, message: what }, String(edit));
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('every other edit keeps the projects and the project of each group', () => {
  const f = folder(WITH_PROJECTS);
  f.layout.move('s1', 'cg-b');
  f.layout.pin('s2', true);
  f.layout.archive('s4');
  f.layout.unarchive('s3');
  const after = f.onDisk();
  assert.deepEqual(after.projects, WITH_PROJECTS.projects);
  assert.deepEqual(after.groups, WITH_PROJECTS.groups);
});
