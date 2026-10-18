// Run with `npm test`. What the image viewer decides is plain functions on plain data, so it runs here without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataUrlToBlob, draftImages, fromTool, imageKey, isDataUrl, joinEarlier, nearestThumb, overflow, position, stepIndex, stepKey, swipeStep, tabTarget, threadImages, tileLabel, toolShots } from '../public/ui/gallery.js';

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
    ['5.r0.b', 'Image from Chrome'],
    ['9.r0.c', 'Image from Read'],
    ['9.r1.c', 'Image from Read'],
    ['12.0.d', 'Attached image'],
    ['local:2', 'Attached image'],
  ]);
  assert.equal(threadImages(items, [], url)[1].src, 'api/sessions/s1/images/5.r0.b');
  assert.equal(fromTool('Read'), 'Image from Read');
  assert.equal(fromTool('a connector'), 'Image from a connector');
});

test('pictures from different servers are each named for their own source, in the viewer and on the tiles, so two tools that are both called computer are told apart', () => {
  const shot = ref => ({ ref, type: 'image/png' });
  const items = [
    { kind: 'tool', id: 't1', name: 'mcp__claude-in-chrome__computer', images: [shot('1.r0.a')] },
    { kind: 'tool', id: 't2', name: 'mcp__Claude_Browser__computer', images: [shot('2.r0.a')] },
    { kind: 'tool', id: 't3', name: 'mcp__0d2c4b1a-9e8f-4a7b-8c6d-5e4f3a2b1c0d__read', images: [shot('3.r0.a')] },
    { kind: 'tool', id: 't4', name: 'mcp__claude_ai_Google_Drive__download_file_content', images: [shot('4.r0.a')] },
    { kind: 'tool', id: 't5', name: 'Read', images: [shot('5.r0.a')] },
  ];
  assert.deepEqual(threadImages(items, [], url).map(i => i.alt), ['Image from Chrome', 'Image from Claude Browser', 'Image from a connector', 'Image from Google Drive', 'Image from Read']);
  assert.deepEqual(toolShots(items).map(s => s.source), ['Chrome', 'Claude Browser', 'a connector', 'Google Drive', 'Read']);
  const shots = toolShots(items);
  assert.deepEqual(shots.slice(0, 3).map((s, n) => tileLabel(n, shots.length, s.source)), ['View image 1 of 5, from Chrome', 'View image 2 of 5, from Claude Browser', 'View image 3 of 5, from a connector']);
});

test('the pictures being composed are listed by their data URLs and named by their files', () => {
  const images = [{ id: 3, name: 'one.png', src: 'data:image/png;base64,AA==' }, { id: 5, name: 'two.jpg', src: 'data:image/jpeg;base64,AQ==' }];
  assert.deepEqual(draftImages(images), [
    { key: 'local:3', src: 'data:image/png;base64,AA==', alt: 'one.png' },
    { key: 'local:5', src: 'data:image/jpeg;base64,AQ==', alt: 'two.jpg' },
  ]);
  assert.deepEqual(draftImages([]), []);
});

test('a strip lists the pictures of its tool calls in order, naming where each came from and skipping thinking and calls with none', () => {
  const [a, b, c] = ['1.r0.u', '1.r1.u', '4.r0.u'].map(ref => ({ ref, type: 'image/png' }));
  const rows = [{ kind: 'thinking', text: 'hm' }, { kind: 'tool', name: 'Read', images: [a, b] }, { kind: 'tool', name: 'Bash' }, { kind: 'tool', name: 'mcp__claude-in-chrome__browser_batch', images: [c] }];
  assert.deepEqual(toolShots(rows), [{ img: a, source: 'Read' }, { img: b, source: 'Read' }, { img: c, source: 'Chrome' }]);
  assert.deepEqual(toolShots([{ kind: 'tool', name: 'Bash' }]), []);
});

test('up to four pictures get a tile each, and past four the last tile stands for itself and every picture after it', () => {
  assert.deepEqual([0, 1, 3, 4, 5, 6, 10].map(overflow), [0, 0, 0, 0, 2, 3, 7]);
  const labels = total => Array.from({ length: Math.min(total, 4) }, (_, n) => tileLabel(n, total, 'Read'));
  assert.deepEqual(labels(1), ['View image from Read']);
  assert.deepEqual(labels(2), ['View image 1 of 2, from Read', 'View image 2 of 2, from Read']);
  assert.deepEqual(labels(4), ['View image 1 of 4, from Read', 'View image 2 of 4, from Read', 'View image 3 of 4, from Read', 'View image 4 of 4, from Read']);
  assert.deepEqual(labels(10), ['View image 1 of 10, from Read', 'View image 2 of 10, from Read', 'View image 3 of 10, from Read', 'View 7 more images']);
  assert.equal(labels(5)[3], 'View 2 more images');
});

