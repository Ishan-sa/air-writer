import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/hand_landmarker.task';

/** Loads MediaPipe's hand tracker from local files (works offline at a shoot). */
export async function createHandTracker(runningMode: 'VIDEO' | 'IMAGE' = 'VIDEO'): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' as const },
    runningMode,
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    return await HandLandmarker.createFromOptions(fileset, options);
  } catch {
    // some setups can't use the GPU delegate; the CPU path is slower but works
    return HandLandmarker.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
  }
}

export { HandLandmarker, type HandLandmarkerResult };
