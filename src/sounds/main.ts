import '../control/control.css';
import './sounds.css';
import { Sfx } from '../wall/sfx';

let sfx: Sfx | null = null;
const audio = () => (sfx ??= new Sfx(new AudioContext(), Number((document.getElementById('vol') as HTMLInputElement).value)));

document.querySelectorAll<HTMLButtonElement>('[data-sound]').forEach((b) =>
  b.addEventListener('click', () => {
    const s = audio();
    ({ penDown: () => s.penDown(), penUp: () => s.penUp(), wipe: () => s.wipe(), blip: () => s.blip(), chime: () => s.chime() })[
      b.dataset.sound as 'penDown'
    ]();
  }),
);

document.getElementById('vol')!.addEventListener('input', (e) => {
  if (sfx) sfx.volume = Number((e.target as HTMLInputElement).value);
});

// the pad behaves like the wall: press = pinch, drag = write, release = lift
const pad = document.getElementById('pad')!;
let last: { x: number; y: number; t: number } | null = null;
pad.addEventListener('pointerdown', (e) => {
  const s = audio();
  pad.setPointerCapture(e.pointerId);
  last = { x: e.clientX, y: e.clientY, t: performance.now() };
  s.penDown();
  s.startHum();
  pad.classList.add('down');
});
pad.addEventListener('pointermove', (e) => {
  if (!last || !sfx) return;
  const now = performance.now();
  const dt = Math.max((now - last.t) / 1000, 1e-3);
  // pad pixels → roughly wall units (the wall is ~1 unit across)
  const speed = Math.hypot(e.clientX - last.x, e.clientY - last.y) / pad.clientWidth / dt;
  sfx.writing(speed, dt);
  last = { x: e.clientX, y: e.clientY, t: now };
});
const lift = () => {
  if (!last || !sfx) return;
  sfx.stopHum();
  sfx.penUp();
  last = null;
  pad.classList.remove('down');
};
pad.addEventListener('pointerup', lift);
pad.addEventListener('pointercancel', lift);

Object.assign(window, { sfxForTest: () => sfx });
