import { ArcRotateCamera, UniversalCamera, Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import { ORBIT_BETA_MAX, ORBIT_BETA_MIN, ORBIT_MAX_DIST_MULT, ORBIT_MIN_DIST_FRAC } from '../constants';

export function applyOrbitZoomLimitsFromDiagonal(orbitCam: ArcRotateCamera, effectiveDiagonal: number): void {
  if (!(effectiveDiagonal > 0)) return;
  const minD = Math.max(1e-4, effectiveDiagonal * ORBIT_MIN_DIST_FRAC);
  const maxD = Math.max(minD * 2, effectiveDiagonal * ORBIT_MAX_DIST_MULT);
  orbitCam.lowerRadiusLimit = minD;
  orbitCam.upperRadiusLimit = maxD;
}

export function configureOrbitControls(orbitCamera: ArcRotateCamera): void {
  orbitCamera.lowerBetaLimit = ORBIT_BETA_MIN;
  orbitCamera.upperBetaLimit = ORBIT_BETA_MAX;
  orbitCamera.panningAxis = new Vector3(1, 1, 0);
  orbitCamera.panningSensibility = 1000;
  orbitCamera.wheelPrecision = 3;
  orbitCamera.inertia = 0.9;
  orbitCamera.panningInertia = 0.9;
  orbitCamera.useNaturalPinchZoom = true;
  orbitCamera.zoomToMouseLocation = true;
}

export function setupCamerasFromPose(
  scene: Scene,
  canvas: HTMLCanvasElement,
  position: [number, number, number],
  lookAt: [number, number, number],
  cameraUp: [number, number, number],
  walkSpeed: number,
): { orbitCamera: ArcRotateCamera; walkCamera: UniversalCamera } {
  const target = new Vector3(lookAt[0], lookAt[1], lookAt[2]);
  const eye = new Vector3(position[0], position[1], position[2]);
  const up = new Vector3(cameraUp[0], cameraUp[1], cameraUp[2]);

  const orbitCamera = new ArcRotateCamera('orbit', -Math.PI / 2, Math.PI / 2.5, 5, target, scene);
  orbitCamera.upVector = up;
  orbitCamera.setPosition(eye);
  orbitCamera.setTarget(target);
  orbitCamera.attachControl(canvas, false);
  orbitCamera.minZ = 0.01;
  orbitCamera.maxZ = 10000;
  configureOrbitControls(orbitCamera);

  const walkCamera = new UniversalCamera('walk', eye.clone(), scene);
  walkCamera.setTarget(target);
  walkCamera.upVector = up.clone();
  walkCamera.minZ = 0.01;
  walkCamera.maxZ = 10000;
  walkCamera.speed = walkSpeed;
  walkCamera.angularSensibility = 500;
  walkCamera.inertia = 0.9;

  scene.activeCamera = orbitCamera;
  return { orbitCamera, walkCamera };
}

export function scaleCameraPairFromOrigin(
  position: [number, number, number],
  lookAt: [number, number, number],
  scale: number,
): { position: [number, number, number]; lookAt: [number, number, number] } {
  if (scale === 1) {
    return { position: [...position] as [number, number, number], lookAt: [...lookAt] as [number, number, number] };
  }
  return {
    position: [
      lookAt[0] + (position[0] - lookAt[0]) * scale,
      lookAt[1] + (position[1] - lookAt[1]) * scale,
      lookAt[2] + (position[2] - lookAt[2]) * scale,
    ],
    lookAt: [...lookAt] as [number, number, number],
  };
}
