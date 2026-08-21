import { DirectionalLight, HemisphericLight, Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';

/**
 * Lights + IBL for Meshy PBR GLBs. Without this, textured meshes render black.
 */
export function setupSceneLighting(scene: Scene): void {
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.9;
  hemi.groundColor.set(0.15, 0.15, 0.18);
  hemi.diffuse.set(1, 1, 1);

  const dir = new DirectionalLight('dir', new Vector3(-0.8, -1.2, -0.6), scene);
  dir.intensity = 0.65;
  dir.position = new Vector3(6, 10, 6);

  scene.environmentIntensity = 1;
}
