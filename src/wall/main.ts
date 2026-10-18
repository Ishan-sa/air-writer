import { openChannel } from '../shared/channel';
import { DEFAULT_SETTINGS, type Msg, type Settings, type WallPoint } from '../shared/types';
import { drawHotTail, drawStroke } from './ink';
import { applyGrab, canvasMatrix, grabTransform } from './transform';
import { Sparks } from './sparks';
import { Sfx } from './sfx';
import { addPoint, LazyBrush, smoothStroke, trimTail, type Stroke } from './strokes';

const canvas = document.getElementById('wall') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const toastEl = document.getElementById('toast')!;

// Finished strokes are baked into an offscreen layer once; only the live stroke is redrawn each frame,
// on its own layer, which is then blended additively onto the wall.
const baked = document.createElement('canvas');
const bctx = baked.getContext('2d')!;
const liveLayer = document.createElement('canvas');
const lctx = liveLayer.getContext('2d')!;

let W = 0, H = 0, u = 1;
let settings: Settings = { ...DEFAULT_SETTINGS };
let strokes: Stroke[] = [];
/** Line-width multiplier per finished stroke (grows and shrinks with two-hand resizes). */
let widths: number[] = [];
/** While both hands hold the writing: where they started and where they are now. */
let held: { a0: WallPoint; b0: WallPoint; a: WallPoint; b: WallPoint } | null = null;
let live: Stroke | null = null;
let wipeStart: number | null = null; // fade-out in progress
const WIPE_MS = 500;
const RELEASE_TRIM_MS = 70;
const LOSS_TRIM_MS = 400;
let igniting = false;
let igniteAt = -Infinity;

/** A quick accidental pinch leaves a dot or a tiny tick: not worth keeping. */
function isAccidental(s: Stroke) {
  let len = 0;
  for (let i = 1; i < s.length; i++) len += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  const ms = s.length ? s[s.length - 1].t - s[0].t : 0;
  return len < 0.01 && ms < 200;
}
// longer than the control view's 350 ms grace for tracking gaps while writing
const PEN_STALE_MS = 500;

interface Pen { x: number; y: number; down: boolean; visible: boolean; at: number }
let pen: Pen = { x: 0.5, y: 0.5, down: false, visible: false, at: 0 };
let prevTip: { x: number; y: number } | null = null; // device px, for spark emission
let dotAlpha = 0;

let calib: { step: number | null; corners: WallPoint[] } = { step: null, corners: [] };
let mouseMode = false;
const sparks = new Sparks();

// Browsers only allow audio after the viewer interacts with the page, so the
// sound engine starts on the first click or key press in the wall window.
let sfx: Sfx | null = null;
function ensureAudio() {
  if (sfx) return;
  try {
    sfx = new Sfx(new AudioContext(), settings.sfx);
    toast('Sound on');
  } catch {
    /* no audio available: stay silent */
  }
}
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, ensureAudio, { capture: true }));


// ---------------------------------------------------------------- sizing

function resize() {
  const dpr = window.devicePixelRatio || 1;
  // never 0: a minimised window would otherwise make every drawImage throw
  W = Math.max(1, Math.round(window.innerWidth * dpr));
  H = Math.max(1, Math.round(window.innerHeight * dpr));
  canvas.width = baked.width = liveLayer.width = W;
  canvas.height = baked.height = liveLayer.height = H;
  u = H / 1080;
  rebake();
}
window.addEventListener('resize', resize);
// moving the window between the Retina screen and the projector changes the pixel ratio without a resize
function watchPixelRatio() {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      resize();
      watchPixelRatio();
    },
    { once: true },
  );
}
watchPixelRatio();

function rebake() {
  bctx.clearRect(0, 0, W, H);
  strokes.forEach((s, i) => bake(s, widths[i] ?? 1));
}

/** Renders a finished stroke via the scratch layer and adds it to the baked ink. */
function bake(s: Stroke, width = 1) {
  lctx.clearRect(0, 0, W, H);
  drawStroke(lctx, smoothStroke(s), W, H, settings.thickness * width);
  bctx.save();
  bctx.globalCompositeOperation = 'lighter';
  bctx.drawImage(liveLayer, 0, 0);
  bctx.restore();
  lctx.clearRect(0, 0, W, H);
}

// ---------------------------------------------------------------- ink state

