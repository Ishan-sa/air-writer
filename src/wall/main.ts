import { openChannel } from '../shared/channel';
import { DEFAULT_SETTINGS, type Msg, type Settings, type WallPoint } from '../shared/types';
import { drawHotTail, drawStroke } from './ink';
import { Sparks } from './sparks';
import { Sfx } from './sfx';
import { addPoint, trimTail, type Stroke } from './strokes';

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
let live: Stroke | null = null;
let wipeStart: number | null = null; // fade-out in progress
const WIPE_MS = 500;
const RELEASE_TRIM_MS = 70;
const PEN_STALE_MS = 300;

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
let soundDown = false; // pen state as last heard, so a split stroke doesn't replay the charge
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

function penSound(down: boolean) {
  if (down === soundDown) return;
  soundDown = down;
  if (!sfx) return;
  if (down) {
    sfx.penDown();
    sfx.startHum();
  } else {
    sfx.stopHum();
    sfx.penUp();
  }
}

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
  for (const s of strokes) bake(s);
}

/** Renders a finished stroke via the scratch layer and adds it to the baked ink. */
function bake(s: Stroke) {
  lctx.clearRect(0, 0, W, H);
  drawStroke(lctx, s, W, H, settings.thickness);
  bctx.save();
  bctx.globalCompositeOperation = 'lighter';
  bctx.drawImage(liveLayer, 0, 0);
  bctx.restore();
  lctx.clearRect(0, 0, W, H);
}

// ---------------------------------------------------------------- ink state

/** A jump bigger than this in one frame (e.g. tracking hopping to the other hand) starts a new stroke. */
const MAX_JUMP = 0.2;

/** `t` is this window's clock: stamped on arrival so it matches the render loop's clock. */
function penInput(x: number, y: number, down: boolean, visible: boolean, t: number) {
  // when the hand leaves view, keep the last position so the dot fades where it was
  if (!visible) ({ x, y } = pen);
  const jumped = Math.hypot(x - pen.x, y - pen.y) > MAX_JUMP;
  pen = { x, y, down: down && visible, visible, at: performance.now() };
  if (calib.step !== null) {
    penSound(false);
    endStroke(t);
    return;
  }
  penSound(pen.down);
  if (pen.down) {
    if (wipeStart !== null) finishWipe();
    if (live && jumped) {
      endStroke(t);
      prevTip = null;
    }
    if (!live) live = [];
    addPoint(live, { x, y, t });
  } else {
    endStroke(t);
  }
}

function endStroke(upAt?: number) {
  if (!live) return;
  const done = trimTail(live, RELEASE_TRIM_MS, upAt);
  live = null;
  strokes.push(done);
  bake(done);
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
  rebake();
}

function undo() {
  if (live) {
    live = null;
    return;
  }
  strokes.pop();
  rebake();
}

// ---------------------------------------------------------------- messages

const channel = openChannel((msg: Msg) => {
  switch (msg.type) {
    case 'pen':
      if (!mouseMode) penInput(msg.x, msg.y, msg.down, msg.visible, performance.now());
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

let lastSoundPos = { x: 0.5, y: 0.5 };

function frame(now: number) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  // the writing hum follows how fast the pen moves across the wall
  if (sfx && pen.down && dt > 0) {
    sfx.writing(Math.hypot(pen.x - lastSoundPos.x, pen.y - lastSoundPos.y) / dt, dt);
  }
  lastSoundPos = { x: pen.x, y: pen.y };

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
    ctx.drawImage(baked, 0, 0);
    ctx.globalAlpha = 1;
  }

  // live stroke
  if (live && live.length) {
    lctx.clearRect(0, 0, W, H);
    drawStroke(lctx, live, W, H, settings.thickness);
    drawHotTail(lctx, live, W, H, settings.thickness, now);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(liveLayer, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  // sparks follow the pen tip while writing
  const tip = { x: pen.x * W, y: pen.y * H };
  if (pen.down && prevTip) sparks.emit(prevTip.x, prevTip.y, tip.x, tip.y, dt, settings.sparks, u);
  prevTip = pen.down ? tip : null;
  sparks.update(dt, u);
  sparks.draw(ctx);

  // pen dot
  const showDot = pen.visible && calib.step === null;
  dotAlpha += ((showDot ? 1 : 0) - dotAlpha) * Math.min(dt * 12, 1);
  if (dotAlpha > 0.01) drawDot(tip.x, tip.y, pen.down, dotAlpha, now);

  if (calib.step !== null) drawCalibration(now);

  requestAnimationFrame(frame);
}

function drawDot(x: number, y: number, down: boolean, alpha: number, now: number) {
  const flicker = down ? 0.85 + 0.15 * Math.sin(now / 23) * Math.sin(now / 37) : 1;
  const glowR = (down ? 46 : 26) * u * flicker;
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
      ctx.fillText(`Move your hand here and pinch  ·  ${i + 1} of 4`, tx, ty);
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
