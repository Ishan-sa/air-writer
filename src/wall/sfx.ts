/**
 * Iron Man–style sound effects, synthesized with Web Audio (no sound files,
 * so nothing to license). Works on any BaseAudioContext, which lets the
 * sounds be rendered offline for checks.
 *
 *   start    — repulsor charge: a rising whine with a click (going live)
 *   stop     — a short power-down
 *
 * Writing itself is silent on purpose.
 *   wipe     — a whoosh with a high shimmer
 *   blip     — a JARVIS-style UI blip (calibration corners)
 *   chime    — a rising three-note "done" (calibration complete)
 */
export class Sfx {
  readonly ctx: BaseAudioContext;
  private master: GainNode;
  private verbSend: GainNode;
  private noise: AudioBuffer;

  constructor(ctx: BaseAudioContext, volume = 0.7) {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = volume;
    this.master.connect(comp);

    // a small synthetic room so the sounds feel like they're in space, not in a box
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 1.6, 3.2);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.22;
    this.verbSend.connect(verb).connect(this.master);

    this.noise = noiseBuffer(ctx, 2);
  }

  set volume(v: number) {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(v, 1)), this.ctx.currentTime, 0.05);
  }

  /** Routes a voice to the dry output and a little to the reverb. */
  private out(node: AudioNode, wet = 1) {
    node.connect(this.master);
    if (wet > 0) {
      const s = this.ctx.createGain();
      s.gain.value = wet;
      node.connect(s).connect(this.verbSend);
    }
  }

  // ------------------------------------------------------------ one-shots

  start(at = this.ctx.currentTime) {
    const c = this.ctx;
    // the whine: two detuned saws sweeping up through an opening filter
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 8;
    filter.frequency.setValueAtTime(400, at);
    filter.frequency.exponentialRampToValueAtTime(5200, at + 0.22);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.28, at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.38);
    filter.connect(g);
    for (const detune of [-9, 9]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = detune;
      o.frequency.setValueAtTime(190, at);
      o.frequency.exponentialRampToValueAtTime(880, at + 0.24);
      o.connect(filter);
      o.start(at);
      o.stop(at + 0.4);
    }
    // a thin high sine riding on top
    const s = c.createOscillator();
    s.frequency.setValueAtTime(1400, at);
    s.frequency.exponentialRampToValueAtTime(2800, at + 0.2);
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, at);
    sg.gain.exponentialRampToValueAtTime(0.06, at + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
    s.connect(sg);
    s.start(at);
    s.stop(at + 0.32);
    this.out(g, 0.6);
    this.out(sg, 0.8);
    this.click(at, 0.18);
  }

  stop(at = this.ctx.currentTime) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(620, at);
    o.frequency.exponentialRampToValueAtTime(110, at + 0.2);
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    o.connect(g);
    o.start(at);
    o.stop(at + 0.24);
    this.out(g, 0.5);
  }

  wipe(at = this.ctx.currentTime) {
    const c = this.ctx;
    // whoosh: noise through a band-pass sweeping up and back down, panned across
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(350, at);
    bp.frequency.exponentialRampToValueAtTime(3200, at + 0.28);
    bp.frequency.exponentialRampToValueAtTime(700, at + 0.65);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.8, at + 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
    const pan = c.createStereoPanner();
    pan.pan.setValueAtTime(-0.7, at);
    pan.pan.linearRampToValueAtTime(0.7, at + 0.6);
    src.connect(bp).connect(g).connect(pan);
    src.start(at);
    src.stop(at + 0.72);
    this.out(pan, 0.7);
    // shimmer: a few high partials with a fast tremolo, fading out
    [2637, 3520, 4699].forEach((f, i) => {
      const o = c.createOscillator();
      o.frequency.value = f;
      const og = c.createGain();
      const t0 = at + 0.08 + i * 0.05;
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(0.035, t0 + 0.04);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      const trem = c.createOscillator();
      trem.frequency.value = 18 + i * 5;
      const tg = c.createGain();
      tg.gain.value = 0.02;
      trem.connect(tg).connect(og.gain);
      o.connect(og);
      o.start(t0);
      trem.start(t0);
      o.stop(t0 + 0.62);
      trem.stop(t0 + 0.62);
      this.out(og, 1);
    });
  }

  blip(at = this.ctx.currentTime) {
    this.tone(1320, at, 0.06, 0.5);
    this.tone(1980, at + 0.07, 0.05, 0.35);
  }

  chime(at = this.ctx.currentTime) {
    [880, 1320, 1760].forEach((f, i) => this.tone(f, at + i * 0.09, 0.35, 0.25));
  }

  private tone(freq: number, at: number, dur: number, vol: number) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    o.start(at);
    o.stop(at + dur + 0.02);
    this.out(g, 0.9);
  }

  private click(at: number, vol: number) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    src.connect(hp).connect(g);
    src.start(at, Math.random());
    src.stop(at + 0.04);
    this.out(g, 0.3);
  }
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number) {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Exponentially decaying stereo noise: a cheap, convincing reverb tail. */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number) {
  const len = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