/** A jump bigger than this in one frame (e.g. tracking hopping to the other hand) starts a new stroke. */
const MAX_JUMP = 0.2;
/**
 * A pen lift shorter than this, landing back right where it lifted, continues
 * the same stroke: tracking sometimes flickers for a frame or two. Kept tight
 * because real lifts between letters are quick too (recorded: 65-175 ms), and
 * a looser stitch joined letters that were meant to be separate.
 */
const STITCH_MS = 80;
const STITCH_DIST = 0.02;
let lifted: { upAt: number } | null = null;
const brush = new LazyBrush(0.01);
/** Where the ink is being laid down right now (behind the hand by the string length). */
let inkAt: WallPoint | null = null;

/** `t` is this window's clock: stamped on arrival so it matches the render loop's clock. */
function penInput(x: number, y: number, down: boolean, visible: boolean, t: number) {
  // when the hand leaves view, keep the last position so the dot fades where it was
  if (!visible) ({ x, y } = pen);
  const jumped = Math.hypot(x - pen.x, y - pen.y) > MAX_JUMP;
  pen = { x, y, down: down && visible, visible, at: performance.now() };
  if (calib.step !== null) {
    endStroke(t);
    return;
  }
  if (pen.visible && igniting) {
    igniting = false;
    sparks.burst(x * W, y * H, 70, u);
    igniteAt = performance.now();
  }
  if (pen.down) {
    if (wipeStart !== null) finishWipe();
    if (live && jumped) {
      endStroke(t);
      prevTip = null;
    }
    if (live && lifted) {
      const last = live[live.length - 1];
      const near = Math.hypot(x - last.x, y - last.y) < STITCH_DIST;
      if (t - lifted.upAt < STITCH_MS && near) lifted = null; // a flicker: keep going
      else endStroke(lifted.upAt);
    }
    // the ink hangs behind the hand on a short string (see LazyBrush), worked out
    // in real wall proportions so the string is the same length in every direction
    const aspect = W / H;
    brush.radius = 0.02 * settings.smoothing; // a fraction of the wall height
    if (!live) {
      live = [];
      brush.reset({ x: x * aspect, y });
    }
    const b = brush.follow({ x: x * aspect, y });
    inkAt = { x: b.x / aspect, y: b.y };
    addPoint(live, { x: inkAt.x, y: inkAt.y, t });
  } else if (!visible) {
    // pen up because the hand left view (lowered while still pinched): drop the
    // tail it drew on the way down
    endStroke(lifted?.upAt ?? t, LOSS_TRIM_MS);
  } else if (live && !lifted) {
    // a normal release: wait a moment before finishing, in case it was a flicker
    lifted = { upAt: t };
  }
}

function endStroke(upAt?: number, trimMs = RELEASE_TRIM_MS) {
  lifted = null;
  inkAt = null;
  if (!live) return;
  const done = trimTail(live, trimMs, upAt);
  live = null;
  if (isAccidental(done)) return;
  strokes.push(done);
  widths.push(1);
  bake(done);
}

/** Letting go: move the strokes themselves to where the hands left them, and re-draw crisp. */
function releaseGrab() {
  if (!held) return;
  const aspect = W / H;
  const T = grabTransform(held.a0, held.b0, held.a, held.b, aspect);
  strokes = strokes.map((s) => s.map((p) => ({ ...applyGrab(T, p, aspect), t: p.t })));
  widths = widths.map((w) => w * T.scale);
  held = null;
  rebake();
}

function clearWall() {
  endStroke();
  if (strokes.length === 0) return;
  sfx?.wipe();
  wipeStart = performance.now();
}

function finishWipe() {
  wipeStart = null;
  strokes = [];
  widths = [];
  rebake();
}

function undo() {
  if (live) {
    live = null;
    lifted = null;
    return;
  }
  strokes.pop();
  widths.pop();
  rebake();
}

// ---------------------------------------------------------------- messages

