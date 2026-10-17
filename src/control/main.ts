import { openChannel } from '../shared/channel';
import { load, loadRaw, save } from '../shared/storage';
import { DEFAULT_SETTINGS, type Msg, type Settings } from '../shared/types';
import { Calibration } from '../tracking/calibration';
import { handInFrame, isOpenPalm, PalmHold, penPoint, PinchDetector, pinchRatio } from '../tracking/gestures';
import type { Homography } from '../tracking/homography';
import { CALIB_CORNERS, cameraToWall } from '../tracking/mapping';
import { PointFilter } from '../tracking/oneEuro';
import { createHandTracker, HandLandmarker } from '../tracking/tracker';
import './control.css';
import { diag, pt, r4 } from './diag';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const overlay = $<HTMLCanvasElement>('overlay');
const octx = overlay.getContext('2d')!;
const cameraSelect = $<HTMLSelectElement>('camera-select');
const cameraMsg = $('camera-msg');

// v2: pinch thresholds were retuned after the first live test, so older saved values are dropped
let settings: Settings = load('settings-v2', DEFAULT_SETTINGS);
// v2: calibrations made with the old perspective fit are discarded (they could flip ink)
let H: Homography | null = loadRaw<Homography>('homography-v2');

const pinch = new PinchDetector();
const filter = new PointFilter();
const palm = new PalmHold();
const calibration = new Calibration();
let tracker: HandLandmarker | null = null;
/** After calibration ends the pinch is usually still held: no ink until it's released once. */
let needsRelease = false;
let lastHandAt = 0;
const HAND_LOST_MS = 150;

// ---------------------------------------------------------------- channel to the wall

let wallSeenAt = -Infinity;
const channel = openChannel((msg: Msg) => {
  if (msg.type === 'hello') {
    wallSeenAt = performance.now();
    pushState();
  } else if (msg.type === 'key') {
    handleKey(msg.key);
  }
});

function pushState() {
  channel.send({ type: 'settings', settings });
  channel.send({ type: 'calib', step: calibration.step, corners: CALIB_CORNERS });
}

const wallConnected = () => performance.now() - wallSeenAt < 3500;
setInterval(() => {
  setText($('wall-status'), wallConnected() ? 'The wall window is open.' : 'The wall window isn’t open.');
  renderStatus();
}, 500);

// ---------------------------------------------------------------- the big status word

type Level = 'idle' | 'ready' | 'live' | 'guide' | 'problem';
let trackerState: 'loading' | 'ready' | 'failed' = 'loading';
let cameraProblem: string | null = null;
let live = { hand: false, down: false, palm: 0 };
let handAtEdgeAt = -Infinity;
const CORNER_NAMES = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];

function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

/** One word Ishan can read from the wall, plus one plain sentence of context. */
function renderStatus() {
  let word: string, detail: string, level: Level;
  if (trackerState === 'failed') {
    [word, detail, level] = ['Tracker failed', 'Reload the page. If it keeps failing, quit and reopen Chrome.', 'problem'];
  } else if (trackerState === 'loading') {
    [word, detail, level] = ['Loading', 'Starting the hand tracker.', 'idle'];
  } else if (cameraProblem) {
    [word, detail, level] = ['No camera', cameraProblem, 'problem'];
  } else if (calibration.active) {
    word = CORNER_NAMES[calibration.step!];
    detail = `Move your hand to the ${word.toLowerCase()} corner of the area you’ll write in, then pinch and hold for half a second. Corner ${calibration.step! + 1} of 4. Q or Esc cancels.`;
    level = 'guide';
  } else if (live.hand && live.palm > 0.05) {
    [word, detail, level] = ['Wiping', 'Keep your palm open to clear the wall.', 'guide'];
  } else if (live.hand && live.down && !needsRelease) {
    [word, detail, level] = ['Writing', setupSentence(), 'live'];
  } else if (live.hand) {
    [word, detail, level] = ['Ready', `Pinch to write. ${setupSentence()}`, 'ready'];
  } else if (performance.now() - handAtEdgeAt < 600) {
    [word, detail, level] = ['Out of frame', 'Your hand is at the edge of the tracking camera’s view. Keep it inside the frame, or move the camera back or tilt it.', 'problem'];
  } else {
    [word, detail, level] = ['No hand', 'Raise your writing hand where the tracking camera can see it.', 'idle'];
  }
  const state = $('state');
  setText(state, word);
  if (state.dataset.level !== level) state.dataset.level = level;
  setText($('state-detail'), detail);
}

