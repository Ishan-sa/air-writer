/** Minimal landmark shape shared by MediaPipe's image and world landmarks. */
export interface Lm {
  x: number;
  y: number;
  z: number;
}

// MediaPipe hand landmark indices
export const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, MIDDLE_MCP = 9;
const FINGERS = [
  { pip: 6, tip: 8 }, // index
  { pip: 10, tip: 12 }, // middle
  { pip: 14, tip: 16 }, // ring
  { pip: 18, tip: 20 }, // pinky
];
const INDEX_TIP = 8;

const dist = (a: Lm, b: Lm) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Wrist → middle-finger knuckle: a size reference that doesn't change with pose. */
export const handSize = (w: Lm[]) => dist(w[WRIST], w[MIDDLE_MCP]);

/** Thumb-tip to index-tip distance as a fraction of hand size (camera-distance independent). */
export function pinchRatio(world: Lm[]): number {
  return dist(world[THUMB_TIP], world[INDEX_TIP]) / Math.max(handSize(world), 1e-6);
}

/** The "pen tip": halfway between thumb and index tips, in camera image coords (0..1). */
export function penPoint(img: Lm[]) {
  return {
    x: (img[THUMB_TIP].x + img[INDEX_TIP].x) / 2,
    y: (img[THUMB_TIP].y + img[INDEX_TIP].y) / 2,
  };
}

/**
 * Pen up/down from the pinch ratio, with hysteresis (separate down/up
 * thresholds) and a short debounce so the pen doesn't flicker between letters.
 */
export class PinchDetector {
  down = false;
  private pending = 0;

  constructor(
    public downAt = 0.3,
    public upAt = 0.45,
    public confirmFrames = 2,
  ) {}

  setDownThreshold(downAt: number) {
    this.downAt = downAt;
    this.upAt = downAt * 1.5;
  }

  reset() {
    this.down = false;
    this.pending = 0;
  }

  update(ratio: number): boolean {
    const wants = this.down ? ratio < this.upAt : ratio < this.downAt;
    if (wants === this.down) {
      this.pending = 0;
    } else if (++this.pending >= this.confirmFrames) {
      this.down = wants;
      this.pending = 0;
    }
    return this.down;
  }
}

/**
 * Strict open-palm check: all four fingers straight, thumb out, fingers spread.
 * Deliberately hard to trigger so a hand relaxing mid-word never wipes the wall.
 */
export function isOpenPalm(world: Lm[]): boolean {
  const size = handSize(world);
  if (size < 1e-6) return false;
  const wrist = world[WRIST];
  for (const f of FINGERS) {
    // a straight finger's tip is clearly farther from the wrist than its middle joint
    if (dist(wrist, world[f.tip]) < dist(wrist, world[f.pip]) * 1.2) return false;
  }
  if (dist(world[THUMB_TIP], world[INDEX_MCP]) < size * 0.55) return false;
  const tips = FINGERS.map((f) => world[f.tip]);
  let spread = 0;
  for (let i = 0; i < tips.length - 1; i++) spread += dist(tips[i], tips[i + 1]);
  if (spread / (tips.length - 1) < size * 0.28) return false;
  return pinchRatio(world) > 0.6;
}

/** Fires once after the palm has been held open for `holdMs` (brief dropouts tolerated). */
export class PalmHold {
  private since: number | null = null;
  private lastSeen = 0;
  private fired = false;

  constructor(
    public holdMs = 1000,
    public graceMs = 150,
  ) {}

  /** Returns hold progress 0..1, and whether the wipe should fire on this frame. */
  update(open: boolean, now: number): { progress: number; fire: boolean } {
    if (open) {
      this.lastSeen = now;
      if (this.since === null) this.since = now;
    } else if (this.since !== null && now - this.lastSeen > this.graceMs) {
      this.since = null;
      this.fired = false;
    }
    if (this.since === null) return { progress: 0, fire: false };
    const progress = Math.min((now - this.since) / this.holdMs, 1);
    if (progress >= 1 && !this.fired) {
      this.fired = true;
      return { progress, fire: true };
    }
    return { progress: this.fired ? 0 : progress, fire: false };
  }
}