const channel = openChannel((msg: Msg) => {
  switch (msg.type) {
    case 'pen':
      if (!mouseMode) penInput(msg.x, msg.y, msg.down, msg.visible, performance.now());
      break;
    case 'grab':
      if (msg.phase === 'start' && msg.a && msg.b) {
        endStroke();
        held = { a0: msg.a, b0: msg.b, a: msg.a, b: msg.b };
        sfx?.blip();
      } else if (msg.phase === 'move' && held && msg.a && msg.b) {
        held.a = msg.a;
        held.b = msg.b;
      } else if (msg.phase === 'end') {
        releaseGrab();
      }
      break;
    case 'session':
      if (msg.live) {
        sfx?.start();
        igniting = true; // burst of sparks where the pen first appears
      } else {
        sfx?.stop();
        endStroke();
      }
      break;
    case 'clear':
      clearWall();
      break;
    case 'undo':
      undo();
      break;
    case 'calib':
      if (msg.step !== null && msg.step !== calib.step) sfx?.blip();
      else if (msg.step === null && calib.step === 3) sfx?.chime();
      calib = { step: msg.step, corners: msg.corners };
      break;
    case 'settings': {
      const thicknessChanged = msg.settings.thickness !== settings.thickness;
      settings = msg.settings;
      if (sfx) sfx.volume = settings.sfx;
      if (thicknessChanged) rebake();
      break;
    }
  }
});

// ---------------------------------------------------------------- render loop

let lastFrame = performance.now();

