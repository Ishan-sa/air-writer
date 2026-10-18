/** A point in wall space: 0..1 across the projected image, (0,0) top-left. */
export interface WallPoint {
  x: number;
  y: number;
}

export interface Settings {
  /** 0 = raw, 1 = heaviest smoothing. */
  smoothing: number;
  /** Ink line width multiplier. */
  thickness: number;
  /** Spark amount multiplier (0 turns sparks off). */
  sparks: number;
  /** Pinch distance (as a fraction of hand size) below which the pen goes down. */
  pinchDown: number;
  /** Flip the camera image horizontally before mapping (only matters without calibration). */
  mirror: boolean;
  /** Allow a sideways swipe of an open hand to wipe the wall. */
  swipeWipe: boolean;
  /** Sound effects volume, 0 (off) to 1. */
  sfx: number;
  /** What puts the pen down: pointing the index finger, or pinching. */
  penGesture: 'point' | 'pinch';
}

export const DEFAULT_SETTINGS: Settings = {
  smoothing: 0.5,
  thickness: 1,
  sparks: 1,
  pinchDown: 0.38,
  mirror: true,
  swipeWipe: true,
  sfx: 0.7,
  penGesture: 'point',
};

/** Messages between the control window (tracking) and the wall window (rendering). */
export type Msg =
  | { type: 'pen'; x: number; y: number; down: boolean; visible: boolean; t: number }
  | { type: 'clear' }
  | { type: 'session'; live: boolean }
  | { type: 'undo' }
  | { type: 'calib'; step: number | null; corners: WallPoint[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'hello' }
  | { type: 'key'; key: string };
