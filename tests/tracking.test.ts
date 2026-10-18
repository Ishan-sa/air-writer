import { describe, expect, it } from 'vitest';
import { applyHomography, computeHomography, isUsableQuad } from '../src/tracking/homography';
import { OneEuroFilter, PointFilter } from '../src/tracking/oneEuro';
import { fingerReach, handInFrame, isOpenPalm, PalmHold, PinchDetector, pinchRatio, PointDetector, type Lm } from '../src/tracking/gestures';
import { CALIB_CORNERS, cameraToWall, defaultMap } from '../src/tracking/mapping';
import { addPoint, LazyBrush, smoothStroke, trimTail, type Stroke } from '../src/wall/strokes';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('homography', () => {
  it('maps the four source points exactly onto the targets', () => {
    // a skewed quad, like a hand pointing at the corners seen from an angle
    const src = [
      { x: 0.62, y: 0.31 },
      { x: 0.35, y: 0.28 },
      { x: 0.38, y: 0.66 },
      { x: 0.6, y: 0.7 },
    ];
    const H = computeHomography(src, CALIB_CORNERS)!;
    expect(H).not.toBeNull();
    src.forEach((p, i) => {
      const q = applyHomography(H, p);
      close(q.x, CALIB_CORNERS[i].x);
      close(q.y, CALIB_CORNERS[i].y);
    });
  });

  it('keeps straight lines straight (midpoint of an edge stays on that edge)', () => {
    const src = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const H = computeHomography(src, CALIB_CORNERS)!;
    const q = applyHomography(H, { x: 0.5, y: 0 });
    close(q.y, 0.1);
    close(q.x, 0.5);
  });

  it('rejects degenerate input', () => {
    const line = [0, 1, 2, 3].map((i) => ({ x: i * 0.1, y: i * 0.1 }));
    expect(computeHomography(line, CALIB_CORNERS)).toBeNull();
  });

  it('accepts a convex quad and rejects a twisted or tiny one', () => {
    expect(isUsableQuad(CALIB_CORNERS)).toBe(true);
    const twisted = [CALIB_CORNERS[0], CALIB_CORNERS[2], CALIB_CORNERS[1], CALIB_CORNERS[3]];
    expect(isUsableQuad(twisted)).toBe(false);
    const tiny = CALIB_CORNERS.map((p) => ({ x: p.x * 0.01, y: p.y * 0.01 }));
    expect(isUsableQuad(tiny)).toBe(false);
  });
});

describe('mapping', () => {
  it('default map sends the image centre to the wall centre and mirrors x', () => {
    const c = defaultMap({ x: 0.5, y: 0.425 }, true);
    close(c.x, 0.5);
    close(c.y, 0.5);
    // hand on the image's left = Ishan's right = the wall's right
    expect(defaultMap({ x: 0.3, y: 0.4 }, true).x).toBeGreaterThan(0.5);
    expect(defaultMap({ x: 0.3, y: 0.4 }, false).x).toBeLessThan(0.5);
  });

  it('uses the homography when calibrated', () => {
    const src = [
      { x: 0.7, y: 0.2 },
      { x: 0.3, y: 0.2 },
      { x: 0.3, y: 0.6 },
      { x: 0.7, y: 0.6 },
    ];
    const H = computeHomography(src, CALIB_CORNERS)!;
    const q = cameraToWall({ x: 0.5, y: 0.4 }, H, false)!;
    close(q.x, 0.5);
    close(q.y, 0.5);
  });
});

describe('mapping guards', () => {
  it('clamps points far outside the wall', () => {
    const q = cameraToWall({ x: -2, y: 5 }, null, false)!;
    expect(q.x).toBeGreaterThanOrEqual(-0.2);
    expect(q.y).toBeLessThanOrEqual(1.2);
  });

  it('returns null past the perspective horizon instead of flipping to the other side', () => {
    // a strongly tilted calibration: w = 0 somewhere to the right of the image
    const src = [
      { x: 0.4, y: 0.3 },
      { x: 0.6, y: 0.35 },
      { x: 0.6, y: 0.55 },
      { x: 0.4, y: 0.6 },
    ];
    const H = computeHomography(src, CALIB_CORNERS)!;
    const xs = Array.from({ length: 200 }, (_, i) => -20 + i * 0.2);
    const results = xs.map((x) => cameraToWall({ x, y: 0.45 }, H, false));
    expect(results.some((r) => r === null)).toBe(true);
    expect(cameraToWall({ x: 0.5, y: 0.45 }, H, false)).not.toBeNull();
  });
});

