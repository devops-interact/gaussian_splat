import type { AbstractMesh, ArcRotateCamera } from '@babylonjs/core';
import { FramingBehavior } from '@babylonjs/core/Behaviors/Cameras/framingBehavior';
import { Vector3 } from '@babylonjs/core';
import { BBOX_CAM_DIST_MIN, BBOX_CAM_DIST_MULT } from '../constants';

/**
 * Apply backend first-frame pose, then native Babylon zoomOn.
 */
export function applyInitialCameraPose(
  orbitCamera: ArcRotateCamera,
  position: [number, number, number],
  lookAt: [number, number, number],
  cameraUp: [number, number, number],
): void {
  orbitCamera.upVector.set(cameraUp[0], cameraUp[1], cameraUp[2]);
  orbitCamera.setTarget(new Vector3(lookAt[0], lookAt[1], lookAt[2]));
  orbitCamera.setPosition(new Vector3(position[0], position[1], position[2]));
}

export function attachFramingBehavior(orbitCamera: ArcRotateCamera): FramingBehavior {
  orbitCamera.useFramingBehavior = true;
  const behavior = orbitCamera.framingBehavior!;
  behavior.framingTime = 0;
  behavior.radiusScale = 1;
  behavior.elevationReturnTime = -1;
  return behavior;
}

export function frameCameraOnMesh(orbitCamera: ArcRotateCamera, meshes: AbstractMesh[]): void {
  if (meshes.length === 0) return;
  orbitCamera.zoomOnFactor = 1.15;
  orbitCamera.zoomOn(meshes, false);
}

export function resetViewWithFraming(
  _orbitCamera: ArcRotateCamera,
  framingBehavior: FramingBehavior,
  rootMesh: AbstractMesh | null,
  animate = false,
): void {
  if (!rootMesh) return;
  framingBehavior.framingTime = animate ? 500 : 0;
  framingBehavior.zoomOnMeshHierarchy(rootMesh, true);
}

export function bboxFromMesh(mesh: AbstractMesh): {
  min: [number, number, number];
  max: [number, number, number];
  diagonal: number;
} {
  mesh.computeWorldMatrix(true);
  const bounds = mesh.getHierarchyBoundingVectors(true);
  const bbMin: [number, number, number] = [bounds.min.x, bounds.min.y, bounds.min.z];
  const bbMax: [number, number, number] = [bounds.max.x, bounds.max.y, bounds.max.z];
  const diagonal = Math.sqrt(
    (bbMax[0] - bbMin[0]) ** 2 + (bbMax[1] - bbMin[1]) ** 2 + (bbMax[2] - bbMin[2]) ** 2,
  );
  return { min: bbMin, max: bbMax, diagonal };
}

export function defaultBboxCameraPosition(
  diagonal: number,
  centroid: [number, number, number] = [0, 0, 0],
): {
  position: [number, number, number];
  lookAt: [number, number, number];
} {
  const camDist = Math.max(diagonal * BBOX_CAM_DIST_MULT, BBOX_CAM_DIST_MIN);
  const [cx, cy, cz] = centroid;
  return {
    position: [cx, cy + camDist * 0.45, cz + camDist * 0.85],
    lookAt: [cx, cy, cz],
  };
}

export function bboxCentroid(min: [number, number, number], max: [number, number, number]): [number, number, number] {
  return [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
}
