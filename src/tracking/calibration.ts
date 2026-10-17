import type { WallPoint } from '../shared/types';
import { computeAffine, isUsableQuad, type Homography } from './homography';
import { CALIB_CORNERS } from './mapping';

export type CalibEvent =
  | { kind: 'captured'; step: number }
  | { kind: 'done'; H: Homography }
  | { kind: 'failed'; reason: string };

/**
 * Four-corner calibration: Ishan points at each wall target and pinches.
 * While the pinch is held for `holdMs` the pen position is averaged (steadier
 * than a single frame), then he releases and moves to the next corner.
 */
export class Calibration {
  step: number | null = null;
  private captured: WallPoint[] = [];
  private samples: WallPoint[] = [];
  private pinchStart: number | null = null;
  private waitRelease = false;
  private recent: { p: WallPoint; t: number }[] = [];

  constructor(public holdMs = 350) {}

  get active() {
    return this.step !== null;
  }

  start() {
    this.step = 0;
    this.captured = [];
    this.recent = [];
    this.reset();
    // if the pen is already down when calibration starts, make him release first
    this.waitRelease = true;
  }

  cancel() {
    this.step = null;
    this.reset();
  }

  private reset() {
    this.samples = [];
    this.pinchStart = null;
  }

  /** Feed every tracked frame while active. `p` is the raw pen point in camera coords. */
  update(p: WallPoint | null, down: boolean, now: number): CalibEvent | null {
    if (this.step === null) return null;
    if (p) {
      this.recent.push({ p, t: now });
      if (this.recent.length > 6) this.recent.shift();
    } else {
      this.recent = [];
    }
    if (!down || !p) {
      this.waitRelease = false;
      this.reset();
      return null;
    }
    if (this.waitRelease) return null;
    if (this.pinchStart === null) this.pinchStart = now;
    this.samples.push(p);
    if (now - this.pinchStart < this.holdMs) return null;
    const avg = average(this.samples);
    this.waitRelease = true;
    this.recent = [];
    this.reset();
    return this.capture(avg);
  }

  /** Keyboard backup: capture the current position without pinching (needs a hand in view right now). */
  captureNow(now: number): CalibEvent | null {
    if (this.step === null || this.recent.length === 0) return null;
    if (now - this.recent[this.recent.length - 1].t > 150) return null;
    const pts = this.recent.map((r) => r.p);
    this.recent = [];
    return this.capture(average(pts));
  }

  private capture(p: WallPoint): CalibEvent {
    this.captured.push(p);
    const step = this.step!;
    if (this.captured.length < 4) {
      this.step = step + 1;
      return { kind: 'captured', step };
    }
    this.step = null;
    if (minEdge(this.captured) < MIN_EDGE) {
      return {
        kind: 'failed',
        reason: 'Your hand barely moved between two corners. Move your hand to each corner of the area you want to write in, then calibrate again.',
      };
    }
    const H = computeAffine(this.captured, CALIB_CORNERS);
    if (!H || !isUsableQuad(this.captured)) {
      return { kind: 'failed', reason: 'The four corners came out of order. Calibrate again, going top left, top right, bottom right, bottom left.' };
    }
    return { kind: 'done', H };
  }
}

/**
 * Shortest side of the captured quad, as a fraction of the camera frame. Below
 * this the hand moved less than ~75 px between two corners, and normal tracking
 * wobble would be blown up many times over on the wall.
 */
const MIN_EDGE = 0.06;
function minEdge(pts: WallPoint[]) {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    m = Math.min(m, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return m;
}

const average = (pts: WallPoint[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});