function setupSentence() {
  if (!wallConnected()) return 'The wall window isn’t open yet. Press W.';
  return H ? 'The wall is open and calibrated.' : 'The wall is open. Press C to calibrate.';
}

// ---------------------------------------------------------------- settings UI

function applySettings() {
  pinch.setDownThreshold(settings.pinchDown);
  filter.setSmoothing(settings.smoothing);
  save('settings-v2', settings);
  channel.send({ type: 'settings', settings });
}

function bindSlider(id: string, key: 'smoothing' | 'thickness' | 'sparks' | 'pinchDown' | 'sfx', fmt: (v: number) => string) {
  const input = $<HTMLInputElement>(id);
  const out = input.parentElement!.querySelector('output')!;
  input.value = String(settings[key]);
  out.textContent = fmt(settings[key]);
  input.addEventListener('input', () => {
    settings = { ...settings, [key]: Number(input.value) };
    out.textContent = fmt(settings[key]);
    applySettings();
  });
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(1)}×`;
bindSlider('s-smoothing', 'smoothing', pct);
bindSlider('s-thickness', 'thickness', times);
bindSlider('s-sparks', 'sparks', times);
// higher sensitivity = pen goes down with fingers further apart
bindSlider('s-pinch', 'pinchDown', (v) => v.toFixed(2));
bindSlider('s-sfx', 'sfx', (v) => (v === 0 ? 'off' : pct(v)));

function bindCheck(id: string, key: 'mirror' | 'palmWipe') {
  const input = $<HTMLInputElement>(id);
  input.checked = settings[key];
  input.addEventListener('change', () => {
    settings = { ...settings, [key]: input.checked };
    applySettings();
  });
}
bindCheck('s-mirror', 'mirror');
bindCheck('s-palm', 'palmWipe');
applySettings();

// ---------------------------------------------------------------- calibration UI

function renderCalibStatus(note?: string) {
  const el = $('calib-status');
  el.className = 'note';
  if (calibration.active) {
    el.textContent = `Calibrating, corner ${calibration.step! + 1} of 4.`;
  } else if (note) {
    el.textContent = note;
    el.classList.add('bad');
  } else if (H) {
    el.textContent = 'Calibrated to your writing area.';
    el.classList.add('good');
  } else {
    el.textContent = 'Not calibrated, so ink is drawn big in front of you.';
  }
  renderStatus();
}

function startCalibration() {
  calibration.start();
  channel.send({ type: 'clear' });
  pushState();
  renderCalibStatus();
}

function cancelCalibration() {
  if (!calibration.active) return;
  calibration.cancel();
  needsRelease = true;
  pushState();
  renderCalibStatus();
}

function onCalibEvent(ev: ReturnType<Calibration['update']>) {
  if (!ev) return;
  diag({ k: 'calib', ev: ev.kind, step: 'step' in ev ? ev.step : null, H: 'H' in ev ? ev.H : null, pts: (calibration as any).captured });
  if (ev.kind !== 'captured') needsRelease = true;
  if (ev.kind === 'done') {
    H = ev.H;
    save('homography-v2', H);
    filter.reset();
    renderCalibStatus();
  } else if (ev.kind === 'failed') {
    renderCalibStatus(ev.reason);
  } else {
    renderCalibStatus();
  }
  pushState();
}

$('calibrate').addEventListener('click', startCalibration);
$('reset-calib').addEventListener('click', () => {
  H = null;
  save('homography-v2', null);
  renderCalibStatus();
});
$('clear').addEventListener('click', () => channel.send({ type: 'clear' }));
$('undo').addEventListener('click', () => channel.send({ type: 'undo' }));
renderCalibStatus();

// ---------------------------------------------------------------- wall window

let wallWin: Window | null = null;

function openWall() {
  // reuse an open wall: re-opening by name would reload it and wipe the ink / exit full screen
  if (wallWin && !wallWin.closed) {
    wallWin.focus();
    return;
  }
  // open synchronously so the click's user activation isn't spent waiting on a permission prompt
  wallWin = window.open('/wall.html', 'air-writer-wall', 'popup,width=1280,height=720');
  placeWallOnProjector();
}

/** Chrome's Window Management API: move the wall onto the other display if we're allowed. */
async function placeWallOnProjector() {
  try {
    const status = await navigator.permissions.query({ name: 'window-management' as PermissionName });
    if (status.state === 'denied') return;
    const details = await (window as any).getScreenDetails?.();
    const external = details?.screens?.find((s: any) => s !== details.currentScreen && !s.isInternal)
      ?? details?.screens?.find((s: any) => s !== details.currentScreen);
    if (external && wallWin && !wallWin.closed) {
      wallWin.moveTo(external.availLeft, external.availTop);
      wallWin.resizeTo(external.availWidth, external.availHeight);
    }
  } catch {
    /* unsupported or declined: drag the window onto the projector */
  }
}
$('open-wall').addEventListener('click', openWall);

// ---------------------------------------------------------------- theme
/** Skeleton colours come from the theme's CSS tokens; re-read whenever the theme changes. */
let ink = readInk();
function readInk() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { bone: v('--bone', 'rgba(255,130,105,0.7)'), joint: v('--joint', '#ffb3a1'), pen: v('--pen', '#ff5436') };
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => (ink = readInk()));


type Theme = 'dark' | 'light' | 'auto';
const THEMES: Theme[] = ['dark', 'light', 'auto'];
let theme: Theme = loadRaw<Theme>('theme') ?? 'auto';

function applyTheme(next: Theme) {
  theme = next;
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  save('theme', theme);
  ink = readInk();
  document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === theme));
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((b) =>
  b.addEventListener('click', () => applyTheme(b.dataset.themeChoice as Theme)),
);
applyTheme(theme);

// ---------------------------------------------------------------- keys

function handleKey(k: string) {
  if (k === 'c') startCalibration();
  else if (k === 'escape' || k === 'q') cancelCalibration();
  else if (k === ' ' && calibration.active) onCalibEvent(calibration.captureNow(performance.now()));
  else if (k === 'x' || k === 'backspace' || k === 'delete') channel.send({ type: 'clear' });
  else if (k === 'z') channel.send({ type: 'undo' });
  else if (k === 'w') openWall();
  else if (k === 't') applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
}

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
  if (e.key === ' ') e.preventDefault();
  handleKey(e.key.toLowerCase());
});

// sliders/checkboxes/dropdowns give focus back so Space and letters stay shortcuts
document.querySelectorAll('input, select').forEach((el) =>
  el.addEventListener('change', () => (el as HTMLElement).blur()),
);
document.querySelectorAll('input[type=range]').forEach((el) =>
  el.addEventListener('pointerup', () => (el as HTMLElement).blur()),
);

// ---------------------------------------------------------------- camera

const savedCameraId = () => load<{ id?: string }>('camera', {}).id;
let cameraRequest = 0;

async function listCameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  cameraSelect.innerHTML = '';
  for (const d of devices) {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${cameraSelect.length + 1}`;
    cameraSelect.append(opt);
  }
  syncCameraSelect();
  return devices;
}