function frame(now: number) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;


  if (lifted && now - lifted.upAt >= STITCH_MS) endStroke(lifted.upAt);
  if (now - pen.at > PEN_STALE_MS && !mouseMode) {
    if (pen.visible || pen.down) penInput(pen.x, pen.y, false, false, now);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // finished ink (fading out during a wipe)
  let inkAlpha = 1;
  if (wipeStart !== null) {
    const k = (now - wipeStart) / WIPE_MS;
    if (k >= 1) finishWipe();
    else inkAlpha = 1 - k * k;
  }
  if (wipeStart !== null || strokes.length) {
    ctx.globalAlpha = inkAlpha;
    if (held) {
      // while held, move the already-drawn ink as one picture (fast); it's
      // re-drawn crisp from the moved strokes when the hands let go
      ctx.setTransform(...canvasMatrix(grabTransform(held.a0, held.b0, held.a, held.b, W / H), H));
      ctx.drawImage(baked, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.drawImage(baked, 0, 0);
    }
    ctx.globalAlpha = 1;
  }

  // live stroke
  if (live && live.length) {
    lctx.clearRect(0, 0, W, H);
    const shaped = smoothStroke(live);
    drawStroke(lctx, shaped, W, H, settings.thickness);
    drawHotTail(lctx, shaped, W, H, settings.thickness, now);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(liveLayer, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  // sparks follow the pen tip while writing
  // while writing, the pen dot sits where the ink comes out
  const at = pen.down && inkAt ? inkAt : pen;
  const tip = { x: at.x * W, y: at.y * H };
  if (pen.down && prevTip) sparks.emit(prevTip.x, prevTip.y, tip.x, tip.y, dt, settings.sparks, u);
  prevTip = pen.down ? tip : null;
  sparks.update(dt, u);
  sparks.draw(ctx);

  // pen dot
  const showDot = pen.visible && calib.step === null;
  dotAlpha += ((showDot ? 1 : 0) - dotAlpha) * Math.min(dt * 12, 1);
  if (dotAlpha > 0.01) drawDot(tip.x, tip.y, pen.down, dotAlpha, now);

  if (held) drawHands(now);
  if (calib.step !== null) drawCalibration(now);

  requestAnimationFrame(frame);
}

function drawDot(x: number, y: number, down: boolean, alpha: number, now: number) {
  const flicker = down ? 0.85 + 0.15 * Math.sin(now / 23) * Math.sin(now / 37) : 1;
  // the pen "ignites" when writing goes live: a bright swell that settles in ~½ s
  const ignite = 1 + 2.5 * Math.max(0, 1 - (now - igniteAt) / 500);
  const glowR = (down ? 46 : 26) * u * flicker * ignite;
  const coreR = (down ? 5.5 : 4) * u;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
  g.addColorStop(0, down ? 'rgba(255, 200, 110, 0.9)' : 'rgba(255, 179, 71, 0.55)');
  g.addColorStop(0.35, down ? 'rgba(255, 138, 0, 0.35)' : 'rgba(255, 138, 0, 0.18)');
  g.addColorStop(1, 'rgba(255, 94, 0, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, glowR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = down ? '#fffaf0' : '#ffe7b0';
  ctx.beginPath();
  ctx.arc(x, y, coreR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A glowing ring at each hand while it holds the writing. */
function drawHands(now: number) {
  if (!held) return;
  const pulse = 0.85 + 0.15 * Math.sin(now / 160);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of [held.a, held.b]) {
    const x = p.x * W, y = p.y * H, r = 34 * u * pulse;
    const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r * 1.6);
    g.addColorStop(0, 'rgba(255, 179, 71, 0)');
    g.addColorStop(0.35, 'rgba(255, 160, 50, 0.35)');
    g.addColorStop(1, 'rgba(255, 94, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 220, 160, 0.85)';
    ctx.lineWidth = 2.5 * u;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCalibration(now: number) {
  const pulse = 0.5 + 0.5 * Math.sin(now / 220);
  ctx.save();
  calib.corners.forEach((c, i) => {
    const x = c.x * W, y = c.y * H;
    const active = i === calib.step;
    const done = calib.step !== null && i < calib.step;
    ctx.strokeStyle = active ? `rgba(255, 200, 110, ${0.6 + 0.4 * pulse})` : done ? 'rgba(255,179,71,0.55)' : 'rgba(255,179,71,0.18)';
    ctx.lineWidth = (active ? 3 : 2) * u;
    ctx.beginPath();
    ctx.arc(x, y, (active ? 28 + 8 * pulse : 18) * u, 0, Math.PI * 2);
    ctx.stroke();
    if (active || done) {
      ctx.fillStyle = active ? '#fffaf0' : 'rgba(255,179,71,0.7)';
      ctx.beginPath();
      ctx.arc(x, y, 5 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    if (active) {
      ctx.fillStyle = 'rgba(255, 220, 160, 0.9)';
      ctx.font = `500 ${22 * u}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = c.x < 0.5 ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const tx = x + (c.x < 0.5 ? 52 : -52) * u;
      const ty = y + (c.y < 0.5 ? 56 : -56) * u;
      ctx.fillText(`Move your hand here and ${settings.penGesture === 'point' ? 'point' : 'pinch'}  ·  ${i + 1} of 4`, tx, ty);
    }
  });
  ctx.restore();
}

// ---------------------------------------------------------------- keys, mouse, fullscreen

let toastTimer = 0;
function toast(text: string, ms = 1800) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'f') toggleFullscreen();
  else if (k === 'x' || k === 'backspace' || k === 'delete') clearWall();
  else if (k === 'z') undo();
  else if (k === 'm') {
    mouseMode = !mouseMode;
    penInput(pen.x, pen.y, false, mouseMode, performance.now());
    toast(mouseMode ? 'Mouse test mode ON: click and drag to write' : 'Mouse test mode OFF');
    showCursor();
  } else channel.send({ type: 'key', key: k }); // c = calibrate, esc = cancel: handled by the control window
});

window.addEventListener('dblclick', () => {
  if (!mouseMode) toggleFullscreen();
});

let mouseDown = false;
const toWall = (e: MouseEvent) => ({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
canvas.addEventListener('mousedown', (e) => {
  if (!mouseMode) return;
  mouseDown = true;
  const p = toWall(e);
  penInput(p.x, p.y, true, true, performance.now());
});
window.addEventListener('mousemove', (e) => {
  showCursor();
  if (!mouseMode) return;
  const p = toWall(e);
  penInput(p.x, p.y, mouseDown, true, performance.now());
});
window.addEventListener('mouseup', (e) => {
  if (!mouseMode) return;
  mouseDown = false;
  const p = toWall(e);
  penInput(p.x, p.y, false, true, performance.now());
});

// keep the pen alive in mouse mode even when the mouse is still
setInterval(() => {
  if (mouseMode) pen.at = performance.now();
}, 100);

let cursorTimer = 0;
function showCursor() {
  document.body.classList.remove('hide-cursor');
  clearTimeout(cursorTimer);
  if (!mouseMode) cursorTimer = window.setTimeout(() => document.body.classList.add('hide-cursor'), 1500);
}

// ---------------------------------------------------------------- start

resize();
showCursor();
channel.send({ type: 'hello' });
setInterval(() => channel.send({ type: 'hello' }), 2000); // heartbeat so the control view knows the wall is open
toast('Air Writer wall\nClick once to turn on sound  ·  F or double-click for full screen  ·  M mouse test mode  ·  Q cancels calibration', 4000);
requestAnimationFrame(frame);

// for debugging from the console
Object.assign(window, { airWriterWall: { penInput, clearWall, undo, get strokes() { return strokes; } } });
