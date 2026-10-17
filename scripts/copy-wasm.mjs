// Copies MediaPipe's wasm runtime into public/ so the app works offline.
import { cpSync, existsSync } from 'node:fs';
const src = 'node_modules/@mediapipe/tasks-vision/wasm';
if (existsSync(src)) {
  cpSync(src, 'public/mediapipe/wasm', { recursive: true });
  console.log('copied MediaPipe wasm -> public/mediapipe/wasm');
}