function currentCameraId() {
  return (video.srcObject as MediaStream | null)?.getVideoTracks()[0]?.getSettings().deviceId;
}

function syncCameraSelect() {
  const id = currentCameraId();
  if (id) cameraSelect.value = id;
}

/** Opens a camera. Returns false if it couldn't (e.g. the saved iPhone isn't connected yet). */
async function startCamera(deviceId?: string, remember = false): Promise<boolean> {
  const req = ++cameraRequest;
  cameraMsg.textContent = 'Starting camera…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
      },
      audio: false,
    });
    if (req !== cameraRequest) {
      // a newer request superseded this one
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    video.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', onCameraLost);
    await video.play().catch(() => {});
    cameraMsg.textContent = '';
    cameraProblem = null;
    diag({ k: 'camera', label: track.label, settings: track.getSettings() });
    resetTracking();
    syncCameraSelect();
    if (remember && track.getSettings().deviceId) save('camera', { id: track.getSettings().deviceId });
    return true;
  } catch (err) {
    if (req === cameraRequest) {
      const name = (err as Error).name;
      cameraProblem =
        name === 'NotAllowedError'
          ? 'Chrome isn’t allowed to use the camera. Allow it in the address bar, or in System Settings under Privacy & Security, Camera.'
          : 'Chrome can’t find a camera. Keep the iPhone near the Mac, on the same Apple ID, with Wi-Fi and Bluetooth on, then pick it below.';
      cameraMsg.textContent = '';
      renderStatus();
    }
    return false;
  }
}

