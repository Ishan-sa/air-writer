import type { TrackInfo, WallPoint } from '../shared/types';

/**
 * The heads-up display around the writing: a frame with rulers, live readouts,
 * a targeting reticle on the hand, a grid that lights up near it, and a live
 * camera view with the tracked hands. Every number shown is real.
 *
 * The ink is warm (sparkler); the display is cold (cyan), so the writing always
 * reads as the brightest, warmest thing on the wall.
 */

export type HudMode = 'standby' | 'armed' | 'writing' | 'grab' | 'calib';

export interface HudFrame {
  now: number;
  dt: number;
  W: number;
  H: number;
  u: number; // device px per 1080p px
  mode: HudMode;
  track: TrackInfo | null; // null when stale
  /** Pen tip in device px, whether it's showing (0..1) and whether it's writing. */
  tip: { x: number; y: number };
  pen: WallPoint;
  penAlpha: number;
  down: boolean;
  strokes: number;
  inkPx: number; // total ink length in 1080p px
  mirror: boolean;
  showHud: boolean;
  showCam: boolean;
  video: HTMLVideoElement | null; // null until the wall's camera is playing
  camLabel: string;
}

export interface GrabBox {
  corners: { x: number; y: number }[]; // the writing's bounding box after the transform, device px
  a: { x: number; y: number };
  b: { x: number; y: number };
  scale: number;
  degrees: number;
}

const CYAN = (a: number) => `rgba(120, 228, 255, ${a})`;
const ICE = (a: number) => `rgba(214, 248, 255, ${a})`;
const WARM = (a: number) => `rgba(255, 170, 80, ${a})`;
const RED = (a: number) => `rgba(255, 84, 70, ${a})`;
const FONT = 'ui-monospace, "SF Mono", Menlo, monospace';
/** Text and panels are drawn larger than 1:1 so they still read when the wall is filmed from across the room. */
const PANEL = 1.3;

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const TIPS = [4, 8, 12, 16, 20];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (k: number) => 1 - Math.pow(1 - clamp01(k), 3);
const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0');

export class Hud {
  /** Overall brightness: dim while idle, full while a session is live. */
  private power = 0.5;
  private hudAlpha = 1;
  private camAlpha = 1;
  private downK = 0;
  private bootAt = -Infinity;
  private bootAtPos: { x: number; y: number } | null = null;
  private sessionAt: number | null = null;
  private banner: { title: string; sub: string; at: number; ms: number } | null = null;
  private speeds: number[] = new Array(120).fill(0);
  private speed = 0;
  private lastPen: WallPoint | null = null;
  private lastPalm: { x: number; y: number } | null = null;
  private cam = document.createElement('canvas');
  private camCtx = this.cam.getContext('2d')!;
  private scan: CanvasPattern | null = null;
  private scanU = 0;

  boot(now: number) {
    this.bootAt = now;
    this.bootAtPos = this.lastPalm;
    this.sessionAt = now;
    this.banner = { title: 'HAND LOCK ACQUIRED', sub: 'SYSTEM ARMED  ·  POINT TO WRITE', at: now, ms: 2200 };
  }

  shutdown(now: number) {
    this.sessionAt = null;
    this.banner = { title: 'SESSION CLOSED', sub: 'RAISE AN OPEN PALM TO START AGAIN', at: now, ms: 1600 };
  }

  update(f: HudFrame) {
    const k = Math.min(f.dt * 4, 1);
    const live = f.mode !== 'standby';
    this.power += ((live ? 1 : 0.5) - this.power) * Math.min(f.dt * 2.5, 1);
    this.hudAlpha += ((f.showHud ? 1 : 0) - this.hudAlpha) * k;
    this.camAlpha += ((f.showCam ? 1 : 0) - this.camAlpha) * k;
    this.downK += ((f.down ? 1 : 0) - this.downK) * Math.min(f.dt * 10, 1);
    if (f.track?.palm) this.lastPalm = { x: f.track.palm.x * f.W, y: f.track.palm.y * f.H };

    // pen speed in 1080p px per second, aspect-correct
    let v = 0;
    if (f.penAlpha > 0.5 && this.lastPen && f.dt > 0) {
      const aspect = f.W / f.H;
      v = (Math.hypot((f.pen.x - this.lastPen.x) * aspect, f.pen.y - this.lastPen.y) * 1080) / f.dt;
    }
    this.lastPen = f.penAlpha > 0.5 ? { ...f.pen } : null;
    this.speed += (Math.min(v, 4000) - this.speed) * Math.min(f.dt * 8, 1);
    this.speeds.push(this.speed);
    this.speeds.shift();
  }

