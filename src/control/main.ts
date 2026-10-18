import { openChannel } from '../shared/channel';
import { load, loadRaw, save } from '../shared/storage';
import { DEFAULT_SETTINGS, type Msg, type Settings } from '../shared/types';
import { Calibration } from '../tracking/calibration';
import { flatPinchGap, fingerReach, handInFrame, indexTip, isHandOpen, isOpenPalm, penPoint, PinchDetector, pinchRatio, PointDetector, type Lm } from '../tracking/gestures';
import { WriteSession } from '../tracking/session';
import { TwoHandGrab } from '../tracking/grab';
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
// each pen gesture keeps its own calibration: the pen sits on a different spot of the hand
const calibKey = () => (settings.penGesture === 'point' ? 'homography-v2-point' : 'homography-v2');
let H: Homography | null = loadRaw<Homography>(calibKey());

const pinch = new PinchDetector();
const pointer = new PointDetector();
const penIsDown = () => (settings.penGesture === 'point' ? pointer.down : pinch.down);
/** Where the pen sits on the hand for the current gesture. */
const penTip = (img: Lm[]) => (settings.penGesture === 'point' ? indexTip(img) : penPoint(img));
const filter = new PointFilter();
const session = new WriteSession();
const grab = new TwoHandGrab();
const grabFilters = [new PointFilter(), new PointFilter()];
grabFilters.forEach((f) => f.setSmoothing(0.6));
/** Which hand writes ('Left'/'Right' as MediaPipe labels it), learned from the first stroke. */
let writerLabel = '';
let lastWriterRaw: { x: number; y: number } | null = null;

interface TrackedHand {
  img: Lm[];
  world: Lm[];
  label: string;
}

/** With two hands in view, the writing hand is the one that wrote last (by label, then by position). */
function pickWriter(hands: TrackedHand[]): TrackedHand | null {
  if (hands.length <= 1) return hands[0] ?? null;
  const byLabel = hands.filter((h) => h.label === writerLabel);
  if (writerLabel && byLabel.length === 1) return byLabel[0];
  if (lastWriterRaw) {
    const d = (h: TrackedHand) => Math.hypot(h.img[8].x - lastWriterRaw!.x, h.img[8].y - lastWriterRaw!.y);
    return d(hands[0]) <= d(hands[1]) ? hands[0] : hands[1];
  }
  return hands[0];
}
const calibration = new Calibration();
let tracker: HandLandmarker | null = null;
let lastHandAt = 0;
const HAND_LOST_MS = 150;
// while writing, fast strokes blur and the tracker can lose the hand for a few
// frames (recorded gaps: p90 ~200 ms, max ~480 ms); bridge those instead of ending the stroke
const HAND_LOST_WRITING_MS = 350;

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
let live = { hand: false, down: false, start: 0, wipe: 0 };
let handAtEdgeAt = -Infinity;
let handSize = 0; // wrist-to-knuckle length as a fraction of frame width, smoothed
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
    detail = `Move your hand to the ${word.toLowerCase()} corner of the area you’ll write in, then ${settings.penGesture === 'point' ? 'point' : 'pinch'} and hold for half a second. Corner ${calibration.step! + 1} of 4. Q or Esc cancels.`;
    level = 'guide';
  } else if (grab.active) {
    [word, detail, level] = ['Moving', 'Slide, twist or spread your hands to move, rotate and resize. Drop a hand to let go.', 'live'];
  } else if (session.armed && live.hand && live.wipe > 0.05) {
    [word, detail, level] = ['Wiping', 'Keep your palm up to clear the wall.', 'guide'];
  } else if (session.armed && live.hand && live.down) {
    [word, detail, level] = ['Writing', settings.penGesture === 'point' ? 'Curl your finger or open your hand to lift the pen.' : 'Open your fingers to lift the pen.', 'live'];
  } else if (session.armed) {
    const wipe = (settings.swipeWipe ? ' Hold up an open palm, or swipe, to wipe.' : ' Hold up an open palm to wipe.') + ' Raise both open hands to move the writing.';
    [word, detail, level] = ['Ready', `${settings.penGesture === 'point' ? 'Point your index finger' : 'Pinch'} to write.${wipe} Lower your hand to stop. ${setupSentence()}`, 'ready'];
  } else if (live.hand && live.start > 0.05) {
    [word, detail, level] = ['Starting', 'Keep your palm open…', 'guide'];
  } else if (live.hand) {
    [word, detail, level] = ['Show your palm', `Hold an open palm toward the camera for a moment to start writing. ${setupSentence()}`, 'idle'];
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
  // measured: a hand under ~4% of the frame width tracks noticeably shakier
  if (handSize && handSize < 0.04) return 'Your hand is small in the camera frame, so lines will be shaky. Move the tracking camera closer to you.';
  return H ? 'The wall is open and calibrated.' : 'The wall is open. Press C to calibrate.';
}