cameraSelect.addEventListener('change', () => startCamera(cameraSelect.value, true));

/** Saved camera → any iPhone → whatever Chrome picks. Only an explicit choice is remembered. */
async function initCamera() {
  const saved = savedCameraId();
  let ok = saved ? await startCamera(saved) : false;
  if (!ok) ok = await startCamera(); // also unlocks device labels
  const devices = await listCameras();
  const iphone = devices.find((d) => /iphone/i.test(d.label));
  const current = currentCameraId();
  const savedPresent = saved && devices.some((d) => d.deviceId === saved);
  if (!savedPresent && iphone && iphone.deviceId !== current) await startCamera(iphone.deviceId);
  syncCameraSelect();
}

let reconnecting = false;
async function onCameraLost() {
  if (reconnecting) return;
  reconnecting = true;
  cameraMsg.textContent = 'The camera disconnected. Reconnecting…';
  resetTracking();
  sendPen(lastPen.x, lastPen.y, false, false);
  await initCamera();
  reconnecting = false;
}

navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
  await listCameras();
  // the iPhone often shows up a few seconds after launch: move to it (or to the saved camera)
  // unless the camera running now is the one Ishan explicitly picked
  const saved = savedCameraId();
  const cur = currentCameraId();
  const options = [...cameraSelect.options].map((o) => ({ id: o.value, label: o.textContent ?? '' }));
  const want = options.find((d) => d.id === saved) ?? options.find((d) => /iphone/i.test(d.label));
  if (want && want.id !== cur && cur !== saved) await startCamera(want.id);
});

// ---------------------------------------------------------------- tracking loop

let lastTs = 0;
let lastFrameAt = 0;
let fpsFrames = 0, fpsSince = performance.now(), detectMs = 0;
let lastPen = { x: 0.5, y: 0.5 };
let handGone = true; // whether the wall has been told the hand is gone

function sendPen(x: number, y: number, down: boolean, visible: boolean) {
  channel.send({ type: 'pen', x, y, down, visible, t: performance.now() });
}

function resetTracking() {
  pinch.reset();
  filter.reset();
  palm.update(false, performance.now() + 1e6);
}

