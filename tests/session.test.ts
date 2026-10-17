import { describe, expect, it } from 'vitest';
import { WriteSession, type HandFrame } from '../src/tracking/session';

const FRAME = 33; // ms, ~30 fps camera

/** A tracked hand doing nothing in particular: relaxed, not a palm, not pinching. */
const idle = (x = 0.5): HandFrame => ({ present: true, palm: false, open: false, pinch: false, wristX: x });
const palm = (x = 0.5): HandFrame => ({ present: true, palm: true, open: true, pinch: false, wristX: x });
const pinch = (x = 0.5): HandFrame => ({ present: true, palm: false, open: false, pinch: true, wristX: x });
const gone: HandFrame = { present: false, palm: false, open: false, pinch: false, wristX: 0 };

/** Feeds frames at camera rate starting at t0; returns every output and the end time. */
function run(s: WriteSession, frames: HandFrame[], t0 = 0) {
  const out = frames.map((f, i) => s.update(f, t0 + i * FRAME));
  return { out, t: t0 + frames.length * FRAME };
}
const repeat = (f: HandFrame, ms: number) => Array.from({ length: Math.ceil(ms / FRAME) }, () => f);

describe('writing session', () => {
  it('a hand that just appears does nothing: no dot, no ink', () => {
    const s = new WriteSession();
    const { out } = run(s, [...repeat(idle(), 1000), ...repeat(pinch(), 1000)]);
    expect(out.every((o) => !o.visible && !o.penDown)).toBe(true);
    expect(s.armed).toBe(false);
  });

  it('holding an open palm for half a second starts it, once', () => {
    const s = new WriteSession();
    const { out } = run(s, repeat(palm(), 800));
    expect(out.filter((o) => o.event === 'start')).toHaveLength(1);
    expect(s.armed).toBe(true);
    expect(out.at(-1)!.visible).toBe(true);
  });

  it('a brief flash of an open palm does not start it', () => {
    const s = new WriteSession();
    run(s, [...repeat(palm(), 200), ...repeat(idle(), 500)]);
    expect(s.armed).toBe(false);
  });

  it('after starting, pinch writes and opening lifts', () => {
    const s = new WriteSession();
    let { t } = run(s, repeat(palm(), 700));
    const writing = run(s, repeat(pinch(), 300), t);
    expect(writing.out.at(-1)!.penDown).toBe(true);
    const lifted = run(s, repeat(idle(), 100), writing.t);
    expect(lifted.out.at(-1)!.penDown).toBe(false);
    expect(lifted.out.at(-1)!.visible).toBe(true);
  });

  it('lowering the hand out of view for a second stops it', () => {
    const s = new WriteSession();
    let { t } = run(s, repeat(palm(), 700));
    const { out } = run(s, repeat(gone, 1300), t);
    expect(out.filter((o) => o.event === 'stop')).toHaveLength(1);
    expect(s.armed).toBe(false);
  });

  it('a short tracking dropout while writing does not stop it', () => {
    const s = new WriteSession();
    let { t } = run(s, repeat(palm(), 700));
    ({ t } = run(s, repeat(pinch(), 300), t));
    ({ t } = run(s, repeat(gone, 300), t));
    expect(s.armed).toBe(true);
  });

  it('swiping an open hand sideways wipes, once per swipe', () => {
    const s = new WriteSession();
    let { t } = run(s, repeat(palm(), 700));
    ({ t } = run(s, repeat(idle(), 800), t)); // settle after starting
    // open hand moving 0.35 of the frame in ~250 ms
    const swipe = Array.from({ length: 8 }, (_, i) => ({ ...palm(0.3 + i * 0.05), palm: false }));
    const { out } = run(s, swipe, t);
    expect(out.filter((o) => o.event === 'wipe')).toHaveLength(1);
  });

  it('moving a pinched or relaxed hand quickly is not a wipe', () => {
    const s = new WriteSession();
    let { t } = run(s, repeat(palm(), 700));
    ({ t } = run(s, repeat(idle(), 800), t));
    const fastPinch = Array.from({ length: 8 }, (_, i) => pinch(0.3 + i * 0.05));
    const fastRelaxed = Array.from({ length: 8 }, (_, i) => idle(0.7 - i * 0.05));
    const a = run(s, fastPinch, t);
    const b = run(s, fastRelaxed, a.t);
    expect([...a.out, ...b.out].some((o) => o.event === 'wipe')).toBe(false);
  });

  it('a slow sideways drift with an open hand is not a wipe', () => {
    const s = new WriteSession();
    let { t } = run(s, repeat(palm(), 700));
    ({ t } = run(s, repeat(idle(), 800), t));
    const drift = Array.from({ length: 60 }, (_, i) => ({ ...palm(0.3 + i * 0.006), palm: false })); // 0.36 over 2 s
    const { out } = run(s, drift, t);
    expect(out.some((o) => o.event === 'wipe')).toBe(false);
  });

  it('does not wipe from the palm movement that started it', () => {
    const s = new WriteSession();
    // raising the palm into place while it arms, then moving it right away
    const raise = Array.from({ length: 24 }, (_, i) => palm(0.3 + Math.min(i, 20) * 0.02));
    const { out } = run(s, raise);
    expect(out.some((o) => o.event === 'wipe')).toBe(false);
  });

  it('a pinch held from before starting does not write until released', () => {
    const s = new WriteSession();
    let { t } = run(s, repeat(palm(), 700));
    s.requireRelease();
    const held = run(s, repeat(pinch(), 300), t);
    expect(held.out.every((o) => !o.penDown)).toBe(true);
    const again = run(s, [...repeat(idle(), 100), ...repeat(pinch(), 100)], held.t);
    expect(again.out.at(-1)!.penDown).toBe(true);
  });

  it('reports how far along the start hold is', () => {
    const s = new WriteSession();
    const { out } = run(s, repeat(palm(), 300));
    const p = out.at(-1)!.startProgress;
    expect(p).toBeGreaterThan(0.4);
    expect(p).toBeLessThan(1);
  });
});
