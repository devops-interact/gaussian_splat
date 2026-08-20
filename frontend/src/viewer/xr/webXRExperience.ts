import type { Scene } from '@babylonjs/core';

export interface WebXRHandle {
  dispose: () => void;
}

export async function tryCreateWebXRExperience(scene: Scene): Promise<WebXRHandle | null> {
  if (typeof navigator === 'undefined' || !('xr' in navigator)) return null;
  try {
    const { WebXRDefaultExperience } = await import('@babylonjs/core/XR/webXRDefaultExperience');
    const xr = await WebXRDefaultExperience.CreateAsync(scene, {
      uiOptions: { sessionMode: 'immersive-vr', referenceSpaceType: 'local-floor' },
      optionalFeatures: true,
    });
    return {
      dispose: () => {
        try {
          xr.dispose();
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return null;
  }
}

export async function isWebXRAvailable(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('xr' in navigator)) return false;
  try {
    const xr = navigator.xr;
    if (!xr?.isSessionSupported) return false;
    return xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}