function processFrame() {
  if (!tracker || video.readyState < 2) return;
  let ts = performance.now();
  if (ts <= lastTs) ts = lastTs + 1; // MediaPipe needs strictly increasing timestamps
  lastTs = ts;
  lastFrameAt = ts;

  const t0 = performance.now();
  const res = tracker.detectForVideo(video, ts);
  detectMs = detectMs * 0.9 + (performance.now() - t0) * 0.1;
  fpsFrames++;

  const img = res.landmarks[0];
  const world = res.worldLandmarks[0];
  const now = performance.now();
  // a hand cut off by the frame edge gives garbage readings: treat it as no hand
  const inFrame = !!img && handInFrame(img);
  if (img && !inFrame) handAtEdgeAt = now;

  if (img && world && inFrame) {
    lastHandAt = now;
    handGone = false;
    const ratio = pinchRatio(world);
    const down = pinch.update(ratio);
    const raw = penPoint(img);
    if (!down) needsRelease = false;

    const handPx = Math.hypot(img[0].x - img[9].x, (img[0].y - img[9].y) * (video.videoHeight / video.videoWidth || 0.5625));
    const w0 = calibration.active ? null : cameraToWall(raw, H, settings.mirror);
    diag({ k: 'f', lm: img.map((p) => [Math.round(p.x * 1000), Math.round(p.y * 1000)]), ratio: r4(ratio), down, raw: pt(raw), wall: pt(w0), hand: r4(handPx), score: r4(res.handedness[0]?.[0]?.score ?? 0), cal: calibration.step, nr: needsRelease });

    if (calibration.active) {
      onCalibEvent(calibration.update(raw, down, now));
      sendPen(lastPen.x, lastPen.y, false, false);
    } else {
      const w = w0;
      if (!w) {
        // outside what the calibration can map (behind the camera's horizon): treat as out of view
        sendPen(lastPen.x, lastPen.y, false, false);
      } else {
        const f = filter.filter(w.x, w.y, now / 1000);
        lastPen = f;
        sendPen(f.x, f.y, down && !needsRelease, true);
      }
    }

    let palmProgress = 0;
    if (settings.palmWipe && !down && !calibration.active) {
      const r = palm.update(isOpenPalm(world), now);
      palmProgress = r.progress;
      if (r.fire) channel.send({ type: 'clear' });
    } else {
      palm.update(false, now);
    }
    drawOverlay(img, down);
    updateReadout(true, down, ratio, palmProgress, res.handedness[0]?.[0]?.score ?? 0);
  } else {
    palm.update(false, now);
    // a one-frame dropout shouldn't break the stroke: say nothing during the grace period
    // (the wall holds the last state), then tell the wall the hand is gone
    diag({ k: img ? 'edge' : 'none', raw: img ? pt(penPoint(img)) : null });
    if (now - lastHandAt > HAND_LOST_MS) handLost(now);
    drawOverlay(null, false);
    updateReadout(false, false, 1, 0, 0);
  }
}

function handLost(now: number) {
  if (handGone) return;
  handGone = true;
  resetTracking();
  if (calibration.active) calibration.update(null, false, now);
  sendPen(lastPen.x, lastPen.y, false, false);
}

function loop() {
  // schedule first so one bad frame can't stop tracking for good
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(loop);
  else requestAnimationFrame(loop);
  try {
    processFrame();
  } catch (err) {
    console.error('tracking frame failed', err);
  }
}

// watchdog: if the camera stalls (no frames at all), don't leave the pen stuck down
setInterval(() => {
  const now = performance.now();
  if (lastFrameAt && now - lastFrameAt > 250) {
    lastHandAt = Math.min(lastHandAt, now - HAND_LOST_MS - 1);
    handLost(now);
  }
}, 100);

// ---------------------------------------------------------------- overlay + readout

let previewSize: { w: number; h: number } | null = null;


function drawOverlay(img: { x: number; y: number }[] | null, down: boolean) {
  const vw = video.videoWidth || previewSize?.w || 1280, vh = video.videoHeight || previewSize?.h || 720;
  if (overlay.width !== vw || overlay.height !== vh) {
    overlay.width = vw;
    overlay.height = vh;
  }
  octx.clearRect(0, 0, vw, vh);
  if (!img) return;
  octx.lineWidth = 3;
  octx.strokeStyle = ink.bone;
  for (const c of HandLandmarker.HAND_CONNECTIONS) {
    const a = img[c.start], b = img[c.end];
    octx.beginPath();
    octx.moveTo(a.x * vw, a.y * vh);
    octx.lineTo(b.x * vw, b.y * vh);
    octx.stroke();
  }
  octx.fillStyle = ink.joint;
  for (const p of img) {
    octx.beginPath();
    octx.arc(p.x * vw, p.y * vh, 4, 0, Math.PI * 2);
    octx.fill();
  }
  const pen = penPoint(img as any);
  octx.beginPath();
  octx.arc(pen.x * vw, pen.y * vh, down ? 14 : 9, 0, Math.PI * 2);
  octx.fillStyle = ink.pen;
  octx.shadowColor = ink.pen;
  octx.shadowBlur = down ? 24 : 8;
  octx.fill();
  octx.shadowBlur = 0;
}

