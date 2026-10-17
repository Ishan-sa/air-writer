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
  /** Allow the open-palm gesture to wipe the wall. */
  palmWipe: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  smoothing: 0.5,
  thickness: 1,
  sparks: 1,
  pinchDown: 0.38,
  mirror: true,
  palmWipe: true,
};

/** Messages between the control window (tracking) and the wall window (rendering). */
export type Msg =
  | { type: 'pen'; x: number; y: number; down: boolean; visible: boolean; t: number }
  | { type: 'clear' }
  | { type: 'undo' }
  | { type: 'calib'; step: number | null; corners: WallPoint[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'hello' }
  | { type: 'key'; key: string };