// ---------------------------------------------------------------- settings UI

function applySettings() {
  pinch.setDownThreshold(settings.pinchDown);
  session.swipeEnabled = settings.swipeWipe;
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

function bindCheck(id: string, key: 'mirror' | 'swipeWipe') {
  const input = $<HTMLInputElement>(id);
  input.checked = settings[key];
  input.addEventListener('change', () => {
    settings = { ...settings, [key]: input.checked };
    applySettings();
  });
}
bindCheck('s-mirror', 'mirror');
bindCheck('s-swipe', 'swipeWipe');
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
  session.requireRelease();
  pushState();
  renderCalibStatus();
}

function onCalibEvent(ev: ReturnType<Calibration['update']>) {
  if (!ev) return;
  diag({ k: 'calib', ev: ev.kind, step: 'step' in ev ? ev.step : null, H: 'H' in ev ? ev.H : null, pts: (calibration as any).captured });
  if (ev.kind !== 'captured') session.requireRelease();
  if (ev.kind === 'done') {
    H = ev.H;
    save(calibKey(), H);
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
  save(calibKey(), null);
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

// ---------------------------------------------------------------- pen gesture

function setPenGesture(next: 'point' | 'pinch') {
  settings = { ...settings, penGesture: next };
  applySettings();
  H = loadRaw<Homography>(calibKey());
  resetTracking();
  session.requireRelease();
  renderPenChoice();
  renderCalibStatus();
}
function renderPenChoice() {
  document.querySelectorAll<HTMLButtonElement>('[data-pen-choice]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.penChoice === settings.penGesture));
  });
  // the pinch sensitivity slider only matters when drawing by pinch
  const pinchRow = $('s-pinch').parentElement!;
  pinchRow.style.display = settings.penGesture === 'pinch' ? '' : 'none';
}
document.querySelectorAll<HTMLButtonElement>('[data-pen-choice]').forEach((b) =>
  b.addEventListener('click', () => setPenGesture(b.dataset.penChoice as 'point' | 'pinch')),
);
renderPenChoice();

// ---------------------------------------------------------------- keys

function handleKey(k: string) {
  if (k === 'c') startCalibration();
  else if (k === 'escape' || k === 'q') cancelCalibration();
  else if (k === ' ' && calibration.active) onCalibEvent(calibration.captureNow(performance.now()));
  else if (k === 'x' || k === 'backspace' || k === 'delete') channel.send({ type: 'clear' });
  else if (k === 'z') channel.send({ type: 'undo' });
  else if (k === 'w') openWall();
  else if (k === 't') applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
  else if (k === 'p') setPenGesture(settings.penGesture === 'point' ? 'pinch' : 'point');
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
        // full HD gives the tracker ~50% more pixels on a hand that's small in the frame
        width: { ideal: 1920 },
        height: { ideal: 1080 },
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
  pointer.reset();
  filter.reset();
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

  const now = performance.now();
  const all: TrackedHand[] = res.landmarks
    .map((img, i) => ({ img, world: res.worldLandmarks[i], label: res.handedness[i]?.[0]?.categoryName ?? '' }))
    .filter((h) => h.world);
  // a hand cut off by the frame edge gives garbage readings: treat it as no hand
  const hands = all.filter((h) => handInFrame(h.img));
  if (all.length > hands.length && hands.length === 0) handAtEdgeAt = now;
  const writer = pickWriter(hands);
  const other = hands.find((h) => h !== writer) ?? null;
  const img = writer?.img;
  const world = writer?.world;
  const inFrame = !!writer;

  if (img && world && inFrame) {
    lastHandAt = now;
    handGone = false;
    const ratio = pinchRatio(world);
    const aspect = video.videoHeight / video.videoWidth || 0.5625;
    const flatGap = flatPinchGap(img, aspect);
    const pinchDown = pinch.update(ratio, flatGap);
    const pointDown = pointer.update(world);
    const down = settings.penGesture === 'point' ? pointDown : pinchDown;
    const raw = penTip(img);
    lastWriterRaw = { x: img[8].x, y: img[8].y };
    if (down && writer!.label) writerLabel = writer!.label;

    const handPx = Math.hypot(img[0].x - img[9].x, (img[0].y - img[9].y) * (video.videoHeight / video.videoWidth || 0.5625));
    handSize = handSize ? handSize * 0.97 + handPx * 0.03 : handPx;
    const w0 = calibration.active ? null : cameraToWall(raw, H, settings.mirror);
    diag({ k: 'f', lm: img.map((p) => [Math.round(p.x * 1000), Math.round(p.y * 1000)]), ratio: r4(ratio), gap: r4(flatGap), reach: Object.values(fingerReach(world)).map(r4), pen: settings.penGesture, down, raw: pt(raw), wall: pt(w0), hand: r4(handPx), score: r4(res.handedness[0]?.[0]?.score ?? 0), cal: calibration.step, armed: session.armed });

    let startProgress = 0, wipeProgress = 0;
    if (calibration.active) {
      onCalibEvent(calibration.update(raw, down, now));
      sendPen(lastPen.x, lastPen.y, false, false);
    } else {
      const out = session.update({ present: true, palm: isOpenPalm(world), open: isHandOpen(world), pinch: down, wristX: img[0].x, twoHands: !!other }, now);
      onSessionEvent(out.event);
      startProgress = out.startProgress;
      wipeProgress = out.wipeProgress;
      const w = w0;
      if (w) {
        const f = filter.filter(w.x, w.y, now / 1000);
        lastPen = f;
      }
      const grabbing = updateGrab(writer!, other, down, now);
      // off or grabbing: no dot, no ink. Outside what the calibration can map: treat as out of view.
      sendPen(lastPen.x, lastPen.y, !grabbing && out.penDown && !!w, !grabbing && out.visible && !!w);
    }
    drawOverlay(img, down, other?.img ?? null);
    updateReadout(true, down, settings.penGesture === 'point' ? PointDetector.score(world) : 1 - ratio / 1.2, startProgress, wipeProgress);
  } else {
    if (!calibration.active) onSessionEvent(session.update({ present: false, palm: false, open: false, pinch: false, wristX: 0 }, now).event);
    if (grab.active) updateGrab(null, null, false, now);
    // a one-frame dropout shouldn't break the stroke: say nothing during the grace period
    // (the wall holds the last state), then tell the wall the hand is gone
    diag({ k: img ? 'edge' : 'none', raw: img ? pt(penTip(img)) : null });
    if (now - lastHandAt > (penIsDown() ? HAND_LOST_WRITING_MS : HAND_LOST_MS)) handLost(now);
    drawOverlay(null, false);
    updateReadout(false, false, 0, 0, 0);
  }
}

/** Runs the two-hand grab; returns true while the writing is being held. */
function updateGrab(writer: TrackedHand | null, other: TrackedHand | null, penDown: boolean, now: number): boolean {
  let frame = { hands: 0, aOpen: false, bOpen: false, a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, penDown };
  if (session.armed && writer && other) {
    // anchor each hand at its palm centre (middle-finger knuckle), mapped onto the wall
    const pw = cameraToWall({ x: writer.img[9].x, y: writer.img[9].y }, H, settings.mirror);
    const po = cameraToWall({ x: other.img[9].x, y: other.img[9].y }, H, settings.mirror);
    if (pw && po) {
      // keep a consistent left/right order so a grab never flips half a turn
      const pairs = [
        { p: pw, open: isHandOpen(writer.world) },
        { p: po, open: isHandOpen(other.world) },
      ].sort((u, v) => u.p.x - v.p.x);
      frame = { hands: 2, aOpen: pairs[0].open, bOpen: pairs[1].open, a: pairs[0].p, b: pairs[1].p, penDown };
    }
  }
  const out = grab.update(frame, now);
  if (out.event === 'start') grabFilters.forEach((f) => f.reset());
  if (out.event === 'start' || out.event === 'move') {
    const a = grabFilters[0].filter(out.a!.x, out.a!.y, now / 1000);
    const b = grabFilters[1].filter(out.b!.x, out.b!.y, now / 1000);
    channel.send({ type: 'grab', phase: out.event, a, b });
    diag({ k: 'grab', phase: out.event, a: pt(a), b: pt(b) });
  } else if (out.event === 'end') {
    channel.send({ type: 'grab', phase: 'end' });
    diag({ k: 'grab', phase: 'end' });
  }
  if (out.event) renderStatus();
  return grab.active;
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


function drawOverlay(img: { x: number; y: number }[] | null, down: boolean, second: { x: number; y: number }[] | null = null) {
  const vw = video.videoWidth || previewSize?.w || 1280, vh = video.videoHeight || previewSize?.h || 720;
  if (overlay.width !== vw || overlay.height !== vh) {
    overlay.width = vw;
    overlay.height = vh;
  }
  octx.clearRect(0, 0, vw, vh);
  if (second) drawSkeleton(second, vw, vh, 0.45);
  if (!img) return;
  drawSkeleton(img, vw, vh, 1);
  const pen = penTip(img as Lm[]);
  octx.beginPath();
  octx.arc(pen.x * vw, pen.y * vh, down ? 14 : 9, 0, Math.PI * 2);
  octx.fillStyle = ink.pen;
  octx.shadowColor = ink.pen;
  octx.shadowBlur = down ? 24 : 8;
  octx.fill();
  octx.shadowBlur = 0;
}

/** A hand's bones and joints over the camera feed; the second hand is drawn fainter. */
function drawSkeleton(img: { x: number; y: number }[], vw: number, vh: number, alpha: number) {
  octx.save();
  octx.globalAlpha = alpha;
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
  octx.restore();
}

function onSessionEvent(event: 'start' | 'stop' | 'wipe' | undefined) {
  if (!event) return;
  if (event === 'stop' && grab.active) {
    grab.cancel();
    channel.send({ type: 'grab', phase: 'end' });
  }
  diag({ k: 'session', event });
  if (event === 'start') channel.send({ type: 'session', live: true });
  else if (event === 'stop') channel.send({ type: 'session', live: false });
  else if (event === 'wipe') channel.send({ type: 'clear' });
  renderStatus();
}

/** `penLevel` is 0..1: how clearly the pen gesture is being made (shown on the Pen gesture gauge). */
function updateReadout(hand: boolean, down: boolean, penLevel: number, startProgress: number, wipeProgress = 0) {
  live = { hand, down, start: startProgress, wipe: wipeProgress };
  renderStatus();
  $('m-pinch').style.width = `${Math.max(0, Math.min(1, penLevel)) * 100}%`;
  const mark = $('m-pinch-mark');
  mark.style.display = settings.penGesture === 'pinch' ? '' : 'none';
  mark.style.left = `${(1 - settings.pinchDown / 1.2) * 100}%`;
  $('m-start').style.width = `${Math.max(startProgress, wipeProgress) * 100}%`;
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
      updateReadout(true, down, down ? 0.9 : 0.4, 0, 0);
    },
    get settings() { return settings; },
    get homography() { return H; },
  },
});