  /** Under the ink: the grid near the hand, and the boot sweep. */
  drawBack(ctx: CanvasRenderingContext2D, f: HudFrame) {
    const A = this.hudAlpha;
    if (A < 0.01) return;
    const { W, H, u, now } = f;
    const sp = 48 * u;
    const ox = W / 2, oy = H / 2;
    ctx.save();
    const dot = (x: number, y: number, a: number) => {
      ctx.fillStyle = CYAN(a);
      ctx.fillRect(x - 1.2 * u, y - 1.2 * u, 2.4 * u, 2.4 * u);
    };

    // boot: a scan line sweeps down and lights the whole grid as it passes
    const bk = (now - this.bootAt) / 750;
    if (bk >= 0 && bk < 1.4) {
      const y = easeOut(bk) * (H + 200 * u) - 100 * u;
      const band = 220 * u;
      const fade = bk > 1 ? 1 - (bk - 1) / 0.4 : 1;
      for (let gy = oy - Math.ceil(oy / sp) * sp; gy < H; gy += sp) {
        const d = y - gy;
        if (d < 0 || d > band) continue;
        const a = (1 - d / band) * 0.7 * fade * A;
        for (let gx = ox - Math.ceil(ox / sp) * sp; gx < W; gx += sp) dot(gx, gy, a);
      }
      if (bk < 1) {
        const g = ctx.createLinearGradient(0, y - 90 * u, 0, y);
        g.addColorStop(0, CYAN(0));
        g.addColorStop(1, CYAN(0.22 * A));
        ctx.fillStyle = g;
        ctx.fillRect(0, y - 90 * u, W, 90 * u);
        ctx.fillStyle = ICE(0.9 * A);
        ctx.fillRect(0, y - 1.5 * u, W, 3 * u);
      }
    }

    // the grid wakes up around the hand
    const pa = f.penAlpha * A * (f.mode === 'calib' ? 0 : 1);
    if (pa > 0.01) {
      const R = 330 * u;
      const cx = f.tip.x, cy = f.tip.y;
      const x0 = ox + Math.floor((cx - R - ox) / sp) * sp;
      const y0 = oy + Math.floor((cy - R - oy) / sp) * sp;
      for (let gy = y0; gy <= cy + R; gy += sp) {
        for (let gx = x0; gx <= cx + R; gx += sp) {
          const d = Math.hypot(gx - cx, gy - cy);
          if (d > R) continue;
          const k = 1 - d / R;
          dot(gx, gy, k * k * 0.6 * pa);
        }
      }
    }
    ctx.restore();
  }

  /** Over the ink: frame, readouts, camera, reticle, banners. */
  drawFront(ctx: CanvasRenderingContext2D, f: HudFrame, grab: GrabBox | null) {
    const big = { ...f, u: f.u * PANEL };
    ctx.save();
    if (this.hudAlpha > 0.01) {
      ctx.globalAlpha = this.hudAlpha;
      this.drawFrame(ctx, f);
      this.drawTitle(ctx, big);
      this.drawTelemetry(ctx, big);
      this.drawLegend(ctx, big);
      this.drawPalm(ctx, big);
      if (f.mode !== 'calib') this.drawReticle(ctx, f);
      this.drawBanner(ctx, big);
      this.drawHint(ctx, big);
    }
    ctx.globalAlpha = 1;
    if (grab) this.drawGrab(ctx, big, grab);
    if (this.camAlpha > 0.01) {
      ctx.globalAlpha = this.camAlpha;
      this.drawCamera(ctx, big);
    }
    ctx.restore();
  }

