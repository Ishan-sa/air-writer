interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  maxLife: number;
  width: number;
  canSplit: boolean;
}

/** Sparks shed by the pen tip: short glowing streaks that arc down and burn out. */
export class Sparks {
  private list: Spark[] = [];
  private carry = 0;

  /**
   * Emits sparks along the segment the pen moved this frame (so a fast stroke
   * doesn't drop them in clumps). Positions are in device pixels.
   */
  emit(x0: number, y0: number, x1: number, y1: number, dt: number, amount: number, u: number) {
    if (amount <= 0) return;
    const speed = Math.hypot(x1 - x0, y1 - y0) / Math.max(dt, 1e-3) / u; // px/s at 1080p
    const rate = (110 + Math.min(speed, 2500) * 0.15) * amount; // sparks per second
    this.carry += rate * dt;
    while (this.carry >= 1) {
      this.carry -= 1;
      const k = Math.random();
      this.spawn(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, u, true);
    }
  }

  private spawn(x: number, y: number, u: number, canSplit: boolean, scale = 1) {
    const a = Math.random() * Math.PI * 2;
    const v = (60 + Math.random() * 320) * u * scale;
    const life = (0.25 + Math.random() * 0.6) * scale;
    this.list.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 60 * u,
      life,
      maxLife: life,
      width: (1 + Math.random() * 1.6) * u * scale,
      canSplit: canSplit && Math.random() < 0.12,
    });
  }

  /** A ring of sparks bursting out from one point (the pen igniting). */
  burst(x: number, y: number, count: number, u: number) {
    for (let i = 0; i < count; i++) this.spawn(x, y, u, true, 1.6);
  }

  update(dt: number, u: number) {
    const drag = Math.exp(-2.2 * dt);
    const gravity = 700 * u;
    const born: Spark[] = [];
    for (const s of this.list) {
      s.vx *= drag;
      s.vy = s.vy * drag + gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const before = s.life;
      s.life -= dt;
      // a few sparks pop into tiny secondary sparks mid-flight, like a real sparkler
      if (s.canSplit && before > s.maxLife / 2 && s.life <= s.maxLife / 2) {
        for (let i = 0; i < 3; i++) {
          const n = this.list.length + born.length;
          if (n > 1200) break;
          const a = Math.random() * Math.PI * 2;
          const v = (40 + Math.random() * 120) * u;
          born.push({
            x: s.x,
            y: s.y,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            life: 0.15 + Math.random() * 0.2,
            maxLife: 0.35,
            width: s.width * 0.6,
            canSplit: false,
          });
        }
      }
    }
    this.list = this.list.filter((s) => s.life > 0);
    this.list.push(...born);
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (this.list.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const s of this.list) {
      const k = Math.max(s.life / s.maxLife, 0); // 1 = fresh, 0 = burnt out
      // white-hot → gold → deep orange as it cools
      const g = Math.round(150 + 105 * k);
      const b = Math.round(40 + 200 * k * k);
      ctx.strokeStyle = `rgba(255, ${g}, ${b}, ${0.25 + 0.75 * k})`;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 0.022, s.y - s.vy * 0.022); // motion streak
      ctx.stroke();
    }
    ctx.restore();
  }

  get count() {
    return this.list.length;
  }
}