function updateReadout(hand: boolean, down: boolean, ratio: number, palmProgress: number, _score: number) {
  live = { hand, down, palm: palmProgress };
  renderStatus();
  $('m-pinch').style.width = `${Math.max(0, Math.min(1, 1 - ratio / 1.2)) * 100}%`;
  $('m-pinch-mark').style.left = `${(1 - settings.pinchDown / 1.2) * 100}%`;
  $('m-palm').style.width = `${palmProgress * 100}%`;
}

// FPS + scene brightness (a dark scene means slow, blurry frames and lost tracking)
const probe = document.createElement('canvas');
probe.width = 32;
probe.height = 18;
const pctx = probe.getContext('2d', { willReadFrequently: true })!;
setInterval(() => {
  const now = performance.now();
  const fps = (fpsFrames * 1000) / (now - fpsSince);
  fpsFrames = 0;
  fpsSince = now;
  setText($('fps'), tracker && video.readyState >= 2 ? `${fps.toFixed(0)} frames a second, ${detectMs.toFixed(0)} ms to track` : '');
  if (video.readyState >= 2) {
    pctx.drawImage(video, 0, 0, 32, 18);
    const d = pctx.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const luma = sum / (d.length / 4) / 255;
    const el = $('r-light');
    const [text, cls] =
      luma < 0.12
        ? ['Too dark for tracking. Put a dim light on yourself from the wall side.', 'note bad']
        : luma < 0.22
          ? ['Light is dim. Tracking may drop out.', 'note']
          : ['Light is good for tracking.', 'note good'];
    setText(el, text);
    el.className = cls;
  } else {
    setText($('r-light'), 'Light reading appears once the camera is on.');
  }
}, 1000);

// ---------------------------------------------------------------- start

async function init() {
  diag({ k: 'start', H, settings, video: [video.videoWidth, video.videoHeight] });
  const cameraReady = initCamera();
  try {
    tracker = await createHandTracker('VIDEO');
    trackerState = 'ready';
  } catch (err) {
    trackerState = 'failed';
    console.error(err);
  }
  renderStatus();
  await cameraReady;
  loop();
}
init();

// debugging hooks: run the tracker on a still image from the console
Object.assign(window, {
  airWriter: {
    async detectImage(url: string) {
      const t = await createHandTracker('IMAGE');
      const imgEl = new Image();
      await new Promise((res, rej) => {
        imgEl.onload = res;
        imgEl.onerror = rej;
        imgEl.src = url;
      });
      const r = t.detect(imgEl);
      return r.worldLandmarks.map((w, i) => ({ pinchRatio: pinchRatio(w), openPalm: isOpenPalm(w), pen: penPoint(r.landmarks[i]), landmarks: r.landmarks[i] }));
    },
    /** Shows a still photo as the feed and draws its hand as if tracking live (UI checks without a camera). */
    async preview(url: string, down: boolean) {
      const [hand] = await this.detectImage(url);
      const img = new Image();
      await new Promise((res) => ((img.onload = res), (img.src = url)));
      previewSize = { w: img.naturalWidth, h: img.naturalHeight };
      video.poster = url;
      cameraProblem = null;
      trackerState = 'ready';
      wallSeenAt = performance.now() + 1e9;
      drawOverlay(hand.landmarks, down);
      updateReadout(true, down, down ? 0.12 : 0.7, 0, 0.95);
    },
    get settings() { return settings; },
    get homography() { return H; },
  },
});
