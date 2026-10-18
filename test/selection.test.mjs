// Run with `npm test`. Which result the search has selected: how it follows a result when the list changes, and where it goes
// when the result under it is taken out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRST, holdAt, holdBeside, holdStep, selectedIn } from '../public/ui/selection.js';

const KEYS = ['s1', 's2', 'a1', 'a2', 'a3'];

test('a selection with no key is the result at its position, and the first to begin with', () => {
  assert.equal(selectedIn(KEYS, FIRST), 0);
  assert.equal(selectedIn(['other', ...KEYS], FIRST), 0);
  assert.equal(selectedIn(KEYS, { key: null, at: 3 }), 3);
  assert.equal(selectedIn(KEYS, { key: null, at: 9 }), 4, 'kept inside the list');
});

test('a list with nothing in it selects position 0, and holds no key', () => {
  assert.equal(selectedIn([], FIRST), 0);
  assert.equal(selectedIn([], { key: 'a2', at: 3 }), 0);
  assert.deepEqual(holdAt([], 0), { key: null, at: 0 });
  assert.deepEqual(holdStep([], 0, 1), { key: null, at: 0 });
  assert.deepEqual(holdStep([], 0, -1), { key: null, at: 0 });
});

test('a held key is followed to wherever the list puts it', () => {
  const held = holdAt(KEYS, 3);
  assert.deepEqual(held, { key: 'a2', at: 3 });
  assert.equal(selectedIn(KEYS, held), 3);
  assert.equal(selectedIn(['new', ...KEYS], held), 4, 'a result added above');
  assert.equal(selectedIn(KEYS.filter(k => k !== 's1'), held), 2, 'a result taken out above');
  assert.equal(selectedIn([...KEYS].reverse(), held), 1, 'a list in another order');
});

test('with its key gone, the selection falls back on the position it was last at, kept inside the list', () => {
  const held = holdAt(KEYS, 3);
  assert.equal(selectedIn(KEYS.filter(k => k !== 'a2'), held), 3);
  assert.equal(selectedIn(['s1', 's2'], held), 1);
  assert.equal(selectedIn(['s1'], held), 0);
});

test('where a key is in the list twice, the position that still holds it wins', () => {
  const twice = ['s1', 'a1', 's2', 'a1'];
  assert.equal(selectedIn(twice, { key: 'a1', at: 3 }), 3);
  assert.equal(selectedIn(twice, { key: 'a1', at: 1 }), 1);
  assert.equal(selectedIn(twice, { key: 'a1', at: 2 }), 1, 'else the first');
});

test('a step moves one result and stops at either end', () => {
  assert.deepEqual(holdStep(KEYS, 0, 1), { key: 's2', at: 1 });
  assert.deepEqual(holdStep(KEYS, 3, -1), { key: 'a1', at: 2 });
  assert.deepEqual(holdStep(KEYS, 4, 1), { key: 'a3', at: 4 });
  assert.deepEqual(holdStep(KEYS, 0, -1), { key: 's1', at: 0 });
});

test('taking out the result under the selection moves it to the result after it, or before it when it was the last', () => {
  assert.deepEqual(holdBeside(KEYS, 3), { key: 'a3', at: 3 });
  assert.deepEqual(holdBeside(KEYS, 0), { key: 's2', at: 0 });
  assert.deepEqual(holdBeside(KEYS, 4), { key: 'a2', at: 3 });
  assert.deepEqual(holdBeside(['only'], 0), FIRST);
  assert.deepEqual(holdBeside([], 0), FIRST);
});

// Under All with a query, an unarchived result leaves Archived at once and reappears in Sessions, above the selection, when the list
// reloads. Held by position, the selection slid back one result when the session reappeared.
test('after an unarchive the selection stays on the result beside it, before and after the session reappears in Sessions', () => {
  for (const [chosen, beside] of [['a2', 'a3'], ['a3', 'a2'], ['a1', 'a2']]) {
    const before = holdAt(KEYS, KEYS.indexOf(chosen));
    const held = holdBeside(KEYS, selectedIn(KEYS, before));
    const gone = KEYS.filter(k => k !== chosen);
    assert.equal(gone[selectedIn(gone, held)], beside, `${chosen} gone from Archived`);
    const reloaded = ['s1', chosen, ...gone.slice(1)];
    assert.equal(reloaded[selectedIn(reloaded, held)], beside, `${chosen} back in Sessions`);
  }
});
