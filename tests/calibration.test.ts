import { describe, expect, it } from 'vitest';
import { Calibration } from '../src/tracking/calibration';
import { applyHomography } from '../src/tracking/homography';
import { CALIB_CORNERS } from '../src/tracking/mapping';

// where the pen shows up in the camera image when Ishan points at each corner
const CAM = [
  { x: 0.66, y: 0.3 },
  { x: 0.36, y: 0.29 },
  { x: 0.38, y: 0.62 },
  { x: 0.63, y: 0.64 },
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
