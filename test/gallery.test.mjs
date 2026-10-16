// Run with `npm test`. What the image viewer decides is plain functions on plain data, so it runs here without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataUrlToBlob, draftImages, fromTool, imageKey, isDataUrl, nearestThumb, overflow, position, stepIndex, swipeStep, tabTarget, threadImages, tileLabel, toolShots } from '../public/ui/gallery.js';

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
    { key: '1.0.a', src: 'api/sessions/s1/images/1.0.a', alt: 'Attached image' },
    { key: '1.1.a', src: 'api/sessions/s1/images/1.1.a', alt: 'Attached image' },
    { key: '9.0.b', src: 'api/sessions/s1/images/9.0.b', alt: 'Attached image' },
    { key: 'local:4', src: 'data:image/png;base64,AA==', alt: 'Attached image' },
  ]);
  assert.deepEqual(threadImages([], [], url), []);
});

test('the pictures tools returned are listed in thread order among the messages around them, each named for where it came from', () => {
  const shot = ref => ({ ref, type: 'image/png' });
  const items = [
    { kind: 'user', text: 'look', images: [shot('1.0.a')] },
    { kind: 'tool', id: 't1', name: 'mcp__claude-in-chrome__computer', images: [shot('5.r0.b')] },
    { kind: 'tool', id: 't2', name: 'Bash' },
    { kind: 'tool', id: 't3', name: 'Read', images: [shot('9.r0.c'), shot('9.r1.c')] },
    { kind: 'assistant', text: 'seen' },
    { kind: 'user', text: 'and this', images: [shot('12.0.d')] },
  ];
  const sending = [{ text: 'sent', images: [{ id: 2, name: 'e.png', src: 'data:image/png;base64,AA==' }] }];
  assert.deepEqual(threadImages(items, sending, url).map(i => [i.key, i.alt]), [
    ['1.0.a', 'Attached image'],
    ['5.r0.b', 'Image from computer'],
    ['9.r0.c', 'Image from Read'],
    ['9.r1.c', 'Image from Read'],
    ['12.0.d', 'Attached image'],
    ['local:2', 'Attached image'],
  ]);
  assert.equal(threadImages(items, [], url)[1].src, 'api/sessions/s1/images/5.r0.b');
  assert.equal(fromTool('Read'), 'Image from Read');
});

test('the pictures being composed are listed by their data URLs and named by their files', () => {
  const images = [{ id: 3, name: 'one.png', src: 'data:image/png;base64,AA==' }, { id: 5, name: 'two.jpg', src: 'data:image/jpeg;base64,AQ==' }];
  assert.deepEqual(draftImages(images), [
    { key: 'local:3', src: 'data:image/png;base64,AA==', alt: 'one.png' },
    { key: 'local:5', src: 'data:image/jpeg;base64,AQ==', alt: 'two.jpg' },
  ]);
  assert.deepEqual(draftImages([]), []);
});

test('a strip lists the pictures of its tool calls in order, naming the tool for each and skipping thinking and calls with none', () => {
  const [a, b, c] = ['1.r0.u', '1.r1.u', '4.r0.u'].map(ref => ({ ref, type: 'image/png' }));
  const rows = [{ kind: 'thinking', text: 'hm' }, { kind: 'tool', name: 'Read', images: [a, b] }, { kind: 'tool', name: 'Bash' }, { kind: 'tool', name: 'mcp__claude-in-chrome__browser_batch', images: [c] }];
  assert.deepEqual(toolShots(rows), [{ img: a, tool: 'Read' }, { img: b, tool: 'Read' }, { img: c, tool: 'browser batch' }]);
  assert.deepEqual(toolShots([{ kind: 'tool', name: 'Bash' }]), []);
});

test('up to four pictures get a tile each, and past four the last tile stands for itself and every picture after it', () => {
  assert.deepEqual([0, 1, 3, 4, 5, 6, 10].map(overflow), [0, 0, 0, 0, 2, 3, 7]);
  const labels = total => Array.from({ length: Math.min(total, 4) }, (_, n) => tileLabel(n, total, 'Read'));
  assert.deepEqual(labels(1), ['View image from Read']);
  assert.deepEqual(labels(2), ['View image 1 of 2 from Read', 'View image 2 of 2 from Read']);
  assert.deepEqual(labels(4), ['View image 1 of 4 from Read', 'View image 2 of 4 from Read', 'View image 3 of 4 from Read', 'View image 4 of 4 from Read']);
  assert.deepEqual(labels(10), ['View image 1 of 10 from Read', 'View image 2 of 10 from Read', 'View image 3 of 10 from Read', 'View 7 more images']);
  assert.equal(labels(5)[3], 'View 2 more images');
});

test('closing the viewer goes to a thumbnail for the picture opened, else the nearest picture in the thread, else nowhere', () => {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.equal(nearestThumb(['a', 'c', 'e'], keys, 2), 1, 'the same picture');
  assert.equal(nearestThumb(['e', 'c', 'c'], keys, 2), 1, 'the first of two for the same picture, in page order');
  assert.equal(nearestThumb(['a', 'e', 'f'], keys, 2), 0, 'a is 2 away and e is 2 away, so the earlier thumbnail wins');
  assert.equal(nearestThumb(['a', 'f'], keys, 4), 1, 'f is 1 away');
  assert.equal(nearestThumb(['x', 'f', 'y'], keys, 0), 1, 'a thumbnail whose picture is not in the thread is passed over');
  assert.equal(nearestThumb(['x', 'y'], keys, 0), -1);
  assert.equal(nearestThumb([], keys, 3), -1);
  assert.equal(nearestThumb(['a'], [], 0), -1);
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
