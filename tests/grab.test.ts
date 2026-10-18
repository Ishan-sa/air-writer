import { describe, expect, it } from 'vitest';
import { applyGrab, canvasMatrix, grabTransform } from '../src/wall/transform';
import { TwoHandGrab } from '../src/tracking/grab';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('two-hand transform math', () => {
  // a 16:9 wall: points are in wall units (0..1 on each axis), so rotation must
  // happen in real proportions, not in squashed 0..1 space
  const aspect = 16 / 9;

  it('maps the starting hand positions exactly onto the current ones', () => {
    const a0 = { x: 0.3, y: 0.5 }, b0 = { x: 0.6, y: 0.5 };
    const a = { x: 0.4, y: 0.3 }, b = { x: 0.55, y: 0.7 };
    const T = grabTransform(a0, b0, a, b, aspect);
    const pa = applyGrab(T, a0, aspect), pb = applyGrab(T, b0, aspect);
    close(pa.x, a.x); close(pa.y, a.y);
    close(pb.x, b.x); close(pb.y, b.y);
  });

  it('moving both hands together slides the writing', () => {
    const T = grabTransform({ x: 0.3, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.4, y: 0.6 }, { x: 0.7, y: 0.6 }, aspect);
    const p = applyGrab(T, { x: 0.45, y: 0.2 }, aspect);
    close(p.x, 0.55); close(p.y, 0.3);
  });

  it('spreading the hands to twice the distance doubles the size around them', () => {
    const T = grabTransform({ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.3, y: 0.5 }, { x: 0.7, y: 0.5 }, aspect);
    const p = applyGrab(T, { x: 0.5, y: 0.45 }, aspect); // a point between the hands, slightly above
    close(p.x, 0.5); close(p.y, 0.4);
  });

  it('twisting the hands a quarter turn rotates in real wall proportions', () => {
    // hands side by side → one above the other, around the same middle
    const mid = { x: 0.5, y: 0.5 };
    const dx = 0.1, dy = (0.1 * aspect); // same physical distance vertically
    const T = grabTransform({ x: mid.x - dx, y: mid.y }, { x: mid.x + dx, y: mid.y }, { x: mid.x, y: mid.y - dy }, { x: mid.x, y: mid.y + dy }, aspect);
    // a point to the right of the middle ends up below it, at the same physical distance
    const p = applyGrab(T, { x: 0.55, y: 0.5 }, aspect);
    close(p.x, 0.5, 1e-9);
    close(p.y, 0.5 + 0.05 * aspect, 1e-9);
    expect(T.scale).toBeCloseTo(1, 9);
  });

  it('the canvas matrix draws exactly what the math says', () => {
    const W = 1920, H = 1080;
    const T = grabTransform({ x: 0.3, y: 0.4 }, { x: 0.6, y: 0.55 }, { x: 0.35, y: 0.3 }, { x: 0.7, y: 0.6 }, W / H);
    const [a, b, c, d, e, f] = canvasMatrix(T, H);
    const p = { x: 0.42, y: 0.61 };
    const q = applyGrab(T, p, W / H);
    close(a * p.x * W + c * p.y * H + e, q.x * W, 1e-6);
    close(b * p.x * W + d * p.y * H + f, q.y * H, 1e-6);
  });

  it('limits how far one grab can shrink or grow the writing', () => {
    const tiny = grabTransform({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.501, y: 0.5 }, aspect);
    const huge = grabTransform({ x: 0.49, y: 0.5 }, { x: 0.51, y: 0.5 }, { x: 0.0, y: 0.5 }, { x: 1.0, y: 0.5 }, aspect);
    expect(tiny.scale).toBeGreaterThanOrEqual(0.25);
    expect(huge.scale).toBeLessThanOrEqual(4);
  });
});

const FRAME = 33;
describe('two-hand grab gesture', () => {
  const both = (ax = 0.3, bx = 0.7) => ({ hands: 2, aOpen: true, bOpen: true, a: { x: ax, y: 0.5 }, b: { x: bx, y: 0.5 }, penDown: false });
  const one = { hands: 1, aOpen: true, bOpen: false, a: { x: 0.3, y: 0.5 }, b: { x: 0, y: 0 }, penDown: false };

  it('grabs after both hands have been open for a moment, then follows them', () => {
    const g = new TwoHandGrab();
    const out = Array.from({ length: 10 }, (_, i) => g.update(both(), i * FRAME));
    expect(out.filter((o) => o.event === 'start')).toHaveLength(1);
    const moved = g.update(both(0.35, 0.75), 10 * FRAME);
    expect(moved.event).toBe('move');
    expect(moved.a!.x).toBeCloseTo(0.35);
  });

  it('one open hand is not a grab', () => {
    const g = new TwoHandGrab();
    const out = Array.from({ length: 20 }, (_, i) => g.update(one, i * FRAME));
    expect(out.some((o) => o.event)).toBe(false);
  });

  it('a quick flash of two hands is not a grab', () => {
    const g = new TwoHandGrab();
    const out = [0, 1, 2].map((i) => g.update(both(), i * FRAME));
    const after = Array.from({ length: 10 }, (_, i) => g.update(one, (3 + i) * FRAME));
    expect([...out, ...after].some((o) => o.event === 'start')).toBe(false);
  });

  it('lets go when either hand closes or leaves, after a short grace', () => {
    const g = new TwoHandGrab();
    let t = 0;
    for (let i = 0; i < 10; i++) g.update(both(), (t = i * FRAME));
    const ends = Array.from({ length: 8 }, (_, i) => g.update({ ...both(), bOpen: false }, t + (i + 1) * FRAME));
    expect(ends.filter((o) => o.event === 'end')).toHaveLength(1);
    expect(g.active).toBe(false);
  });

  it('a one-frame tracking blip does not drop the grab', () => {
    const g = new TwoHandGrab();
    let t = 0;
    for (let i = 0; i < 10; i++) g.update(both(), (t = i * FRAME));
    g.update(one, t + FRAME);
    expect(g.update(both(), t + 2 * FRAME).event).toBe('move');
  });

  it('never grabs while the pen is down', () => {
    const g = new TwoHandGrab();
    const out = Array.from({ length: 20 }, (_, i) => g.update({ ...both(), penDown: true }, i * FRAME));
    expect(out.some((o) => o.event)).toBe(false);
  });
});
