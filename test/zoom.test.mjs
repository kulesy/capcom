// Run with `npm test`. What the image viewer's zoom and pan decide is plain functions on plain numbers, so it runs here without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { atOwnSize, boxOf, clampView, DOUBLE_TAP_ZOOM, FIT, isDoubleTap, isTap, maxScale, panBy, pinchOf, pinchTo, rebox, rectOf, settle, toFit, travelled, wheelPx, wheelZoom, zoomAt } from '../public/ui/zoom.js';

// A phone stage 390 by 700 with 16px at the sides, 4px above and 8px below. A 1600 by 600 picture fits 358 wide, 356 inside its
// 1px border, and is shown 1:1 at 4.49 times that.
const wide = { sw: 390, sh: 700, cx: 195, cy: 348, w: 356, h: 133.5, b: 1, actual: 1600 / 356 };
// A 600 by 1800 picture fits by height, 686 inside its border. It is 1:1 at 2.62 times that, which is under the usual limit of 4.
const tall = { sw: 390, sh: 700, cx: 195, cy: 348, w: 686 / 3, h: 686, b: 1, actual: 600 / (686 / 3) };
// A square stage and a picture that fills 3 quarters of it.
const roomy = { sw: 400, sh: 400, cx: 200, cy: 200, w: 300, h: 300, b: 0, actual: 3 };
// `wide` on a stage 600 wide, where it fits 566 wide inside its border, as on a tablet or a phone turned on its side.
const wider = { sw: 600, sh: 700, cx: 300, cy: 348, w: 566, h: 212.25, b: 1, actual: 1600 / 566 };
// `wide` on a desktop stage, where it fits 1246 wide.
const huge = { sw: 1280, sh: 900, cx: 640, cy: 448, w: 1246, h: 467.25, b: 1, actual: 1600 / 1246 };
// `tall` on a stage 60px higher, as when a phone browser folds its toolbar away.
const taller = { sw: 390, sh: 760, cx: 195, cy: 378, w: 746 / 3, h: 746, b: 1, actual: 600 / (746 / 3) };

const near = (a, b, within = 1e-9) => Math.abs(a - b) < within;

test('a picture wider than the stage can be dragged to either edge and no further, so no gap opens beside it', () => {
  const view = { s: 2, x: 0, y: 0 };
  const edges = v => { const r = rectOf(v, wide); return [r.left, r.left + r.width + 2 * wide.b]; };
  assert.deepEqual(edges(panBy(view, 500, 0, wide)), [0, 714]);
  assert.deepEqual(edges(panBy(view, -500, 0, wide)), [-324, 390]);
  assert.equal(panBy(view, 500, 0, wide).x, 162);
  assert.equal(panBy(view, -500, 0, wide).x, -162);
  assert.equal(panBy(view, 50, 0, wide).x, 50, 'inside its range a pan is taken as it comes');
  assert.equal(panBy(panBy(view, 80, 0, wide), -30, 0, wide).x, 50, 'and adds to where the picture already is');
});

test('an axis the picture does not fill stays where fit put it, whatever the pan', () => {
  const view = { s: 2, x: 0, y: 0 };
  assert.equal(panBy(view, 0, 300, wide).y, 0);
  assert.equal(panBy(view, 0, -300, wide).y, 0);
  assert.deepEqual(panBy(FIT, 40, -40, wide), FIT, 'at fit nothing moves');
  assert.deepEqual(clampView({ s: 1, x: 99, y: -99 }, tall), FIT);
});

test('a picture that grows past a stage edge on the axis it does not fill is pushed back inside, not centred', () => {
  const aside = { sw: 400, sh: 300, cx: 100, cy: 150, w: 100, h: 80, b: 0, actual: 3 };
  assert.equal(clampView({ s: 2, x: 0, y: 0 }, aside).x, 0, 'its left edge is at the stage edge and it fits');
  assert.equal(clampView({ s: 3, x: 0, y: 0 }, aside).x, 50, 'grown 50px past the left edge, so moved right by that');
  assert.equal(clampView({ s: 3, x: 0, y: 0 }, aside).y, 0);
});

