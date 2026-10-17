export interface StrokePoint {
  x: number; // wall coords 0..1
  y: number;
  t: number; // ms
}

export type Stroke = StrokePoint[];

/** Minimum spacing between stored points, in wall units (~2px on a 1080p wall). */
export const MIN_STEP = 0.0015;

/** Appends p unless it's too close to the previous point. Returns true if added. */
export function addPoint(stroke: Stroke, p: StrokePoint): boolean {
  const last = stroke[stroke.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP) return false;
  stroke.push(p);
  return true;
}

/**
 * Drops the tail recorded in the last `ms` before pen-up (at time `upAt`):
 * when the fingers open, the pinch point drags a little before the release
 * is confirmed. Always keeps at least the first point so a tap still leaves a dot.
 */
export function trimTail(stroke: Stroke, ms: number, upAt?: number): Stroke {
  if (stroke.length < 2) return stroke;
  const end = upAt ?? stroke[stroke.length - 1].t;
  let keep = stroke.length;
  while (keep > 1 && end - stroke[keep - 1].t < ms) keep--;
  return stroke.slice(0, Math.max(keep, 1));
}

/**
 * Takes the tracking wobble out of a stroke's shape: each point becomes a
 * Gaussian-weighted average of its neighbours along the stroke. The window
 * shrinks symmetrically towards the ends, so the first and last points stay
 * exactly put: the live pen tip never lags behind the hand, and letters
 * don't shorten.
 */
export function smoothStroke(stroke: Stroke, radius = 4, sigma = 2): Stroke {
  const n = stroke.length;
  if (n < 3) return stroke;
  const weights = Array.from({ length: radius + 1 }, (_, k) => Math.exp(-(k * k) / (2 * sigma * sigma)));
  return stroke.map((p, i) => {
    const r = Math.min(radius, i, n - 1 - i);
    if (r === 0) return p;
    let x = 0, y = 0, w = 0;
    for (let k = -r; k <= r; k++) {
      const wk = weights[Math.abs(k)];
      x += stroke[i + k].x * wk;
      y += stroke[i + k].y * wk;
      w += wk;
    }
    return { x: x / w, y: y / w, t: p.t };
  });
}
