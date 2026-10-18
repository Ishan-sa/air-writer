import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/hand_landmarker.task';

/** Loads MediaPipe's hand tracker from local files (works offline at a shoot). */
export async function createHandTracker(runningMode: 'VIDEO' | 'IMAGE' = 'VIDEO'): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' as const },
    runningMode,
    numHands: 2, // one writes; both together grab and transform the writing
    minHandDetectionConfidence: 0.5,
    // lower than the defaults so a fast, blurred hand stays tracked instead of
    // dropping to a full re-detection (which struggles with a pinched hand)
    minHandPresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
  };
  try {
    return await HandLandmarker.createFromOptions(fileset, options);
  } catch {
    // some setups can't use the GPU delegate; the CPU path is slower but works
    return HandLandmarker.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
  }
}

export { HandLandmarker, type HandLandmarkerResult };
