import { Vector3, VertexBuffer } from '@babylonjs/core';
import type { AbstractMesh, Scene } from '@babylonjs/core';

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

const OVERLAY_MESH_NAMES = new Set(['viewerGrid', 'collision_proxy']);

function isMeasurableMesh(mesh: AbstractMesh): boolean {
  return mesh.isPickable && !OVERLAY_MESH_NAMES.has(mesh.name);
}

const NEAREST_VERTEX_MAX_DIST_RATIO = 0.05;

/**
 * Find nearest vertex in world space (fallback when face indices are unavailable).
 */
export function snapToNearestVertex(
  mesh: AbstractMesh,
  worldPoint: Vector3,
  maxDistance?: number,
): Vector3 | null {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions || positions.length < 3) return null;

  const wm = mesh.getWorldMatrix();
  const bbox = mesh.getBoundingInfo().boundingBox;
  const extent = bbox.maximumWorld.subtract(bbox.minimumWorld).length();
  const maxDist = maxDistance ?? Math.max(extent * NEAREST_VERTEX_MAX_DIST_RATIO, 0.02);
  const maxDistSq = maxDist * maxDist;

  let best: Vector3 | null = null;
  let bestDistSq = maxDistSq;

  for (let i = 0; i < positions.length; i += 3) {
    const world = Vector3.TransformCoordinates(
      new Vector3(positions[i], positions[i + 1], positions[i + 2]),
      wm,
    );
    const d = Vector3.DistanceSquared(worldPoint, world);
    if (d < bestDistSq) {
      bestDistSq = d;
      best = world;
    }
  }

  return best?.clone() ?? null;
}

/**
 * Snap a world-space hit to the nearest corner of the picked triangle.
 */
export function snapToTriangleCorner(
  mesh: AbstractMesh,
  faceId: number,
  worldPoint: Vector3,
): Vector3 | null {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (!positions || !indices || faceId < 0) return null;

  const base = faceId * 3;
  if (base + 2 >= indices.length) return null;

  const wm = mesh.getWorldMatrix();
  const corners: Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const vi = indices[base + i];
    const px = positions[vi * 3];
    const py = positions[vi * 3 + 1];
    const pz = positions[vi * 3 + 2];
    corners.push(Vector3.TransformCoordinates(new Vector3(px, py, pz), wm));
  }

  let best = corners[0];
  let bestDist = Vector3.DistanceSquared(worldPoint, best);
  for (let i = 1; i < corners.length; i++) {
    const d = Vector3.DistanceSquared(worldPoint, corners[i]);
    if (d < bestDist) {
      bestDist = d;
      best = corners[i];
    }
  }
  return best.clone();
}

/**
 * Raycast against loaded mesh geometry for measurement picking.
 */
export function pickMeshSurface(
  scene: Scene,
  x: number,
  y: number,
): MeshPickResult {
  const ray = scene.createPickingRay(x, y, null, scene.activeCamera);
  if (!ray) {
    return { hit: false, point: null, mesh: null };
  }

  const hit = scene.pickWithRay(ray, (mesh) => isMeasurableMesh(mesh));
  if (hit?.hit && hit.pickedPoint && hit.pickedMesh) {
    return { hit: true, point: hit.pickedPoint.clone(), mesh: hit.pickedMesh };
  }

  return { hit: false, point: null, mesh: null };
}

export function pickMeshMeasure(
  scene: Scene,
  x: number,
  y: number,
): PickResult | null {
  const ray = scene.createPickingRay(x, y, null, scene.activeCamera);
  if (!ray) return null;

  const hit = scene.pickWithRay(ray, (mesh) => isMeasurableMesh(mesh));
  if (!hit?.hit || !hit.pickedPoint || !hit.pickedMesh) return null;

  const faceId = hit.faceId;
  let snapped: Vector3 | null = null;
  if (faceId >= 0) {
    snapped = snapToTriangleCorner(hit.pickedMesh, faceId, hit.pickedPoint);
  }
  if (!snapped) {
    snapped = snapToNearestVertex(hit.pickedMesh, hit.pickedPoint);
  }

  if (!snapped) {
    return {
      position: hit.pickedPoint.clone(),
      isSnapped: false,
      mesh: hit.pickedMesh,
    };
  }

  return {
    position: snapped,
    isSnapped: true,
    mesh: hit.pickedMesh,
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
