// Run with `npm test`. What the image viewer decides is plain functions on plain data, so it runs here without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataUrlToBlob, imageKey, isDataUrl, position, stepIndex, swipeStep, tabTarget, threadImages } from '../public/ui/gallery.js';

const url = ref => `api/sessions/s1/images/${ref}`;

test('a saved picture is named by its ref and one still being sent by the id the page gave it', () => {
  assert.equal(imageKey({ ref: '120.0.abc', type: 'image/png' }), '120.0.abc');
  assert.equal(imageKey({ id: 7, name: 'a.png', src: 'data:image/png;base64,AA==' }), 'local:7');
});

test('the viewer lists every picture in the thread in order, saved messages first and then those being sent', () => {
  const items = [
    { kind: 'user', text: 'one', images: [{ ref: '1.0.a', type: 'image/png' }, { ref: '1.1.a', type: 'image/jpeg' }] },
    { kind: 'assistant', text: 'seen' },
    { kind: 'user', text: 'no pictures' },
    { kind: 'user', text: 'two', images: [{ ref: '9.0.b', type: 'image/gif' }] },
  ];
  const sending = [{ text: 'three', images: [{ id: 4, name: 'c.png', src: 'data:image/png;base64,AA==' }] }];
  assert.deepEqual(threadImages(items, sending, url), [
    { key: '1.0.a', src: 'api/sessions/s1/images/1.0.a' },
    { key: '1.1.a', src: 'api/sessions/s1/images/1.1.a' },
    { key: '9.0.b', src: 'api/sessions/s1/images/9.0.b' },
    { key: 'local:4', src: 'data:image/png;base64,AA==' },
  ]);
  assert.deepEqual(threadImages([], [], url), []);
});

test('stepping stops at the first and the last picture instead of wrapping', () => {
  assert.deepEqual([[0, -1], [0, 1], [3, 1], [4, 1], [4, -1]].map(([at, by]) => stepIndex(at, by, 5)), [0, 1, 4, 4, 3]);
  assert.equal(stepIndex(0, 1, 1), 0);
});

test('the count reads from one', () => {
  assert.equal(position(1, 5), '2 of 5');
  assert.equal(position(0, 1), '1 of 1');
});

test('a swipe steps when it is long enough and mostly sideways, and swiping left shows the next picture', () => {
  assert.equal(swipeStep(-80, 5), 1);
  assert.equal(swipeStep(80, -5), -1);
  assert.equal(swipeStep(-47, 0), 0);
  assert.equal(swipeStep(-48, 0), 1);
  assert.equal(swipeStep(-90, 80), 0);
  assert.equal(swipeStep(-90, 60), 1);
  assert.equal(swipeStep(0, 200), 0);
});

test('Tab wraps at both ends, and from the dialog itself it enters at the matching end', () => {
  assert.deepEqual([[0, false], [1, false], [3, false]].map(([at, back]) => tabTarget(4, at, back)), [1, 2, 0]);
  assert.deepEqual([[0, true], [2, true], [3, true]].map(([at, back]) => tabTarget(4, at, back)), [3, 1, 2]);
  assert.equal(tabTarget(4, -1, false), 0);
  assert.equal(tabTarget(4, -1, true), 3);
  assert.equal(tabTarget(1, 0, false), 0);
  assert.equal(tabTarget(1, 0, true), 0);
});

test('a data URL is told apart from an address, and becomes a blob holding its type and bytes', async () => {
  assert.equal(isDataUrl('data:image/png;base64,AA=='), true);
  assert.equal(isDataUrl('api/sessions/s1/images/1.0.a'), false);
  const bytes = Uint8Array.from([0, 1, 2, 127, 128, 250, 255]);
  const blob = dataUrlToBlob(`data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`);
  assert.equal(blob.type, 'image/webp');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});