test('a pan of a page, or of any distance, goes as far as the edge and no further', () => {
  const view = { s: 4, x: 0, y: 0 };
  const page = -0.9 * tall.sh;
  assert.equal(panBy(view, 0, page, tall).y, -630);
  assert.equal(panBy(panBy(view, 0, page, tall), 0, page, tall).y, -1021, 'the second page stops at the bottom edge');
  assert.equal(panBy(view, 0, -Infinity, tall).y, -1021);
  assert.equal(panBy(view, 0, Infinity, tall).y, 1025);
  assert.equal(panBy(view, 0, Infinity, tall).x, 0, 'and the other axis is left alone');
});

test('the two rules meet where the picture is exactly as wide as the stage', () => {
  const meet = { sw: 400, sh: 300, cx: 150, cy: 150, w: 100, h: 50, b: 0, actual: 8 };
  const at = s => clampView({ s, x: 0, y: 0 }, meet).x;
  assert.equal(at(4), 50, 'as wide as the stage, so it sits flush at the left edge');
  assert.ok(near(at(3.999), 50, 0.1) && near(at(4.001), 50, 0.1), 'a hair narrower or wider is a hair away');
});

test('zooming keeps the part of the picture under the fingers under them while the picture is not held at an edge', () => {
  const under = (v, px, py) => [(px - roomy.cx - v.x) / v.s, (py - roomy.cy - v.y) / v.s];
  const first = zoomAt(FIT, 2, 250, 220, roomy);
  assert.deepEqual(first, { s: 2, x: -50, y: -20 });
  assert.deepEqual(under(first, 250, 220), under(FIT, 250, 220));
  const second = zoomAt(first, 1.5, 150, 300, roomy);
  assert.deepEqual(second, { s: 3, x: -50, y: -80 });
  assert.deepEqual(under(second, 150, 300), under(first, 150, 300));
  const back = zoomAt(second, 2 / 3, 150, 300, roomy);
  assert.deepEqual(under(back, 150, 300), under(first, 150, 300), 'and zooming back out about the same point retraces it');
});

test('zooming in at the edge of a picture cannot pull a gap open, the picture is held at the stage edge instead', () => {
  const view = zoomAt(FIT, 2, 5, 200, roomy);
  assert.equal(rectOf(view, roomy).left, 0);
  assert.equal(zoomAt(FIT, 2, 395, 200, roomy).x, -100);
});

test('the scale is never under fit and never over 4 times fit, or over actual size where that is more', () => {
  assert.deepEqual(zoomAt(FIT, 0.2, 100, 100, wide), FIT);
  assert.deepEqual(zoomAt({ s: 3, x: 10, y: 0 }, 0.01, 100, 100, wide), FIT, 'zooming all the way out lands back at the centre');
  assert.equal(zoomAt(FIT, 100, 100, 100, tall).s, 4);
  assert.equal(maxScale(tall), 4);
  assert.equal(zoomAt(FIT, 100, 100, 100, wide).s, wide.actual);
  assert.equal(maxScale(wide), wide.actual);
  assert.equal(maxScale({ ...wide, actual: 1 }), 4, 'a small picture can still be enlarged to 4 times');
});

test('actual size is exactly 1:1, the picture is as wide as its file', () => {
  for (const [box, width, height] of [[wide, 1600, 600], [tall, 600, 1800]]) {
    const view = zoomAt(FIT, box.actual, box.sw / 2, box.sh / 2, box);
    const { width: w, height: h } = rectOf(view, box);
    assert.ok(near(w, width) && near(h, height), `${width} by ${height}`);
    assert.equal(view.s, box.actual);
  }
});

test('actual size about the middle of the stage keeps the middle of the picture there, and the sides can then be reached', () => {
  const view = zoomAt(FIT, wide.actual, wide.sw / 2, wide.sh / 2, wide);
  assert.ok(near(view.x, 0), 'centred');
  const r = rectOf(view, wide);
  assert.ok(near(r.left + r.width / 2 + wide.b, wide.sw / 2), 'its middle is the stage\'s middle');
  assert.ok(r.top > 0 && r.top + r.height < wide.sh, 'a 600 tall picture is shorter than the stage, so it sits where fit put it');
});

