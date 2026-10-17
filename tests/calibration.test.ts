import { describe, expect, it } from 'vitest';
import { Calibration } from '../src/tracking/calibration';
import { applyHomography } from '../src/tracking/homography';
import { CALIB_CORNERS } from '../src/tracking/mapping';

// where the pen shows up in the camera image at each corner of the writing area
// (a parallelogram: the camera faces Ishan, so his right is the image's left)
const CAM = [
  { x: 0.66, y: 0.3 },
  { x: 0.36, y: 0.3 },
  { x: 0.38, y: 0.64 },
  { x: 0.68, y: 0.64 },
];

// Ishan's second calibration from the first live test (logs/diag.jsonl): lopsided,
// wider at the bottom. The old perspective fit blew this up and flipped ink.
const RECORDED = [
  { x: 0.4592, y: 0.5232 },
  { x: 0.3732, y: 0.4385 },
  { x: 0.3902, y: 0.7224 },
  { x: 0.5522, y: 0.6976 },
];

/** Simulates pointing at a corner, pinching for `ms`, then releasing. */
function pinchAt(c: Calibration, p: { x: number; y: number }, t0: number, ms = 400) {
  let ev = null;
  for (let t = t0; t <= t0 + ms; t += 33) ev = c.update(p, true, t) ?? ev;
  c.update(p, false, t0 + ms + 33);
  return ev;
}

describe('calibration', () => {
  it('captures four pinches and produces a mapping that hits every corner', () => {
    const c = new Calibration();
    c.start();
    c.update(CAM[0], false, 0); // pen up at start
    let ev = null;
    CAM.forEach((p, i) => (ev = pinchAt(c, p, 1000 * (i + 1))));
    expect(ev).toMatchObject({ kind: 'done' });
    const H = (ev as any).H;
    CAM.forEach((p, i) => {
      const q = applyHomography(H, p);
      expect(Math.abs(q.x - CALIB_CORNERS[i].x)).toBeLessThan(1e-6);
      expect(Math.abs(q.y - CALIB_CORNERS[i].y)).toBeLessThan(1e-6);
    });
    expect(c.active).toBe(false);
  });

  it('turns a lopsided recorded calibration into a smooth mapping that never flips', () => {
    const c = new Calibration();
    c.start();
    c.update(RECORDED[0], false, 0);
    let ev = null;
    RECORDED.forEach((p, i) => (ev = pinchAt(c, p, 1000 * (i + 1))));
    expect(ev).toMatchObject({ kind: 'done' });
    const H = (ev as any).H;
    // sweep the hand right-to-left across the camera (= left-to-right on the wall)
    const xs: number[] = [];
    for (let x = 0.6; x >= 0.3; x -= 0.01) xs.push(applyHomography(H, { x, y: 0.6 }).x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    // the centre of the four points lands near the middle of the wall
    const cx = RECORDED.reduce((a, p) => a + p.x, 0) / 4, cy = RECORDED.reduce((a, p) => a + p.y, 0) / 4;
    const mid = applyHomography(H, { x: cx, y: cy });
    expect(Math.abs(mid.x - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(mid.y - 0.5)).toBeLessThan(0.1);
  });

  it('asks for a redo when the hand barely moved between corners', () => {
    // Ishan's first calibration: pointing from a distance, the hand moved ~50 px between bottom corners
    const tiny = [
      { x: 0.47, y: 0.55 },
      { x: 0.43, y: 0.55 },
      { x: 0.43, y: 0.6 },
      { x: 0.47, y: 0.6 },
    ];
    const c = new Calibration();
    c.start();
    c.update(tiny[0], false, 0);
    let ev: any = null;
    tiny.forEach((p, i) => (ev = pinchAt(c, p, 1000 * (i + 1))));
    expect(ev.kind).toBe('failed');
    expect(ev.reason).toMatch(/move your hand/i);
  });

  it('ignores a pinch that was already held when calibration started', () => {
    const c = new Calibration();
    c.start();
    for (let t = 0; t < 1000; t += 33) expect(c.update(CAM[0], true, t)).toBeNull();
    expect(c.step).toBe(0);
  });

  it('a quick accidental pinch (shorter than the hold) does not capture', () => {
    const c = new Calibration();
    c.start();
    c.update(CAM[0], false, 0);
    expect(pinchAt(c, CAM[0], 100, 150)).toBeNull();
    expect(c.step).toBe(0);
  });

  it('fails cleanly when the corners were pointed at in the wrong order', () => {
    const c = new Calibration();
    c.start();
    c.update(CAM[0], false, 0);
    const wrong = [CAM[0], CAM[2], CAM[1], CAM[3]];
    let ev = null;
    wrong.forEach((p, i) => (ev = pinchAt(c, p, 1000 * (i + 1))));
    expect(ev).toMatchObject({ kind: 'failed' });
  });

  it('Space capture refuses a stale position (hand out of view)', () => {
    const c = new Calibration();
    c.start();
    c.update(CAM[0], false, 0);
    expect(c.captureNow(500)).toBeNull();
    expect(c.captureNow(50)).toMatchObject({ kind: 'captured', step: 0 });
    // the same sample can't be reused for the next corner
    expect(c.captureNow(60)).toBeNull();
  });
});