test('a tile names where its picture came from, and the tile that stands for the rest names no source', () => {
  const labels = (total, source) => Array.from({ length: Math.min(total, 4) }, (_, n) => tileLabel(n, total, source));
  assert.deepEqual(labels(1, 'Chrome'), ['View image from Chrome']);
  assert.deepEqual(labels(2, 'a connector'), ['View image 1 of 2, from a connector', 'View image 2 of 2, from a connector']);
  assert.deepEqual(labels(6, 'Claude Browser'), ['View image 1 of 6, from Claude Browser', 'View image 2 of 6, from Claude Browser', 'View image 3 of 6, from Claude Browser', 'View 3 more images']);
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

test('closing the viewer prefers the picture opened on, then its place in the thread as it stands now', () => {
  assert.equal(nearestThumb(['b', 'a'], ['x', 'a', 'b'], 1, 'b'), 0, 'the picture opened on, though the thread grew above it and moved its place');
  assert.equal(nearestThumb(['r1', 'r2', 'r3'], ['r1', 'r2', 'r3'], 1, 'local:7'), 1, 'a message saved under a new key is found by its place');
  assert.equal(nearestThumb(['r1', 'r3'], ['r1', 'r2', 'r3'], 1, 'local:7'), 0, 'and when that is not on screen either, the nearest, the earlier of two');
  const thread = ['u0', 't0', 't1', 't2', 't3', 't4', 't5', 'u1', 't6'];
  assert.equal(nearestThumb(['u0', 't0', 't1', 't2', 'u1', 't6'], thread, 7, 'local:3'), 4, 'pictures behind a strip\'s +N still count towards the place');
  assert.equal(nearestThumb(['x', 'y'], thread, 7, 'local:3'), -1, 'thumbnails outside the thread are never chosen');
});

test('stepping stops at the first and the last picture instead of wrapping', () => {
  assert.deepEqual([[0, -1], [0, 1], [3, 1], [4, 1], [4, -1]].map(([at, by]) => stepIndex(at, by, 5)), [0, 1, 4, 4, 3]);
  assert.equal(stepIndex(0, 1, 1), 0);
});

test('the pictures from before the loaded messages go in front of the loaded ones, leaving out any the loaded list already has', () => {
  const shot = key => ({ key, src: url(key), alt: 'Attached image' });
  const loaded = ['c', 'd', 'e'].map(shot);
  const keys = list => list.map(i => i.key);
  assert.deepEqual(keys(joinEarlier(['a', 'b'].map(shot), loaded)), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(keys(joinEarlier(['a', 'c', 'x'].map(shot), loaded)), ['a', 'x', 'c', 'd', 'e'], 'c is loaded already, so it keeps its place there');
  assert.equal(joinEarlier([], loaded), loaded, 'with nothing earlier the loaded list itself comes back');
  assert.deepEqual(joinEarlier(['a'].map(shot), []), [shot('a')]);
  assert.deepEqual(keys(loaded), ['c', 'd', 'e'], 'the loaded list is not changed');
});

test('stepping by key moves from the picture on screen, stops at both ends, and a key that is not in the list steps from the first picture', () => {
  const list = ['a', 'b', 'c', 'd'].map(key => ({ key }));
  assert.deepEqual([['b', 1], ['b', -1], ['a', -1], ['d', 1], ['a', 3], ['d', -3]].map(([key, by]) => stepKey(list, key, by)), ['c', 'a', 'a', 'd', 'd', 'a']);
  assert.equal(stepKey(list, 'gone', 1), 'b');
  assert.equal(stepKey(list, 'gone', -1), 'a');
  assert.equal(stepKey(list.slice(0, 1), 'a', 1), 'a');
  const before = ['c', 'd'].map(key => ({ key }));
  assert.equal(stepKey(before, 'd', -1), 'c');
  assert.equal(stepKey(joinEarlier(['a', 'b'].map(key => ({ key })), before), 'd', -1), 'c', 'pictures arriving in front do not move the one on screen');
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
