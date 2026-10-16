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

test('a layout file from before sessions could be unarchived loads as it was, and a missing file is an empty layout', () => {
  const { layout } = folder(OLD);
  assert.deepEqual(layout.read(), { ...OLD, unarchived: [] });
  assert.deepEqual(folder().layout.read(), { seededAt: null, groups: [], pinned: [], assignments: {}, unarchived: [] });
});

test('unarchiving adds a session once, and keeps everything else in the file, including keys this version does not know', () => {
  const f = folder({ ...OLD, later: { kept: true } });
  f.layout.unarchive('s1');
  f.layout.unarchive('s1');
  f.layout.unarchive('s3');
  assert.deepEqual(f.onDisk(), { ...OLD, later: { kept: true }, unarchived: ['s1', 's3'] });
});

test('a layout file that cannot be read is reported, and no change is written over it', () => {
  for (const text of ['{ not json', JSON.stringify({ ...OLD, groups: 'Reviewing' }), JSON.stringify({ ...OLD, unarchived: {} }), '[]']) {
    const f = folder(text);
    assert.match(f.layout.read().problem, /^layout\.json cannot be read: /, text);
    assert.throws(() => f.layout.unarchive('s1'), { status: 500, message: /layout\.json cannot be read/ }, text);
    assert.equal(fs.readFileSync(f.file, 'utf8'), text, 'the file is as it was');
  }
});

test('the first copy from Desktop keeps what was already in the file, the unarchived list included', () => {
  const f = folder({ seededAt: null, groups: [{ id: 'cg-mine', name: 'Mine' }], pinned: [], assignments: { s9: 'cg-mine' }, unarchived: ['s9'] });
  const desk = {
    problem: null,
    sessions: [{ id: 's1', localId: 'local_1' }, { id: 's9', localId: 'local_9' }],
    groups: [{ id: 'cg-d', name: 'From Desktop' }],
    pinned: [],
    assignments: { local_1: 'cg-d', local_9: 'cg-d' },
  };
  const made = f.layout.seed(desk);
  assert.deepEqual(made.groups.map(g => g.id), ['cg-mine', 'cg-d']);
  assert.deepEqual(made.assignments, { s1: 'cg-d', s9: 'cg-mine' });
  assert.deepEqual(made.unarchived, ['s9']);
  assert.equal(f.layout.seed(desk), null, 'it copies once');
});
