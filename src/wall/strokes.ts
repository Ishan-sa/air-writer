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
