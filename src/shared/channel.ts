import type { Msg } from './types';

/** Same-origin pub/sub between the control and wall windows. */
export function openChannel(onMessage: (msg: Msg) => void) {
  const ch = new BroadcastChannel('air-writer');
  ch.onmessage = (e: MessageEvent<Msg>) => onMessage(e.data);
  return { send: (msg: Msg) => ch.postMessage(msg) };
}