test('at fit the picture is drawn where the page laid it out', () => {
  assert.deepEqual(rectOf(FIT, wide), { left: 16, top: 280.25, width: 356, height: 133.5 });
});

test('a view carries any other field along through every move', () => {
  const view = { s: 1, x: 0, y: 0, box: wide };
  assert.equal(zoomAt(view, 2, 100, 100, wide).box, wide);
  assert.equal(panBy({ ...view, s: 2 }, 5, 0, wide).box, wide);
  assert.equal(toFit({ ...view, s: 2, x: 4 }).box, wide);
  assert.equal(rebox({ ...view, s: 2 }, wide, wider).box, wide);
  assert.equal(rebox({ ...view, s: 2 }, wide, huge).box, wide, 'and when the stage has grown past it, to fit');
  assert.equal(pinchTo({ ...view, s: 2 }, pinchOf({ x: 100, y: 100 }, { x: 200, y: 100 }), pinchOf({ x: 90, y: 100 }, { x: 210, y: 100 }), wide).box, wide);
  assert.deepEqual(toFit({ s: 2, x: 4, y: 5 }), FIT);
});

test('a box is read from the stage and the fitted picture, and the border is not part of the picture', () => {
  const stage = { left: 0, top: 60, width: 390, height: 700 };
  const pic = { left: 16, top: 340.25, width: 358, height: 135.5 };
  assert.deepEqual(boxOf(stage, pic, 1, 1600), { sw: 390, sh: 700, cx: 195, cy: 348, w: 356, h: 133.5, b: 1, actual: 1600 / 356 });
  assert.equal(boxOf(stage, { ...pic, width: 2 }, 1, 1600), null, 'a picture with no size has no box');
});

test('a picture shown at its own size, or with no size of its own, has an actual size of 1 and is already at it', () => {
  const stage = { left: 0, top: 0, width: 390, height: 700 };
  const pic = { left: 85, top: 280, width: 222, height: 142 };
  assert.equal(boxOf(stage, pic, 1, 220).actual, 1);
  assert.equal(boxOf(stage, pic, 1, 0).actual, 1);
  assert.deepEqual([wide, tall, { ...wide, actual: 1.002 }, { ...wide, actual: 1.001 }, { ...wide, actual: 1 }].map(atOwnSize), [false, false, false, true, true]);
});

test('a stage that changes size leaves the picture the size it was on the screen, so the scale follows the new fit', () => {
  const view = { s: 2, x: 30, y: 0 };
  const now = rebox(view, wide, wider);
  assert.ok(near(now.s, 2 * 356 / 566));
  const [before, after] = [rectOf(view, wide), rectOf(now, wider)];
  assert.ok(near(after.width, before.width) && near(after.height, before.height), 'as wide and as high');
  const lifted = rebox({ s: 2.5, x: 20, y: -150 }, tall, taller);
  assert.ok(near(rectOf(lifted, taller).width, 2.5 * 686 / 3) && near(rectOf(lifted, taller).height, 2.5 * 686), 'and the same where the height decides the fit');
});

test('the part of the picture at the middle of the stage is still at the middle after the stage changes size', () => {
  const at = (v, box) => [(box.sw / 2 - box.cx - v.x) / (box.w * v.s), (box.sh / 2 - box.cy - v.y) / (box.h * v.s)];
  for (const [view, old, box] of [[{ s: 2, x: 30, y: 0 }, wide, wider], [{ s: 2.5, x: 20, y: -150 }, tall, taller]]) {
    const [was, now] = [at(view, old), at(rebox(view, old, box), box)];
    assert.ok(near(now[0], was[0]) && near(now[1], was[1]), `${was} before and ${now} after`);
  }
});

test('a stage that grows to the size the picture is on the screen, or past it, puts the picture at fit', () => {
  const view = { s: 2, x: 30, y: 0 };
  const exact = { sw: 744, sh: 700, cx: 372, cy: 348, w: 712, h: 267, b: 1, actual: 1600 / 712 };
  assert.deepEqual(rebox(view, wide, exact), FIT);
  assert.deepEqual(rebox(view, wide, huge), FIT);
});

