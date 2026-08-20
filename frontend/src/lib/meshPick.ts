import type { AbstractMesh, Scene, Vector3 } from '@babylonjs/core';

export interface PickResult {
  position: Vector3;
  isSnapped: boolean;
  mesh?: AbstractMesh | null;
}

export interface MeshPickResult {
  hit: boolean;
  point: Vector3 | null;
  mesh: AbstractMesh | null;
}

/**
 * Raycast against loaded mesh geometry for measurement picking.
 */
export function pickMeshSurface(
  scene: Scene,
  x: number,
  y: number,
  rootMesh: AbstractMesh | null,
): MeshPickResult {
  if (!rootMesh) {
    return { hit: false, point: null, mesh: null };
  }

  const ray = scene.createPickingRay(x, y, null, scene.activeCamera);
  if (!ray) {
    return { hit: false, point: null, mesh: null };
  }

  const hit = scene.pickWithRay(ray, (mesh) => mesh.isPickable && mesh !== rootMesh.parent);
  if (hit?.hit && hit.pickedPoint) {
    return { hit: true, point: hit.pickedPoint.clone(), mesh: hit.pickedMesh };
  }

  const anyHit = scene.pickWithRay(ray);
  if (anyHit?.hit && anyHit.pickedPoint) {
    return { hit: true, point: anyHit.pickedPoint.clone(), mesh: anyHit.pickedMesh };
  }

  return { hit: false, point: null, mesh: null };
}

export function pickMeshMeasure(
  scene: Scene,
  x: number,
  y: number,
  rootMesh: AbstractMesh | null,
): PickResult | null {
  const result = pickMeshSurface(scene, x, y, rootMesh);
  if (!result.hit || !result.point) return null;
  return {
    position: result.point,
    isSnapped: true,
    mesh: result.mesh,
  };
}

export function maxMeshPickDistance(bbox: {
  min: [number, number, number];
  max: [number, number, number];
}): number {
  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const dz = bbox.max[2] - bbox.min[2];
  return Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5, 0.05);
}
