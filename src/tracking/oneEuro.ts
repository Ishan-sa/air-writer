/**
 * One Euro filter (Casiez et al. 2012): heavy smoothing when the hand moves
 * slowly (kills jitter), light smoothing when it moves fast (keeps lag low).
 */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    public minCutoff = 1.0,
    public beta = 0.01,
    public dCutoff = 1.0,
  ) {}

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
  }

  /** @param t timestamp in seconds */
  filter(x: number, t: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(t - this.tPrev, 1e-3);
    this.tPrev = t;
    const dx = (x - this.xPrev) / dt;
    const edx = lerp(this.dxPrev, dx, alpha(this.dCutoff, dt));
    this.dxPrev = edx;
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const out = lerp(this.xPrev, x, alpha(cutoff, dt));
    this.xPrev = out;
    return out;
  }
}

/** Filters a 2D point with two independent One Euro filters. */
export class PointFilter {
  private fx = new OneEuroFilter();
  private fy = new OneEuroFilter();

  /** smoothing 0..1 → filter parameters, tuned for wall coords in 0..1. */
  setSmoothing(smoothing: number) {
    const s = Math.min(Math.max(smoothing, 0), 1);
    const minCutoff = 6 * Math.pow(0.05, s); // 6 Hz (raw-ish) … 0.3 Hz (heavy)
    const beta = 4 * Math.pow(0.1, s); // how quickly fast motion cuts through
    for (const f of [this.fx, this.fy]) {
      f.minCutoff = minCutoff;
      f.beta = beta;
    }
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
  }

  filter(x: number, y: number, tSeconds: number) {
    return { x: this.fx.filter(x, tSeconds), y: this.fy.filter(y, tSeconds) };
  }
}

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
