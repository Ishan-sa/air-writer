import { PalmHold } from './gestures';

/** What the tracker saw this frame, already boiled down to gestures. */
export interface HandFrame {
  present: boolean; // a whole hand is in view
  palm: boolean; // strict open palm: fingers straight and spread
  open: boolean; // fingers straight (looser: a moving, blurred hand still counts)
  pinch: boolean; // thumb and index together (debounced)
  wristX: number; // wrist position across the camera image, 0..1
  twoHands?: boolean; // both hands up: that's a grab, so never wipe
}

export interface SessionOutput {
  event?: 'start' | 'stop' | 'wipe';
  penDown: boolean;
  visible: boolean; // show the pen dot on the wall
  startProgress: number; // 0..1 while the start palm is being held
  wipeProgress: number; // 0..1 while a wipe palm is being held
}

/**
 * When to write and when to stop.
 *
 *   off ──(open palm held ½ s)──▶ live ──(hand out of view 1 s)──▶ off
 *
 * Off: a hand in view does nothing (no dot, no ink).
 * Live: pinch writes, open fingers lift. Wipe by holding an open palm up for a
 * second (once the starting palm has been lowered or closed), or by swiping an
 * open hand sideways.
 */
export class WriteSession {
  armed = false;
  swipeEnabled = true;
  private startHold: PalmHold;
  private wipeHold: PalmHold;
  private startPalmDone = false; // the palm that started this session has been lowered/closed
  private lostSince: number | null = null;
  private needsRelease = false;
  private startedAt = -Infinity;
  private lastWipe = -Infinity;
  private trail: { x: number; t: number }[] = [];

  constructor(
    public startMs = 500,
    public stopMs = 1000,
    /** A wipe is an open hand travelling this far across the frame… */
    // recorded swipes moved the wrist ~0.1 of the frame; writing moves it ~0.03 per second
    public swipeDistance = 0.08,
    /** …within this long. */
    public swipeWindowMs = 400,
  ) {
    this.startHold = new PalmHold(startMs, 150);
    this.wipeHold = new PalmHold(1000, 150);
  }

  /** Don't write until the pinch has been released once (e.g. right after calibrating). */
  requireRelease() {
    this.needsRelease = true;
  }

  stop() {
    this.armed = false;
    this.trail = [];
  }

  update(f: HandFrame, now: number): SessionOutput {
    if (!f.present) return this.absent(now);
    this.lostSince = null;
    if (!f.pinch) this.needsRelease = false;

    if (!this.armed) {
      const hold = this.startHold.update(f.palm && !f.pinch, now);
      if (hold.fire) {
        this.armed = true;
        this.startedAt = now;
        this.startPalmDone = false;
        this.trail = [];
        return { event: 'start', penDown: false, visible: true, startProgress: 1, wipeProgress: 0 };
      }
      return { penDown: false, visible: false, startProgress: hold.progress, wipeProgress: 0 };
    }

    const penDown = f.pinch && !this.needsRelease;
    if (!f.palm) this.startPalmDone = true;
    if (f.twoHands) this.trail = [];
    const hold = this.wipeHold.update(!f.twoHands && this.startPalmDone && f.palm && !f.pinch, now);
    const wipe = hold.fire || (!f.twoHands && this.swipeEnabled && !penDown && this.swiped(f, now));
    return { event: wipe ? 'wipe' : undefined, penDown, visible: true, startProgress: 0, wipeProgress: hold.progress };
  }

  private absent(now: number): SessionOutput {
    this.startHold.update(false, now);
    this.wipeHold.update(false, now);
    if (this.armed) {
      this.startPalmDone = true; // lowering the hand counts as putting the starting palm away
      this.lostSince ??= now;
      if (now - this.lostSince >= this.stopMs) {
        this.stop();
        return { event: 'stop', penDown: false, visible: false, startProgress: 0, wipeProgress: 0 };
      }
    }
    return { penDown: false, visible: false, startProgress: 0, wipeProgress: 0 };
  }

  /** An open hand that travelled far enough sideways, quickly enough. */
  private swiped(f: HandFrame, now: number): boolean {
    if (!f.open || f.pinch) {
      this.trail = [];
      return false;
    }
    this.trail.push({ x: f.wristX, t: now });
    while (this.trail.length && now - this.trail[0].t > this.swipeWindowMs) this.trail.shift();
    // ignore the hand settling right after starting, and repeated triggers from one swipe
    if (now - this.startedAt < 600 || now - this.lastWipe < 1000) return false;
    const travelled = Math.abs(this.trail[this.trail.length - 1].x - this.trail[0].x);
    if (travelled < this.swipeDistance) return false;
    this.lastWipe = now;
    this.trail = [];
    return true;
  }
}
