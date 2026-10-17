/**
 * Dev-only diagnostics: every tracked frame is batched and posted to the Vite
 * dev server, which appends it to logs/diag.jsonl. Used to debug tracking on
 * real hardware. Does nothing in a production build.
 */
const buf: unknown[] = [];

export function diag(rec: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  buf.push({ t: Math.round(performance.now()), ...rec });
}

if (import.meta.env.DEV) {
  setInterval(() => {
    if (!buf.length) return;
    const body = buf.splice(0).map((r) => JSON.stringify(r)).join('\n') + '\n';
    fetch('/__diag', { method: 'POST', body }).catch(() => {});
  }, 1000);
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;
export const pt = (p: { x: number; y: number } | null | undefined) => (p ? [r4(p.x), r4(p.y)] : null);
export { r4 };
