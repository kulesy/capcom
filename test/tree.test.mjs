// Run with `npm test`. The rules of the sidebar tree that need no page: where the arrow keys go, and where a group can be moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moveTargets, nextStop } from '../public/ui/tree.js';

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