test('the scale stops at the limit when a smaller stage would need more than it, and the offset from the centre follows the size', () => {
  const small = { sw: 400, sh: 300, cx: 200, cy: 150, w: 220, h: 140, b: 1, actual: 1 };
  const narrow = { sw: 200, sh: 300, cx: 100, cy: 150, w: 168, h: 107, b: 1, actual: 220 / 168 };
  const now = rebox({ s: 4, x: 100, y: 20 }, small, narrow);
  assert.equal(now.s, 4, '4 times the new fit is a smaller picture than 4 times the old');
  assert.ok(near(now.x, 100 * 672 / 880) && near(now.y, 20 * 428 / 560), '672 wide against 880 and 428 high against 560, so each offset is scaled by its own ratio');
});

test('a stage that changes and then changes back gives the view it began with', () => {
  for (const [view, old, box] of [[{ s: 2, x: 30, y: 0 }, wide, wider], [{ s: 2.5, x: 20, y: -150 }, tall, taller]]) {
    const back = rebox(rebox(view, old, box), box, old);
    assert.ok(near(back.s, view.s) && near(back.x, view.x) && near(back.y, view.y), JSON.stringify(back));
  }
});

test('a stage that changes where the fit size does not follow leaves the view as it was', () => {
  const view = { s: 2, x: 30, y: 0 };
  assert.deepEqual(rebox(view, wide, { ...wide, sh: 760, cy: 378 }), view, 'a toolbar folded away, for a picture that fits by its width');
  assert.deepEqual(rebox(view, wide, wide), view);
});

test('a wheel delta in lines is 16px each and in pages a stage high', () => {
  assert.equal(wheelPx(7, 0, 700), 7);
  assert.equal(wheelPx(3, 1, 700), 48);
  assert.equal(wheelPx(-1, 2, 700), -700);
});

test('ctrl and wheel up zooms in, down zooms out, and no one event does more than a step of about 1.6', () => {
  assert.ok(wheelZoom(-10) > 1 && wheelZoom(10) < 1);
  assert.equal(wheelZoom(0), 1);
  assert.ok(near(wheelZoom(-10) * wheelZoom(10), 1));
  assert.equal(wheelZoom(-500), wheelZoom(-50));
  assert.equal(wheelZoom(500), wheelZoom(50));
  assert.ok(wheelZoom(-500) < 1.7 && wheelZoom(500) > 0.6);
});

test('a trackpad pinch, sent as a wheel of minus 100 times the log of the scale, zooms by that scale', () => {
  for (const scale of [1.02, 1.2, 0.9, 1.5]) assert.ok(near(wheelZoom(-100 * Math.log(scale)), scale), String(scale));
});

test('a view under 1.05 settles to fit and one over it is left alone', () => {
  assert.deepEqual(settle({ s: 1.04, x: 6, y: 3 }), FIT);
  assert.deepEqual(settle({ s: 1.0001, x: 0, y: 0 }), FIT);
  const kept = { s: 1.05, x: 6, y: 3 };
  assert.equal(settle(kept), kept);
  assert.equal(settle(FIT), FIT);
  assert.equal(settle({ s: 2, x: 0, y: 0 }).s, 2);
});

test('the distance and middle of two fingers', () => {
  assert.deepEqual(pinchOf({ x: 0, y: 0 }, { x: 30, y: 40 }), { d: 50, x: 15, y: 20 });
  assert.deepEqual(pinchOf({ x: 10, y: 10 }, { x: 10, y: 10 }), { d: 0, x: 10, y: 10 });
  assert.equal(travelled({ x: 1, y: 1 }, { x: 4, y: 5 }), 5);
});

test('two fingers a constant distance apart dragged sideways at fit leave the picture at fit, whichever finger reports first', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const hands = [{ x: 40, y: 300 }, { x: 240, y: 300 }];
    const start = pinchOf(...hands);
    for (let step = 1; step <= 6; step++) {
      for (const n of order) hands[n] = { ...hands[n], x: hands[n].x + 25 };
      assert.deepEqual(pinchTo(FIT, start, pinchOf(...hands), wide), FIT, `step ${step} with finger ${order[0]} first`);
    }
  }
});