describe('one euro filter', () => {
  it('passes a constant signal through unchanged', () => {
    const f = new OneEuroFilter();
    for (let i = 0; i < 30; i++) close(f.filter(0.4, i / 60), 0.4);
  });

  it('reduces jitter on a still hand', () => {
    const p = new PointFilter();
    p.setSmoothing(0.5);
    const out: number[] = [];
    for (let i = 0; i < 120; i++) out.push(p.filter(0.5 + (i % 2 ? 0.01 : -0.01), 0.5, i / 60).x);
    const tail = out.slice(60);
    const spread = Math.max(...tail) - Math.min(...tail);
    expect(spread).toBeLessThan(0.02 * 0.5); // at least halves a ±1% wobble
  });

  it('keeps up with a fast stroke (lag stays small)', () => {
    const p = new PointFilter();
    p.setSmoothing(0.5);
    let x = 0;
    for (let i = 0; i <= 30; i++) x = p.filter(i / 30, 0.5, i / 60).x; // across the wall in 0.5 s
    expect(1 - x).toBeLessThan(0.08);
  });
});

/** Builds world landmarks for a hand: 21 points, metres-ish scale. */
function hand(opts: { pinch?: boolean; open?: boolean; point?: boolean }): Lm[] {
  const lm: Lm[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (i: number, x: number, y: number) => (lm[i] = { x, y, z: 0 });
  set(0, 0, 0); // wrist
  set(9, 0, -0.09); // middle MCP → hand size 0.09
  set(5, -0.025, -0.085); // index MCP
  set(13, 0.02, -0.085);
  set(17, 0.04, -0.075);
  const fingerX = opts.open ? [-0.045, -0.012, 0.022, 0.055] : [-0.025, 0, 0.02, 0.04];
  const curled = !opts.open;
  [
    [6, 8],
    [10, 12],
    [14, 16],
    [18, 20],
  ].forEach(([pip, tip], k) => {
    const straight = !curled || (opts.point && k === 0);
    set(pip, fingerX[k], -0.12);
    set(tip, fingerX[k] * (opts.open ? 1.3 : 1), straight ? -0.17 : -0.1);
  });
  set(3, -0.05, -0.04);
  set(4, opts.open ? -0.085 : -0.04, opts.open ? -0.06 : -0.09); // thumb tip
  if (opts.pinch) set(4, lm[8].x + 0.005, lm[8].y + 0.005);
  return lm;
}

describe('pointing (index out, other fingers curled)', () => {
  it('measures how far each finger reaches out', () => {
    const r = fingerReach(hand({ point: true }));
    expect(r.index).toBeGreaterThan(1.25);
    expect(Math.max(r.middle, r.ring, r.pinky)).toBeLessThan(1.0);
  });

  it('a pointing hand starts writing after two frames', () => {
    const d = new PointDetector();
    expect(d.update(hand({ point: true }))).toBe(false);
    expect(d.update(hand({ point: true }))).toBe(true);
  });

  it('an open hand, a fist or a pinch does not write', () => {
    for (const h of [hand({ open: true }), hand({}), hand({ pinch: true })]) {
      const d = new PointDetector();
      [1, 2, 3, 4].forEach(() => d.update(h));
      expect(d.down).toBe(false);
    }
  });

  it('opening the hand or curling the index finger lifts the pen, after three frames', () => {
    for (const lift of [hand({ open: true }), hand({})]) {
      const d = new PointDetector();
      d.update(hand({ point: true }));
      d.update(hand({ point: true }));
      expect(d.update(lift)).toBe(true);
      expect(d.update(lift)).toBe(true);
      expect(d.update(lift)).toBe(false);
    }
  });

  it('stays down when the index reading wobbles to ~1.05-1.1 but the other fingers stay curled (recorded)', () => {
    // build a pointing hand, then shorten the index fingertip so its reach reads ~1.05
    const wobble = () => {
      const h = hand({ point: true });
      h[8] = { x: h[8].x, y: -0.126, z: 0 }; // tip barely past the middle joint
      return h;
    };
    expect(fingerReach(wobble()).index).toBeGreaterThan(0.95);
    expect(fingerReach(wobble()).index).toBeLessThan(1.1);
    const d = new PointDetector();
    d.update(hand({ point: true }));
    d.update(hand({ point: true }));
    const states = Array.from({ length: 6 }, () => d.update(wobble()));
    expect(states.every(Boolean)).toBe(true);
  });

  it('a one-frame wobble mid-stroke does not lift the pen', () => {
    const d = new PointDetector();
    d.update(hand({ point: true }));
    d.update(hand({ point: true }));
    d.update(hand({}));
    expect(d.update(hand({ point: true }))).toBe(true);
  });
});

describe('pinch detection', () => {
  it('measures a pinch as a small ratio', () => {
    expect(pinchRatio(hand({ pinch: true }))).toBeLessThan(0.2);
    expect(pinchRatio(hand({ open: true }))).toBeGreaterThan(0.6);
  });

  it('needs two frames to start, three to lift, and ignores short blips', () => {
    const d = new PinchDetector();
    expect(d.update(0.1)).toBe(false);
    expect(d.update(0.1)).toBe(true);
    expect(d.update(0.9)).toBe(true); // single frame open: still down
    expect(d.update(0.1)).toBe(true);
    expect(d.update(0.9)).toBe(true);
    expect(d.update(0.9)).toBe(true);
    expect(d.update(0.9)).toBe(false);
  });

  it('uses hysteresis: hovering between thresholds keeps the current state', () => {
    const d = new PinchDetector();
    d.setDownThreshold(0.3); // up at 0.45
    d.update(0.2);
    d.update(0.2);
    expect(d.down).toBe(true);
    for (let i = 0; i < 5; i++) d.update(0.4);
    expect(d.down).toBe(true);
    const fresh = new PinchDetector();
    fresh.setDownThreshold(0.3);
    for (let i = 0; i < 5; i++) fresh.update(0.4);
    expect(fresh.down).toBe(false);
  });
});

describe('pinch thresholds on real recorded readings', () => {
  // finger-gap ratios recorded from Ishan's hand (logs/diag.jsonl, first live test)
  const held = [0.28, 0.31, 0.33, 0.29, 0.36, 0.4, 0.37, 0.33];
  const circling = [0.41, 0.45, 0.48, 0.51, 0.47, 0.44, 0.49, 0.5];
  const open = [0.68, 0.72, 0.95, 1.2];

  it('a held pinch and a pinch moving through a circle stay down the whole time', () => {
    const d = new PinchDetector();
    const states = [...held, ...circling].map((r) => d.update(r));
    // down after the two-frame debounce, and never lifts mid-stroke
    expect(states.slice(2).every(Boolean)).toBe(true);
  });

  it('opening the hand lifts the pen', () => {
    const d = new PinchDetector();
    [...held, ...open].forEach((r) => d.update(r));
    expect(d.down).toBe(false);
  });

  it('a relaxed, half-open hand moving around does not start writing', () => {
    // recorded while moving between strokes without pinching
    const relaxed = [0.46, 0.55, 0.62, 0.53, 0.41, 0.56, 0.48, 0.65];
    const d = new PinchDetector();
    expect(relaxed.map((r) => d.update(r)).some(Boolean)).toBe(false);
  });
});

describe('pinch while moving fast (both measures must agree to lift)', () => {
  // recorded: while a pinch is held and moving, the 3D reading drifts up to ~0.6
  // but the flat on-camera fingertip gap stays tight (~0.24-0.5)
  it('stays down when only the 3D reading drifts open', () => {
    const d = new PinchDetector();
    d.update(0.3, 0.3);
    d.update(0.3, 0.3);
    expect(d.down).toBe(true);
    const drift = [0.58, 0.62, 0.66, 0.64, 0.6, 0.63];
    const states = drift.map((r) => d.update(r, 0.32));
    expect(states.every(Boolean)).toBe(true);
  });

  it('lifts when both measures say the fingers opened', () => {
    const d = new PinchDetector();
    d.update(0.3, 0.3);
    d.update(0.3, 0.3);
    [0.7, 0.72, 0.75, 0.8].forEach((r) => d.update(r, 1.4));
    expect(d.down).toBe(false);
  });

  it('still needs a clear pinch on the 3D reading to start', () => {
    // fingertips overlapping on camera alone (thumb behind the finger) must not start a stroke
    const d = new PinchDetector();
    [0.62, 0.65, 0.6, 0.64].forEach((r) => d.update(r, 0.3));
    expect(d.down).toBe(false);
  });

  it('ignores a two-frame blip open in the middle of a fast stroke', () => {
    const d = new PinchDetector();
    d.update(0.3, 0.3);
    d.update(0.3, 0.3);
    d.update(0.75, 1.2);
    d.update(0.75, 1.2);
    expect(d.down).toBe(true);
    d.update(0.3, 0.3);
    expect(d.down).toBe(true);
  });
});

describe('hand at the frame edge', () => {
  const at = (x: number, y: number) => Array.from({ length: 21 }, (_, i) => ({ x: x + (i % 5) * 0.01, y: y + Math.floor(i / 5) * 0.01, z: 0 }));

  it('accepts a hand well inside the frame', () => {
    expect(handInFrame(at(0.4, 0.5))).toBe(true);
  });

  it('rejects a hand cut off by the bottom edge (recorded while writing "Hello")', () => {
    expect(handInFrame(at(0.45, 0.97))).toBe(false);
  });

  it('rejects a hand cut off by a side edge', () => {
    expect(handInFrame(at(-0.02, 0.5))).toBe(false);
    expect(handInFrame(at(0.97, 0.5))).toBe(false);
  });
});

describe('open palm wipe', () => {
  it('recognises a spread open hand but not a relaxed or pinching one', () => {
    expect(isOpenPalm(hand({ open: true }))).toBe(true);
    expect(isOpenPalm(hand({}))).toBe(false);
    expect(isOpenPalm(hand({ pinch: true }))).toBe(false);
  });

  it('fires once after a full one-second hold', () => {
    const h = new PalmHold(1000, 150);
    let fired = 0;
    for (let t = 0; t <= 2000; t += 33) if (h.update(true, t).fire) fired++;
    expect(fired).toBe(1);
  });

  it('does not fire when the palm drops before a second', () => {
    const h = new PalmHold(1000, 150);
    let fired = false;
    for (let t = 0; t < 800; t += 33) fired ||= h.update(true, t).fire;
    for (let t = 800; t < 1200; t += 33) fired ||= h.update(false, t).fire;
    for (let t = 1200; t < 1900; t += 33) fired ||= h.update(true, t).fire;
    expect(fired).toBe(false);
  });

  it('tolerates a brief tracking dropout during the hold', () => {
    const h = new PalmHold(1000, 150);
    let fired = false;
    for (let t = 0; t < 500; t += 33) fired ||= h.update(true, t).fire;
    fired ||= h.update(false, 533).fire;
    for (let t = 566; t < 1200; t += 33) fired ||= h.update(true, t).fire;
    expect(fired).toBe(true);
  });
});

describe('strokes', () => {
  it('skips points closer than the minimum step', () => {
    const s: Stroke = [];
    expect(addPoint(s, { x: 0.5, y: 0.5, t: 0 })).toBe(true);
    expect(addPoint(s, { x: 0.5001, y: 0.5, t: 16 })).toBe(false);
    expect(addPoint(s, { x: 0.51, y: 0.5, t: 33 })).toBe(true);
  });

  it('trims the release drag but keeps a dot for a tap', () => {
    const s: Stroke = Array.from({ length: 10 }, (_, i) => ({ x: i / 10, y: 0, t: i * 20 }));
    const trimmed = trimTail(s, 70);
    expect(trimmed[trimmed.length - 1].t).toBeLessThanOrEqual(180 - 70);
    expect(trimTail([{ x: 0, y: 0, t: 0 }, { x: 0.01, y: 0, t: 10 }], 70)).toHaveLength(1);
  });

  it('measures the trim from the pen-up moment, so a pause before lifting keeps the ink', () => {
    const s: Stroke = Array.from({ length: 10 }, (_, i) => ({ x: i / 10, y: 0, t: i * 20 }));
    // last point at 180 ms, pen lifted at 400 ms after holding still: nothing to trim
    expect(trimTail(s, 70, 400)).toHaveLength(10);
  });
});

describe('stroke smoothing', () => {
  // ~6 wall px of zig-zag wobble on a 1920 px wall: what the recorded strokes showed
  const wobble = 6 / 1920;

  it('takes most of the wobble out of a shaky straight line', () => {
    const shaky: Stroke = Array.from({ length: 60 }, (_, i) => ({ x: 0.2 + i * 0.008, y: 0.5 + (i % 2 ? wobble : -wobble), t: i * 17 }));
    const smooth = smoothStroke(shaky);
    const dev = (s: Stroke) => Math.max(...s.slice(5, -5).map((p) => Math.abs(p.y - 0.5)));
    expect(dev(smooth)).toBeLessThan(dev(shaky) * 0.3);
  });

  it('keeps both ends exactly where they were (the pen tip never lags)', () => {
    const s: Stroke = Array.from({ length: 30 }, (_, i) => ({ x: i * 0.01, y: Math.sin(i) * 0.01, t: i * 17 }));
    const out = smoothStroke(s);
    expect(out[0]).toEqual(s[0]);
    expect(out.at(-1)).toEqual(s.at(-1));
    expect(out).toHaveLength(s.length);
  });

  it('keeps the shape of a letter: a circle barely shrinks', () => {
    const r = 0.05;
    const circle: Stroke = Array.from({ length: 80 }, (_, i) => {
      const a = (i / 79) * Math.PI * 2;
      return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a), t: i * 17 };
    });
    const out = smoothStroke(circle);
    const radii = out.slice(5, -5).map((p) => Math.hypot(p.x - 0.5, p.y - 0.5));
    expect(Math.min(...radii)).toBeGreaterThan(r * 0.97);
  });

  it('leaves short strokes alone', () => {
    const s: Stroke = [{ x: 0, y: 0, t: 0 }, { x: 0.01, y: 0.01, t: 17 }];
    expect(smoothStroke(s)).toEqual(s);
  });
});

