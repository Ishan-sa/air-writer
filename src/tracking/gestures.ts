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
 * False when any part of the hand touches or leaves the camera frame. A
 * half-visible hand makes the tracker guess (recorded pinch readings jumped
 * between 0.03 and 0.68), which drew random strokes, so it's treated as no hand.
 */
export function handInFrame(img: { x: number; y: number }[], margin = 0.01): boolean {
  return img.every((p) => p.x > margin && p.x < 1 - margin && p.y > margin && p.y < 1 - margin);
}

/**
 * Thumb-tip to index-tip gap as seen flat on the camera image, relative to the
 * index finger's first segment. Unlike the 3D reading it doesn't drift when
 * the hand tilts, but fingertips that merely overlap on camera also read as
 * closed, so it's only used to keep a pinch going, never to start one.
 * `aspect` is the video's height / width.
 */
export function flatPinchGap(img: Lm[], aspect: number): number {
  const d2 = (a: Lm, b: Lm) => Math.hypot(a.x - b.x, (a.y - b.y) * aspect);
  return d2(img[THUMB_TIP], img[INDEX_TIP]) / Math.max(d2(img[INDEX_MCP], img[6]), 1e-6);
}

/** Flat gap above this means the fingertips have visibly separated (recorded pinch ~0.24-0.5, open 0.8+). */
const FLAT_OPEN = 0.7;

/**
 * Pen up/down. Hard to start, hard to stop:
 * - down needs the 3D pinch reading below `downAt` for 2 frames
 * - up needs the 3D reading above `upAt` AND the flat gap open, for 3 frames
 * A pinch moving fast often fools one measure for a moment (recorded: the 3D
 * reading drifting to ~0.6 mid-stroke), which used to break strokes.
 */
export class PinchDetector {
  down = false;
  private pending = 0;

  constructor(
    // tuned on real recordings: a held pinch reads ~0.27-0.40 and drifts up to
    // ~0.51 while drawing; an open hand reads 0.65+ (relaxed and moving ~0.41-0.65)
    public downAt = 0.38,
    public upAt = 0.57,
    public confirmFrames = 2,
    public releaseFrames = 3,
  ) {}

  setDownThreshold(downAt: number) {
    this.downAt = downAt;
    this.upAt = downAt * 1.5;
  }

  reset() {
    this.down = false;
    this.pending = 0;
  }

  /** @param flatGap optional flatPinchGap reading; without it only the 3D ratio is used */
  update(ratio: number, flatGap?: number): boolean {
    const opened = ratio > this.upAt && (flatGap === undefined || flatGap > FLAT_OPEN);
    const wants = this.down ? !opened : ratio < this.downAt;
    if (wants === this.down) {
      this.pending = 0;
    } else if (++this.pending >= (this.down ? this.releaseFrames : this.confirmFrames)) {
      this.down = wants;
      this.pending = 0;
    }
    return this.down;
  }
}

/**
 * How far each finger reaches out: fingertip-to-wrist over middle-joint-to-wrist.
 * A straight finger reads ~1.3+, a curled one under ~1.0. Measured in 3D, so
 * it holds up when the hand tilts.
 */
export function fingerReach(world: Lm[]) {
  const wrist = world[WRIST];
  const [index, middle, ring, pinky] = FINGERS.map((f) => dist(wrist, world[f.tip]) / Math.max(dist(wrist, world[f.pip]), 1e-6));
  return { index, middle, ring, pinky };
}

/** The pen tip when drawing by pointing: the index fingertip, in camera image coords. */
export function indexTip(img: Lm[]) {
  return { x: img[INDEX_TIP].x, y: img[INDEX_TIP].y };
}

/**
 * Pen up/down by pointing: index finger out, the other three curled. Like the
 * pinch, it's hard to start and hard to stop:
 * - down needs a clear point (index reach > 1.25, others < 1.0) for 2 frames
 * - up needs the index clearly curling (< 1.1) or the hand opening (another
 *   finger > 1.15), for 3 frames
 * Pointing is much easier to detect than a pinch, and the fingertip is a
 * precise pen point.
 */
export class PointDetector {
  down = false;
  private pending = 0;

  constructor(
    public confirmFrames = 2,
    public releaseFrames = 3,
  ) {}

  reset() {
    this.down = false;
    this.pending = 0;
  }

  /** 0..1 for a gauge: how clearly the hand is pointing right now. */
  static score(world: Lm[]) {
    const r = fingerReach(world);
    const others = Math.max(r.middle, r.ring, r.pinky);
    const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
    return clamp((r.index - 1.0) / 0.3) * clamp((1.2 - others) / 0.25);
  }

  update(world: Lm[]): boolean {
    const r = fingerReach(world);
    const others = Math.max(r.middle, r.ring, r.pinky);
    const pointing = r.index > 1.25 && others < 1.0;
    const released = r.index < 1.1 || others > 1.15;
    const wants = this.down ? !released : pointing;
    if (wants === this.down) {
      this.pending = 0;
    } else if (++this.pending >= (this.down ? this.releaseFrames : this.confirmFrames)) {
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

/**
 * Looser than isOpenPalm: fingers straight, spread or not. Used for the wipe
 * swipe, where a fast-moving hand blurs and fingers close up. (The pinch
 * reading isn't checked: it drifts with hand angle, and the session already
 * ignores swipes while pinching.)
 */
export function isHandOpen(world: Lm[]): boolean {
  const wrist = world[WRIST];
  for (const f of FINGERS) {
    if (dist(wrist, world[f.tip]) < dist(wrist, world[f.pip]) * 1.1) return false;
  }
  return true;
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
