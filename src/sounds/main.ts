import '../control/control.css';
import './sounds.css';
import { Sfx } from '../wall/sfx';

let sfx: Sfx | null = null;
const audio = () => (sfx ??= new Sfx(new AudioContext(), Number((document.getElementById('vol') as HTMLInputElement).value)));

document.querySelectorAll<HTMLButtonElement>('[data-sound]').forEach((b) =>
  b.addEventListener('click', () => {
    const s = audio();
    ({ start: () => s.start(), stop: () => s.stop(), wipe: () => s.wipe(), blip: () => s.blip(), chime: () => s.chime() })[
      b.dataset.sound as 'start'
    ]();
  }),
);

document.getElementById('vol')!.addEventListener('input', (e) => {
  if (sfx) sfx.volume = Number((e.target as HTMLInputElement).value);
});

Object.assign(window, { sfxForTest: () => sfx });
