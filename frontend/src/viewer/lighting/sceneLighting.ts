import { DirectionalLight, HemisphericLight, Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';

export interface LightingState {
  hemiIntensity: number;
  dirIntensity: number;
  envIntensity: number;
}

const DEFAULT_LIGHTING: LightingState = {
  hemiIntensity: 0.9,
  dirIntensity: 0.65,
  envIntensity: 1,
};

/**
 * Lights + IBL for Meshy PBR GLBs. Without this, textured meshes render black.
 */
export function setupSceneLighting(scene: Scene): LightingState {
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = DEFAULT_LIGHTING.hemiIntensity;
  hemi.groundColor.set(0.15, 0.15, 0.18);
  hemi.diffuse.set(1, 1, 1);

  const dir = new DirectionalLight('dir', new Vector3(-0.8, -1.2, -0.6), scene);
  dir.intensity = DEFAULT_LIGHTING.dirIntensity;
  dir.position = new Vector3(6, 10, 6);

  // Minimal IBL so environment intensity slider has visible effect on PBR
  try {
    scene.createDefaultEnvironment({ createGround: false, enableGroundShadow: false });
  } catch {
    /* environment optional */
  }

  scene.environmentIntensity = DEFAULT_LIGHTING.envIntensity;

  if (scene.imageProcessingConfiguration) {
    scene.imageProcessingConfiguration.exposure = 1;
    scene.imageProcessingConfiguration.isEnabled = true;
  }

  return { ...DEFAULT_LIGHTING };
}

export function applyLighting(scene: Scene, state: LightingState, exposure?: number): void {
  const hemi = scene.getLightByName('hemi') as HemisphericLight | null;
  const dir = scene.getLightByName('dir') as DirectionalLight | null;
  if (hemi) hemi.intensity = state.hemiIntensity;
  if (dir) dir.intensity = state.dirIntensity;
  scene.environmentIntensity = state.envIntensity;
  if (exposure != null && scene.imageProcessingConfiguration) {
    scene.imageProcessingConfiguration.exposure = exposure;
  }
}
