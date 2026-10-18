import type { WallPoint } from '../shared/types';

export interface GrabFrame {
  hands: number; // whole hands in view
  aOpen: boolean; // first hand (leftmost on the wall) has straight fingers
  bOpen: boolean;
  a: WallPoint; // palm centres in wall coords
  b: WallPoint;
  penDown: boolean;
}

export interface GrabOutput {
  event?: 'start' | 'move' | 'end';
  a?: WallPoint;
  b?: WallPoint;
}

/**
 * Both hands up and open grabs the writing; it then follows the hands
 * (move, twist, spread) until either hand closes or leaves.
 */
export class TwoHandGrab {
  active = false;
  private since: number | null = null;
  private lostSince: number | null = null;

  constructor(
    /** both hands open this long before grabbing, so a passing second hand doesn't */
    public holdMs = 250,
    /** a hand can blink out this long without letting go */
    public graceMs = 150,
  ) {}

  update(f: GrabFrame, now: number): GrabOutput {
    const bothOpen = f.hands >= 2 && f.aOpen && f.bOpen && !f.penDown;
    if (!this.active) {
      if (!bothOpen) {
        this.since = null;
        return {};
      }
      this.since ??= now;
      if (now - this.since < this.holdMs) return {};
      this.active = true;
      this.lostSince = null;
      return { event: 'start', a: f.a, b: f.b };
    }
    if (bothOpen) {
      this.lostSince = null;
      return { event: 'move', a: f.a, b: f.b };
    }
    this.lostSince ??= now;
    if (now - this.lostSince < this.graceMs) return {};
    this.active = false;
    this.since = null;
    return { event: 'end' };
  }

  cancel() {
    this.active = false;
    this.since = null;
    this.lostSince = null;
  }
}