  /** The bright bar that sweeps the ink away on a wipe. */
  drawWipeBar(ctx: CanvasRenderingContext2D, x: number, H: number, u: number) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const trail = 260 * u;
    const g = ctx.createLinearGradient(x - trail, 0, x, 0);
    g.addColorStop(0, CYAN(0));
    g.addColorStop(1, CYAN(0.28));
    ctx.fillStyle = g;
    ctx.fillRect(x - trail, 0, trail, H);
    ctx.shadowColor = CYAN(1);
    ctx.shadowBlur = 30 * u;
    ctx.fillStyle = ICE(0.95);
    ctx.fillRect(x - 2 * u, 0, 4 * u, H);
    ctx.restore();
  }

  // ------------------------------------------------------------ pieces

  private drawFrame(ctx: CanvasRenderingContext2D, f: HudFrame) {
    const { W, H, u, now } = f;
    const m = 28 * u;
    const arm = 76 * u * (0.25 + 0.75 * easeOut((now - this.bootAt) / 600));
    const p = this.power;
    ctx.strokeStyle = CYAN(0.8 * p);
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [W - m, H - m, -1, -1], [m, H - m, 1, -1]]) {
      ctx.moveTo(cx + sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * arm);
    }
    ctx.stroke();

    // rulers along the top and left edge, with the pen's position marked on them
    const r0 = m + 110 * u;
    ctx.fillStyle = CYAN(0.28 * p);
    for (let x = r0, i = 0; x < W - m - 110 * u; x += 24 * u, i++) {
      const long = i % 10 === 0;
      ctx.fillRect(x, m - 1 * u, 1.2 * u, (long ? 12 : 5) * u);
    }
    for (let y = r0, i = 0; y < H - m - 110 * u; y += 24 * u, i++) {
      const long = i % 10 === 0;
      ctx.fillRect(m - 1 * u, y, (long ? 12 : 5) * u, 1.2 * u);
    }
    const pa = f.penAlpha * (f.mode === 'calib' ? 0 : 1);
    if (pa > 0.01) {
      const { x, y } = f.tip;
      const col = f.down ? WARM : CYAN;
      ctx.fillStyle = col(0.9 * pa);
      ctx.beginPath();
      ctx.moveTo(x, m + 16 * u);
      ctx.lineTo(x - 6 * u, m + 6 * u);
      ctx.lineTo(x + 6 * u, m + 6 * u);
      ctx.moveTo(m + 16 * u, y);
      ctx.lineTo(m + 6 * u, y - 6 * u);
      ctx.lineTo(m + 6 * u, y + 6 * u);
      ctx.fill();
      text(ctx, f.pen.x.toFixed(3), x + 10 * u, m + 14 * u, 11 * u, col(0.75 * pa));
      text(ctx, f.pen.y.toFixed(3), m + 20 * u, y - 10 * u, 11 * u, col(0.75 * pa));
      // hairlines from the rulers to the reticle
      ctx.strokeStyle = CYAN(0.16 * pa);
      ctx.lineWidth = 1 * u;
      ctx.setLineDash([4 * u, 6 * u]);
      ctx.beginPath();
      ctx.moveTo(x, m + 22 * u);
      ctx.lineTo(x, y - 60 * u);
      ctx.moveTo(m + 22 * u, y);
      ctx.lineTo(x - 60 * u, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawTitle(ctx: CanvasRenderingContext2D, f: HudFrame) {
    const { u, now } = f;
    const x = 64 * u, y = 78 * u;
    const p = this.power;
    text(ctx, 'AIR WRITER', x, y, 24 * u, ICE(0.95 * p), 'left', 700, 5 * u);
    text(ctx, '// HAND-TRACKED LIGHT', x + 214 * u, y - 1 * u, 11 * u, CYAN(0.5 * p), 'left', 500, 1.5 * u);

    const [label, col] = MODE_LABEL[f.mode];
    const blink = f.mode === 'writing' ? 0.55 + 0.45 * Math.sin(now / 90) : f.mode === 'standby' ? 0.4 + 0.3 * Math.sin(now / 700) : 1;
    ctx.fillStyle = col(blink);
    ctx.beginPath();
    ctx.arc(x + 5 * u, y + 30 * u, 4.5 * u, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, label, x + 20 * u, y + 35 * u, 15 * u, col(0.95), 'left', 600, 3 * u);

    const session = this.sessionAt === null ? 'IDLE' : `SESSION ${clock(now - this.sessionAt)}`;
    text(ctx, session, x + 20 * u, y + 58 * u, 12 * u, CYAN(0.6 * p), 'left', 500, 1.5 * u);

    // underline with a notch
    ctx.fillStyle = CYAN(0.35 * p);
    ctx.fillRect(x, y + 74 * u, 300 * u, 1 * u);
    ctx.fillRect(x, y + 72 * u, 40 * u, 3 * u);
  }

  private drawTelemetry(ctx: CanvasRenderingContext2D, f: HudFrame) {
    const { u, H } = f;
    const p = this.power;
    const x = 64 * u, vx = x + 92 * u;
    const t = f.track;
    const writer = t?.hands.find((h) => h.writer);
    const rows: [string, string][] = [
      ['TRACK', t ? `${t.fps.toFixed(0).padStart(2, ' ')} FPS  ·  ${t.ms.toFixed(0)} MS` : 'NO SIGNAL'],
      ['HANDS', t ? `${t.hands.length}${writer ? `   CONF ${Math.round(writer.score * 100)}%` : ''}` : '0'],
      ['PEN', f.penAlpha > 0.5 ? `X ${f.pen.x.toFixed(3)}   Y ${f.pen.y.toFixed(3)}` : '—'],
      ['STROKES', `${pad2(f.strokes)}   INK ${Math.round(f.inkPx).toLocaleString('en-US')} PX`],
    ];
    let y = H - 150 * u;
    for (const [k, v] of rows) {
      text(ctx, k, x, y, 12 * u, CYAN(0.55 * p), 'left', 500, 2 * u);
      text(ctx, v, vx, y, 13 * u, ICE(0.9 * p), 'left', 500, 1 * u);
      y += 22 * u;
    }

    // pen speed, last two seconds
    text(ctx, 'SPEED', x, y + 4 * u, 12 * u, CYAN(0.55 * p), 'left', 500, 2 * u);
    const gx = vx, gy = y - 12 * u, gw = 190 * u, gh = 26 * u;
    ctx.strokeStyle = CYAN(0.2 * p);
    ctx.lineWidth = 1 * u;
    ctx.strokeRect(gx, gy, gw, gh);
    const n = this.speeds.length;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = gx + (i / (n - 1)) * gw;
      const py = gy + gh - clamp01(this.speeds[i] / 2500) * (gh - 3 * u) - 1.5 * u;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.strokeStyle = (f.down ? WARM : CYAN)(0.9 * p);
    ctx.lineWidth = 1.5 * u;
    ctx.stroke();
    text(ctx, `${Math.round(this.speed)} PX/S`, gx + gw + 12 * u, y + 4 * u, 12 * u, ICE(0.8 * p));
  }

  private drawLegend(ctx: CanvasRenderingContext2D, f: HudFrame) {
    const { u, W, H, now } = f;
    const x = W - 64 * u;
    const t = f.track;
    const rows: [string, string, boolean][] =
      f.mode === 'standby'
        ? [['✋', 'HOLD AN OPEN PALM  ·  START', true]]
        : [
            ['☝️', 'POINT  ·  WRITE', f.mode === 'writing'],
            ['✌️', 'TWO FINGERS  ·  LIFT', f.mode === 'armed' && f.penAlpha > 0.5 && !f.down],
            ['✋', 'HOLD PALM  ·  WIPE', (t?.wipe ?? 0) > 0],
            ['🙌', 'BOTH HANDS  ·  GRAB', f.mode === 'grab'],
            ['👇', 'LOWER HAND  ·  STOP', false],
          ];
    let y = H - 64 * u - (rows.length - 1) * 26 * u;
    for (const [icon, label, on] of rows) {
      const a = on ? (f.mode === 'standby' ? 0.55 + 0.35 * Math.sin(now / 400) : 1) : 0.4;
      ctx.globalAlpha = this.hudAlpha * a * this.power;
      text(ctx, label, x - 30 * u, y, 12 * u, on ? ICE(1) : CYAN(1), 'right', on ? 700 : 500, 2 * u);
      text(ctx, icon, x, y + 1 * u, 16 * u, '#fff', 'right');
      if (on && f.mode !== 'standby') {
        ctx.fillStyle = CYAN(1);
        ctx.fillRect(x + 10 * u, y - 12 * u, 2 * u, 16 * u);
      }
      y += 26 * u;
    }
    ctx.globalAlpha = this.hudAlpha;
  }

  /** Lock-on brackets closing in on the palm while it's held up to start (or to wipe). */
  private drawPalm(ctx: CanvasRenderingContext2D, f: HudFrame) {
    const { u, now } = f;
    const t = f.track;
    const starting = t && !t.armed && t.start > 0 ? t.start : 0;
    const wiping = t && t.armed && t.wipe > 0 ? t.wipe : 0;
    const k = starting || wiping;
    if (k > 0 && this.lastPalm) {
      const { x, y } = this.lastPalm;
      const col = wiping ? RED : k > 0.98 ? ICE : CYAN;
      const d = (150 - 96 * easeOut(k)) * u;
      const rot = (1 - k) * Math.PI * 0.5;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = col(0.9);
      ctx.lineWidth = 2.5 * u;
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate(rot + (i * Math.PI) / 2);
        ctx.beginPath();
        ctx.moveTo(-d, -d + 22 * u);
        ctx.lineTo(-d, -d);
        ctx.lineTo(-d + 22 * u, -d);
        ctx.stroke();
        ctx.restore();
      }
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = col(0.25);
      ctx.beginPath();
      ctx.arc(0, 0, 70 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = col(0.95);
      ctx.beginPath();
      ctx.arc(0, 0, 70 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      ctx.stroke();
      ctx.restore();
      const label = wiping ? `WIPING  ${Math.round(k * 100)}%` : `LOCKING  ${Math.round(k * 100)}%`;
      text(ctx, label, x, y + 104 * u, 13 * u, col(0.95), 'center', 600, 3 * u);
    }

    // shockwave where the palm locked on
    const bk = (now - this.bootAt) / 700;
    if (bk >= 0 && bk < 1 && this.bootAtPos) {
      const { x, y } = this.bootAtPos;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [delay, w] of [[0, 4], [0.15, 2]]) {
        const kk = clamp01((bk - delay) / (1 - delay));
        if (kk <= 0) continue;
        ctx.strokeStyle = ICE((1 - kk) * 0.9);
        ctx.lineWidth = w * u;
        ctx.beginPath();
        ctx.arc(x, y, (60 + 520 * easeOut(kk)) * u, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawReticle(ctx: CanvasRenderingContext2D, f: HudFrame) {
    const a = f.penAlpha;
    if (a < 0.01) return;
    const { u, now } = f;
    const { x, y } = f.tip;
    const k = this.downK;
    const r = (36 - 14 * k) * u;
    const spin = now / (900 - 600 * k);
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 1.6 * u;
    ctx.strokeStyle = k > 0.5 ? WARM(0.55 * a) : CYAN(0.85 * a);
    for (let i = 0; i < 3; i++) {
      const s = spin + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(0, 0, r, s, s + Math.PI * 0.42);
      ctx.stroke();
    }
    // fixed ticks, which fold away while writing
    const tick = (1 - k) * a;
    if (tick > 0.02) {
      ctx.strokeStyle = CYAN(0.7 * tick);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const ang = (i * Math.PI) / 2;
        ctx.moveTo(Math.cos(ang) * (r + 8 * u), Math.sin(ang) * (r + 8 * u));
        ctx.lineTo(Math.cos(ang) * (r + 18 * u), Math.sin(ang) * (r + 18 * u));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBanner(ctx: CanvasRenderingContext2D, f: HudFrame) {
    const b = this.banner;
    if (!b) return;
    const { u, W, H, now } = f;
    const e = now - b.at;
    if (e > b.ms) {
      this.banner = null;
      return;
    }
    const fade = e > b.ms - 500 ? (b.ms - e) / 500 : 1;
    const shown = Math.ceil(b.title.length * clamp01(e / 450));
    const cx = W / 2, cy = H * 0.44;
    const line = 280 * u * easeOut(e / 500);
    ctx.save();
    ctx.globalAlpha *= fade;
    ctx.fillStyle = CYAN(0.6);
    ctx.fillRect(cx - line - 40 * u, cy - 9 * u, line, 1.5 * u);
    ctx.fillRect(cx + 40 * u, cy - 9 * u, line, 1.5 * u);
    text(ctx, b.title.slice(0, shown) + (shown < b.title.length ? '▌' : ''), cx, cy - 26 * u, 34 * u, ICE(1), 'center', 700, 8 * u);
    if (e > 350) text(ctx, b.sub, cx, cy + 22 * u, 13 * u, CYAN(0.85 * clamp01((e - 350) / 300)), 'center', 500, 4 * u);
    ctx.restore();
  }

  private drawHint(ctx: CanvasRenderingContext2D, f: HudFrame) {
    if (f.mode !== 'standby' || this.banner || (f.track?.start ?? 0) > 0) return;
    const { u, W, H, now } = f;
    const a = 0.3 + 0.25 * Math.sin(now / 600);
    text(ctx, 'RAISE AN OPEN PALM TO BEGIN', W / 2, H * 0.82, 15 * u, CYAN(a), 'center', 500, 7 * u);
  }

  private drawGrab(ctx: CanvasRenderingContext2D, f: HudFrame, g: GrabBox) {
    const { u, now } = f;
    ctx.save();
    // brackets on the corners of the held writing
    ctx.strokeStyle = CYAN(0.85);
    ctx.lineWidth = 2 * u;
    const c = g.corners.length === 4 ? g.corners : [];
    for (let i = 0; i < c.length; i++) {
      const p = c[i], prev = c[(i + 3) % 4], next = c[(i + 1) % 4];
      const toward = (q: { x: number; y: number }) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const l = Math.min(26 * u, d * 0.3);
        return { x: p.x + ((q.x - p.x) / d) * l, y: p.y + ((q.y - p.y) / d) * l };
      };
      const a1 = toward(prev), a2 = toward(next);
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(p.x, p.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.stroke();
    }
    // the line between the hands
    ctx.strokeStyle = CYAN(0.35);
    ctx.lineWidth = 1.2 * u;
    ctx.setLineDash([6 * u, 8 * u]);
    ctx.lineDashOffset = -now / 30;
    ctx.beginPath();
    ctx.moveTo(g.a.x, g.a.y);
    ctx.lineTo(g.b.x, g.b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // a spinning ring on each hand
    for (const [i, p] of [g.a, g.b].entries()) {
      const s = (now / 500) * (i ? -1 : 1);
      ctx.strokeStyle = ICE(0.9);
      ctx.lineWidth = 2.2 * u;
      for (let j = 0; j < 4; j++) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 30 * u, s + (j * Math.PI) / 2, s + (j * Math.PI) / 2 + Math.PI * 0.32);
        ctx.stroke();
      }
      ctx.fillStyle = CYAN(0.9);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    // readout above the writing
    const pts = c.length ? c : [g.a, g.b];
    const top = pts.reduce((m, p) => (p.y < m.y ? p : m), pts[0]);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const sign = g.degrees >= 0 ? '+' : '−';
    text(ctx, `SCALE ${g.scale.toFixed(2)}×   ROT ${sign}${Math.abs(g.degrees).toFixed(0)}°`, cx, Math.max(top.y - 22 * u, 40 * u), 13 * u, ICE(0.95), 'center', 600, 3 * u);
    ctx.restore();
  }

  private drawCamera(ctx: CanvasRenderingContext2D, f: HudFrame) {
    const { u, W, now } = f;
    const t = f.track;
    const vid = f.video;
    const aspect = Math.min(2.2, Math.max(1.2, vid ? vid.videoWidth / vid.videoHeight : (t?.aspect ?? 16 / 9)));
    const iw = Math.round(400 * u), ih = Math.round(iw / aspect);
    const x0 = Math.round(W - 50 * u - iw), y0 = Math.round(66 * u);
    const map = (lx: number, ly: number) => ({ x: x0 + (f.mirror ? 1 - lx : lx) * iw, y: y0 + ly * ih });

    // header and footer
    const rec = Math.sin(now / 320) > -0.3;
    ctx.fillStyle = RED(rec ? 0.95 : 0.25);
    ctx.beginPath();
    ctx.arc(x0 + 5 * u, y0 - 16 * u, 4.5 * u, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, vid ? 'LIVE  ·  CAM 01' : 'CAM 01  ·  SKELETON ONLY', x0 + 18 * u, y0 - 12 * u, 12 * u, ICE(0.9), 'left', 600, 2.5 * u);
    const d = new Date();
    text(ctx, `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`, x0 + iw, y0 - 12 * u, 12 * u, CYAN(0.7), 'right', 500, 2 * u);
    const label = (f.camLabel || 'CAMERA').replace(/\s*\(.*\)$/, '').toUpperCase().slice(0, 30);
    text(ctx, label, x0, y0 + ih + 22 * u, 11 * u, CYAN(0.55), 'left', 500, 2 * u);
    if (vid) text(ctx, `${vid.videoWidth}×${vid.videoHeight}`, x0 + iw, y0 + ih + 22 * u, 11 * u, CYAN(0.55), 'right', 500, 2 * u);

    // the feed: monochrome cyan, with scanlines
    ctx.fillStyle = '#000';
    ctx.fillRect(x0, y0, iw, ih);
    if (vid) {
      if (this.cam.width !== iw || this.cam.height !== ih) {
        this.cam.width = iw;
        this.cam.height = ih;
      }
      const c = this.camCtx;
      c.globalCompositeOperation = 'source-over';
      c.save();
      if (f.mirror) {
        c.translate(iw, 0);
        c.scale(-1, 1);
      }
      c.drawImage(vid, 0, 0, iw, ih);
      c.restore();
      c.globalCompositeOperation = 'color';
      c.fillStyle = 'rgb(90, 210, 255)';
      c.fillRect(0, 0, iw, ih);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = this.scanlines(c, u);
      c.fillRect(0, 0, iw, ih);
      ctx.save();
      ctx.globalAlpha *= 0.85;
      ctx.drawImage(this.cam, x0, y0);
      ctx.restore();
    } else {
      ctx.strokeStyle = CYAN(0.12);
      ctx.lineWidth = 1 * u;
      ctx.beginPath();
      for (let gx = x0; gx <= x0 + iw; gx += 32 * u) {
        ctx.moveTo(gx, y0);
        ctx.lineTo(gx, y0 + ih);
      }
      for (let gy = y0; gy <= y0 + ih; gy += 32 * u) {
        ctx.moveTo(x0, gy);
        ctx.lineTo(x0 + iw, gy);
      }
      ctx.stroke();
      if (!t?.hands.length) text(ctx, 'NO SIGNAL', x0 + iw / 2, y0 + ih / 2 + 5 * u, 14 * u, CYAN(0.5), 'center', 600, 6 * u);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, iw, ih);
    ctx.clip();
    // a slow scan band rolling down the feed
    const band = ((now / 2600) % 1) * (ih + 60 * u) - 30 * u;
    const g = ctx.createLinearGradient(0, y0 + band - 30 * u, 0, y0 + band + 30 * u);
    g.addColorStop(0, CYAN(0));
    g.addColorStop(0.5, CYAN(0.1));
    g.addColorStop(1, CYAN(0));
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0 + band - 30 * u, iw, 60 * u);

    // tracked hands
    for (const h of t?.hands ?? []) {
      const pts = Array.from({ length: 21 }, (_, i) => map(h.lm[i * 2], h.lm[i * 2 + 1]));
      const strong = h.writer ? 1 : 0.55;
      ctx.lineCap = 'round';
      for (const [w, a] of [[5, 0.16], [1.6, 0.95]]) {
        ctx.strokeStyle = CYAN(a * strong);
        ctx.lineWidth = w * u;
        ctx.beginPath();
        for (const [i, j] of BONES) {
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = ICE(0.95 * strong);
      pts.forEach((p, i) => {
        const s = (TIPS.includes(i) ? 3.4 : 2.4) * u;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      });

      // brackets around the hand
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const pad = 10 * u;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const arm = 12 * u;
      ctx.strokeStyle = (h.down ? WARM : CYAN)(0.9 * strong);
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      for (const [cx, cy, sx, sy] of [[minX, minY, 1, 1], [maxX, minY, -1, 1], [maxX, maxY, -1, -1], [minX, maxY, 1, -1]]) {
        ctx.moveTo(cx + sx * arm, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + sy * arm);
      }
      ctx.stroke();
      const tag = `${h.writer ? 'PEN HAND' : 'HAND 02'}  ${Math.round(h.score * 100)}%`;
      text(ctx, tag, minX, Math.max(minY - 6 * u, y0 + 13 * u), 10 * u, (h.down ? WARM : ICE)(0.95 * strong), 'left', 600, 1.5 * u);

      // the pen point on the index finger
      if (h.writer) {
        const tip = pts[8];
        ctx.strokeStyle = (h.down ? WARM : CYAN)(1);
        ctx.lineWidth = 1.8 * u;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, (h.down ? 8 : 7) * u, 0, Math.PI * 2);
        ctx.stroke();
        if (h.down) {
          ctx.fillStyle = WARM(0.95);
          ctx.beginPath();
          ctx.arc(tip.x, tip.y, 3.5 * u, 0, Math.PI * 2);
          ctx.fill();
          text(ctx, 'INK', tip.x + 13 * u, tip.y + 4 * u, 10 * u, WARM(1), 'left', 700, 2 * u);
        }
      }
    }
    ctx.restore();

    // frame
    ctx.strokeStyle = CYAN(0.2);
    ctx.lineWidth = 1 * u;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, iw - 1, ih - 1);
    ctx.strokeStyle = CYAN(0.9);
    ctx.lineWidth = 2 * u;
    const arm = 18 * u;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x0 + iw, y0, -1, 1], [x0 + iw, y0 + ih, -1, -1], [x0, y0 + ih, 1, -1]]) {
      ctx.moveTo(cx + sx * arm, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * arm);
    }
    ctx.stroke();
  }

  private scanlines(c: CanvasRenderingContext2D, u: number): CanvasPattern {
    if (this.scan && this.scanU === u) return this.scan;
    const tile = document.createElement('canvas');
    const step = Math.max(2, Math.round(3 * u));
    tile.width = 1;
    tile.height = step;
    const t = tile.getContext('2d')!;
    t.fillStyle = 'rgba(0, 0, 0, 0.45)';
    t.fillRect(0, 0, 1, Math.max(1, Math.round(step / 3)));
    this.scan = c.createPattern(tile, 'repeat')!;
    this.scanU = u;
    return this.scan;
  }
}

const MODE_LABEL: Record<HudMode, [string, (a: number) => string]> = {
  standby: ['STANDBY', CYAN],
  armed: ['ARMED', CYAN],
  writing: ['WRITING', WARM],
  grab: ['HOLDING', ICE],
  calib: ['CALIBRATING', WARM],
};

function clock(ms: number) {
  const s = ms / 1000;
  return `${pad2(s / 60)}:${pad2(s % 60)}.${Math.floor((s * 10) % 10)}`;
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  weight = 500,
  spacing = 0,
) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${spacing}px`;
  ctx.fillText(s, x, y);
}
