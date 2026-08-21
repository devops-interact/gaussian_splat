import { Color3, StandardMaterial } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';

export const MEASURE_PICK_HINT_IDLE =
  'Move over the mesh surface — yellow preview marks the vertex you will select…';

export const MEASURE_PREVIEW_YELLOW = new Color3(1, 0.87, 0);
export const MEASURE_PREVIEW_YELLOW_LINES = new Color3(0.94, 0.77, 0.1);
export const MEASURE_PREVIEW_CONNECTOR = new Color3(1, 0.93, 0.6);
export const MEASURE_PREVIEW_RED = new Color3(1, 0.42, 0.42);

export const MEASURE_PLACED_A = new Color3(0.43, 0.72, 1);
export const MEASURE_PLACED_B = new Color3(0.18, 0.56, 1);
export const MEASURE_PLACED_LINE = new Color3(0.49, 0.78, 1);

export function makeOverlayMaterial(scene: Scene, color: Color3, alpha: number): StandardMaterial {
  const mat = new StandardMaterial('measureMat', scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color;
  mat.disableLighting = true;
  mat.alpha = alpha;
  mat.backFaceCulling = false;
  return mat;
}
