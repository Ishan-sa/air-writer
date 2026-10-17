import type { WallPoint } from '../shared/types';
import type { Homography } from './homography';

/** Where the calibration targets sit on the wall (inset so they're never off-screen). */
export const CALIB_CORNERS: WallPoint[] = [
  { x: 0.1, y: 0.1 }, // top-left
  { x: 0.9, y: 0.1 }, // top-right
  { x: 0.9, y: 0.9 }, // bottom-right
  { x: 0.1, y: 0.9 }, // bottom-left
];

/**
 * Fallback when there's no calibration: the middle of the camera image maps to
 * the whole wall, so whatever is traced shows up big in front of Ishan.
 * The tracking camera faces him, so by default its image is mirrored relative
 * to the wall (his right is the image's left).
 */
export function defaultMap(p: WallPoint, mirror: boolean): WallPoint {
  const u = mirror ? 1 - p.x : p.x;
  return { x: (u - 0.2) / 0.6, y: (p.y - 0.15) / 0.55 };
}

/** How far past the wall edges a mapped point may go before it's clamped. */
const MARGIN = 0.2;

/**
 * Camera coords → wall coords. Returns null where the calibration's
 * perspective mapping breaks down (hand far outside the calibrated area),
 * and clamps everything else near the wall so ink can't fly off-screen.
 */
export function cameraToWall(p: WallPoint, H: Homography | null, mirror: boolean): WallPoint | null {
  let q: WallPoint;
  if (H) {
    const w = H[6] * p.x + H[7] * p.y + H[8];
    if (w <= 1e-6) return null;
    q = { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
  } else {
    q = defaultMap(p, mirror);
  }
  const clamp = (v: number) => Math.min(Math.max(v, -MARGIN), 1 + MARGIN);
  return { x: clamp(q.x), y: clamp(q.y) };
}
