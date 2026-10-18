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
  /** Draw the heads-up display on the wall: frame, readouts, reticle, grid. */
  hud: boolean;
  /** Show the live camera with hand tracking in a corner of the wall. */
  camInset: boolean;
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
  hud: true,
  camInset: true,
};

/** One tracked hand as the wall's camera window draws it. */
export interface TrackHand {
  /** 21 landmarks in camera image space (0..1), flattened as x0, y0, x1, y1, … */
  lm: number[];
  score: number;
  writer: boolean;
  down: boolean;
}

/** What the tracker sees each frame, for the wall's heads-up display. */
export interface TrackInfo {
  hands: TrackHand[];
  /** Camera frame width / height. */
  aspect: number;
  /** The writing hand's palm, mapped onto the wall (null when out of view or unmappable). */
  palm: WallPoint | null;
  armed: boolean;
  start: number; // 0..1 while the start palm is held
  wipe: number; // 0..1 while the wipe palm is held
  fps: number;
  ms: number; // time to track one frame
  paused: boolean; // tracking paused while the laptop is in use
}

/** Messages between the control window (tracking) and the wall window (rendering). */
export type Msg =
  | { type: 'pen'; x: number; y: number; down: boolean; visible: boolean; t: number }
  | { type: 'clear' }
  | { type: 'session'; live: boolean }
  | { type: 'grab'; phase: 'start' | 'move' | 'end'; a?: WallPoint; b?: WallPoint }
  | { type: 'undo' }
  | { type: 'calib'; step: number | null; corners: WallPoint[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'hello' }
  | { type: 'key'; key: string }
  | ({ type: 'track' } & TrackInfo)
  | { type: 'camera'; deviceId: string | null; label: string };