describe('string stabilizer (lazy brush)', () => {
  const R = 0.01;

  it('ignores wobble shorter than the string', () => {
    const b = new LazyBrush(R);
    b.reset({ x: 0.5, y: 0.5 });
    for (let i = 0; i < 50; i++) {
      // recorded-size wobble: a few pixels around a resting finger
      const p = b.follow({ x: 0.5 + (Math.random() - 0.5) * 0.008, y: 0.5 + (Math.random() - 0.5) * 0.008 });
      expect(p.x).toBe(0.5);
      expect(p.y).toBe(0.5);
    }
  });

  it('is dragged along by real movement, trailing by the string length', () => {
    const b = new LazyBrush(R);
    b.reset({ x: 0.2, y: 0.5 });
    let p = { x: 0.2, y: 0.5 };
    for (let i = 1; i <= 40; i++) p = b.follow({ x: 0.2 + i * 0.01, y: 0.5 });
    expect(p.y).toBeCloseTo(0.5, 9);
    expect(0.6 - p.x).toBeCloseTo(R, 9);
  });

  it('smooths a shaky line far more than the shake itself', () => {
    const b = new LazyBrush(R);
    b.reset({ x: 0.2, y: 0.5 });
    const ys: number[] = [];
    for (let i = 1; i <= 80; i++) ys.push(b.follow({ x: 0.2 + i * 0.005, y: 0.5 + (i % 2 ? 0.004 : -0.004) }).y);
    const spread = Math.max(...ys.slice(10)) - Math.min(...ys.slice(10));
    expect(spread).toBeLessThan(0.008 * 0.25);
  });

  it('with no string it follows exactly', () => {
    const b = new LazyBrush(0);
    b.reset({ x: 0, y: 0 });
    expect(b.follow({ x: 0.3, y: 0.4 })).toEqual({ x: 0.3, y: 0.4 });
  });
});

