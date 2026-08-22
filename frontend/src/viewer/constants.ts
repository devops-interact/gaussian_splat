/** Bbox fallback camera: eye distance scales as diagonal × mult. */
export const BBOX_CAM_DIST_MULT = 0.58;
export const BBOX_CAM_DIST_MIN = 1.75;

/** Orbit dolly limits vs effective scene diagonal. */
export const ORBIT_MIN_DIST_FRAC = 0.035;
export const ORBIT_MAX_DIST_MULT = 150;

/** Orbit beta limits (radians) — prevent flipping below floor. */
export const ORBIT_BETA_MIN = 0.12;
export const ORBIT_BETA_MAX = Math.PI - 0.12;

export const MEASURE_HOVER_MIN_MS = 100;
export const MEASURE_PREVIEW_MOVE_EPS = 0.03;

export const MODEL_FETCH_TIMEOUT_MS = 120_000;
export const ADD_MESH_SCENE_TIMEOUT_MS = 90_000;

export const VIEWER_SCENE_SCALE_MIN = 0.25;
export const VIEWER_SCENE_SCALE_MAX = 10;

export const AUTO_ROTATE_ALPHA_SPEED = 0.002;

export function modelFetchAbortSignal(): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS);
  }
  return undefined;
}

import { getSceneScale } from '@/lib/viewerSettings';

export function parseViewerSceneScale(): number {
  const n = getSceneScale();
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(VIEWER_SCENE_SCALE_MIN, Math.min(VIEWER_SCENE_SCALE_MAX, n));
}
