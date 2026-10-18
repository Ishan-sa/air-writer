import type { WallPoint } from '../shared/types';

/**
 * The two-hand grab as a similarity transform (move, rotate, uniform scale)
 * that carries where the hands started (a0, b0) to where they are now (a, b).
 *
 * Wall points are 0..1 on each axis, which squashes a 16:9 wall into a square,
 * so the math runs in real proportions: x is stretched by the wall's aspect
 * ratio (width / height) first. Otherwise a twist would skew the writing.
 */
export interface GrabTransform {
  scale: number;
  cos: number;
  sin: number;
  a0: { X: number; Y: number }; // in real proportions
  a: { X: number; Y: number };
}

/** One grab can shrink the writing to a quarter or grow it four times. */
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

export function grabTransform(a0: WallPoint, b0: WallPoint, a: WallPoint, b: WallPoint, aspect: number): GrabTransform {
  const A0 = { X: a0.x * aspect, Y: a0.y }, B0 = { X: b0.x * aspect, Y: b0.y };
  const A = { X: a.x * aspect, Y: a.y }, B = { X: b.x * aspect, Y: b.y };
  const v0 = { X: B0.X - A0.X, Y: B0.Y - A0.Y }, v = { X: B.X - A.X, Y: B.Y - A.Y };
  const len0 = Math.hypot(v0.X, v0.Y), len = Math.hypot(v.X, v.Y);
  const scale = len0 < 1e-6 ? 1 : Math.min(Math.max(len / len0, MIN_SCALE), MAX_SCALE);
  const angle = Math.atan2(v.Y, v.X) - Math.atan2(v0.Y, v0.X);
  return { scale, cos: Math.cos(angle), sin: Math.sin(angle), a0: A0, a: A };
}

export function applyGrab(T: GrabTransform, p: WallPoint, aspect: number): WallPoint {
  const dx = p.x * aspect - T.a0.X, dy = p.y - T.a0.Y;
  const X = T.a.X + T.scale * (T.cos * dx - T.sin * dy);
  const Y = T.a.Y + T.scale * (T.sin * dx + T.cos * dy);
  return { x: X / aspect, y: Y };
}

/**
 * The same transform as a canvas matrix for a canvas H pixels tall (pixels are
 * real proportions times H), for ctx.setTransform(a, b, c, d, e, f).
 */
export function canvasMatrix(T: GrabTransform, H: number): [number, number, number, number, number, number] {
  const a = T.scale * T.cos, b = T.scale * T.sin, c = -b, d = a;
  const ax0 = T.a0.X * H, ay0 = T.a0.Y * H;
  return [a, b, c, d, T.a.X * H - (a * ax0 + c * ay0), T.a.Y * H - (b * ax0 + d * ay0)];
}
