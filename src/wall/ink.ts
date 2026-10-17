import type { Stroke } from './strokes';

/** Ink palette from the approved "Sparkler" mockup. */
const GLOW_DEEP = 'rgba(255, 90, 0, 0.42)';
const GLOW_DEEP_SHADOW = 'rgba(255, 80, 0, 1)';
const GLOW_MID = 'rgba(255, 150, 30, 0.92)';
const GLOW_MID_SHADOW = '#ffa030';
const CORE = '#ffeec4';
const CORE_SHADOW = '#fff3d6';
const HOT = '#fffaf0';

/** Traces a smooth curve through the points (quadratic segments through midpoints). */
function tracePath(ctx: CanvasRenderingContext2D, pts: Stroke, W: number, H: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x * W, pts[0].y * H);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x * W, pts[1].y * H);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = ((pts[i].x + pts[i + 1].x) / 2) * W;
    const my = ((pts[i].y + pts[i + 1].y) / 2) * H;
    ctx.quadraticCurveTo(pts[i].x * W, pts[i].y * H, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x * W, last.y * H);
}

function pass(ctx: CanvasRenderingContext2D, width: number, color: string, blur: number, shadow: string) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.shadowBlur = blur;
  ctx.shadowColor = shadow;
  ctx.stroke();
}

/**
 * Draws one stroke as glowing sparkler light: a wide deep-orange haze, an
 * orange glow, and a pale gold core. Draw onto a scratch layer with normal
 * blending, then composite that layer additively ('lighter') so separate
 * strokes brighten where they cross. Shadows drawn directly in 'lighter'
 * mode are ~4x slower in Chrome, which would cost the 60 fps budget.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, pts: Stroke, W: number, H: number, thickness: number) {
  if (pts.length === 0) return;
  const u = (H / 1080) * thickness;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    // a tap: a single glowing dot
    const p = pts[0];
    ctx.beginPath();
    ctx.moveTo(p.x * W, p.y * H);
    ctx.lineTo(p.x * W + 0.01, p.y * H);
  } else {
    tracePath(ctx, pts, W, H);
  }
  pass(ctx, 18 * u, GLOW_DEEP, 46 * u, GLOW_DEEP_SHADOW);
  pass(ctx, 9 * u, GLOW_MID, 20 * u, GLOW_MID_SHADOW);
  pass(ctx, 4 * u, CORE, 8 * u, CORE_SHADOW);
  pass(ctx, 1.6 * u, HOT, 0, HOT);
  ctx.restore();
}

/** Extra white-hot core on the freshest part of the live stroke, so the ink "cools" behind the pen. */
export function drawHotTail(
  ctx: CanvasRenderingContext2D,
  pts: Stroke,
  W: number,
  H: number,
  thickness: number,
  now: number,
  hotMs = 350,
) {
  let start = pts.length - 1;
  while (start > 0 && now - pts[start - 1].t < hotMs) start--;
  const tail = pts.slice(Math.max(start - 1, 0));
  if (tail.length < 2) return;
  const u = (H / 1080) * thickness;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  tracePath(ctx, tail, W, H);
  pass(ctx, 2.2 * u, HOT, 10 * u, '#ffd27a');
  ctx.restore();
}