test('once the picture fills an axis, the part of it under the first midpoint of a pinch ends under the midpoint it has now', () => {
  const under = (v, px, py, box) => [(px - box.cx - v.x) / v.s, (py - box.cy - v.y) / v.s];
  const first = pinchOf({ x: 140, y: 250 }, { x: 140, y: 350 });
  const now = pinchOf({ x: 170, y: 150 }, { x: 170, y: 450 });
  const grown = pinchTo(FIT, first, now, wide);
  assert.equal(grown.s, 3);
  assert.ok(near(under(grown, now.x, now.y, wide)[0], under(FIT, first.x, first.y, wide)[0]), 'across, where it was narrower than the stage at the start');
  assert.equal(grown.y, 0, 'and along the axis it does not fill it stays where fit put it');
  const both = pinchTo(FIT, pinchOf({ x: 100, y: 240 }, { x: 200, y: 280 }), pinchOf({ x: 60, y: 210 }, { x: 260, y: 290 }), roomy);
  assert.equal(both.s, 2);
  const [fx, fy] = under(FIT, 150, 260, roomy);
  const [ux, uy] = under(both, 160, 250, roomy);
  assert.ok(near(ux, fx) && near(uy, fy), 'on both axes where the picture fills both');
});

test('spreading the fingers past the limit holds the scale at the limit, and closing them past fit holds it at fit', () => {
  const start = pinchOf({ x: 150, y: 200 }, { x: 250, y: 200 });
  const spread = d => pinchTo(FIT, start, { d, x: 200, y: 200 }, roomy);
  assert.equal(spread(400).s, 4);
  assert.deepEqual(spread(40000), spread(400));
  assert.deepEqual(spread(1), FIT);
  assert.deepEqual(pinchTo({ s: 3, x: 40, y: 0 }, start, { d: 1, x: 200, y: 200 }, roomy), FIT);
});

test('a pinch that has not moved leaves the view as it was', () => {
  const start = pinchOf({ x: 120, y: 260 }, { x: 230, y: 330 });
  for (const view of [FIT, { s: 2.5, x: 40, y: -20 }, { s: 4, x: -100, y: 100 }]) assert.deepEqual(pinchTo(view, start, start, roomy), view);
});

test('fingers that start on one spot cannot tell a scale, so they only pan', () => {
  const start = pinchOf({ x: 100, y: 200 }, { x: 100, y: 200 });
  assert.deepEqual(pinchTo({ s: 2, x: 0, y: 0 }, start, { d: 80, x: 130, y: 210 }, roomy), { s: 2, x: 30, y: 10 });
});

test('a tap is a press of under 300ms that moved under 10px', () => {
  const down = { x: 100, y: 100, t: 1000 };
  assert.equal(isTap(down, { x: 100, y: 100, t: 1100 }), true);
  assert.equal(isTap(down, { x: 105, y: 108, t: 1299 }), true, '9.4px and 299ms');
  assert.equal(isTap(down, { x: 100, y: 100, t: 1300 }), false);
  assert.equal(isTap(down, { x: 106, y: 108.1, t: 1100 }), false, '10.08px away');
  assert.equal(isTap(down, { x: 100, y: 110, t: 1100 }), false, 'exactly 10px is too far');
});

test('two taps are a double tap when their ups are at most 300ms and 30px apart', () => {
  const first = { x: 100, y: 100, t: 1000 };
  assert.equal(isDoubleTap(first, { x: 100, y: 100, t: 1150 }), true);
  assert.equal(isDoubleTap(first, { x: 118, y: 124, t: 1300 }), true, '30px away and 300ms later');
  assert.equal(isDoubleTap(first, { x: 100, y: 100, t: 1301 }), false);
  assert.equal(isDoubleTap(first, { x: 118, y: 124.1, t: 1100 }), false);
});

test('a double tap zooms in to 2.5 times fit, which every picture can reach', () => {
  assert.equal(DOUBLE_TAP_ZOOM, 2.5);
  for (const box of [wide, tall, roomy, { ...wide, actual: 1 }]) assert.equal(zoomAt(FIT, DOUBLE_TAP_ZOOM, 200, 300, box).s, 2.5);
});
