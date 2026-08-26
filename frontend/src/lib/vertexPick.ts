import { Matrix, Vector3 } from '@babylonjs/core';
import type { AbstractMesh, Scene } from '@babylonjs/core';
import type { PickResult } from './meshPick';
import { getTriangleWorldVertices, snapToTriangleCorner } from './meshPick';

const OVERLAY_MESH_NAMES = new Set(['viewerGrid', 'collision_proxy']);
const DEFAULT_SCREEN_THRESHOLD_PX = 24;

function isMeasurableMesh(mesh: AbstractMesh): boolean {
  return mesh.isEnabled() && mesh.isPickable && !OVERLAY_MESH_NAMES.has(mesh.name);
}

function projectWorldToCanvas(scene: Scene, world: Vector3): { x: number; y: number } | null {
  const camera = scene.activeCamera;
  const engine = scene.getEngine();
  if (!camera) return null;

  const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const projected = Vector3.Project(
    world,
    Matrix.IdentityReadOnly,
    scene.getTransformMatrix(),
    viewport,
  );
  if (projected.z < 0 || projected.z > 1) return null;
  return { x: projected.x, y: projected.y };
}

function resolveFaceId(mesh: AbstractMesh, faceId: number, worldPoint: Vector3): number {
  if (faceId >= 0) return faceId;
  const facetId = mesh.getClosestFacetAtCoordinates(worldPoint.x, worldPoint.y, worldPoint.z);
  return facetId ?? -1;
}

function pickNearestVertexOnScreen(
  scene: Scene,
  canvasX: number,
  canvasY: number,
  candidates: Vector3[],
  thresholdPx: number,
): Vector3 | null {
  const thresholdSq = thresholdPx * thresholdPx;
  let best: Vector3 | null = null;
  let bestDistSq = thresholdSq;

  for (const vertex of candidates) {
    const projected = projectWorldToCanvas(scene, vertex);
    if (!projected) continue;
    const dx = projected.x - canvasX;
    const dy = projected.y - canvasY;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = vertex;
    }
  }

  return best;
}

/**
 * Raycast + screen-space snap to the nearest triangle vertex under the cursor.
 *
 * @param cssX - CSS canvas coords for createPickingRay (Babylon pointer space)
 * @param cssY - CSS canvas coords for createPickingRay
 * @param bufferX - render-buffer coords for Vector3.Project screen snap
 * @param bufferY - render-buffer coords for screen snap
 */
export function pickMeshMeasureVertex(
  scene: Scene,
  cssX: number,
  cssY: number,
  bufferX: number,
  bufferY: number,
  screenThresholdPx = DEFAULT_SCREEN_THRESHOLD_PX,
): PickResult | null {
  const ray = scene.createPickingRay(cssX, cssY, null, scene.activeCamera);
  if (!ray) return null;

  const hit = scene.pickWithRay(ray, (mesh) => isMeasurableMesh(mesh), false);
  if (!hit?.hit || !hit.pickedPoint || !hit.pickedMesh) return null;

  const mesh = hit.pickedMesh;
  const normal = typeof hit.getNormal === 'function' ? hit.getNormal(true)?.clone() ?? null : null;
  const faceId = resolveFaceId(mesh, hit.faceId, hit.pickedPoint);
  const triangleVerts = getTriangleWorldVertices(mesh, faceId);

  if (!triangleVerts || triangleVerts.length !== 3) {
    return {
      position: hit.pickedPoint.clone(),
      isSnapped: false,
      mesh,
      normal,
      triangleVerts: null,
    };
  }

  const screenVertex = pickNearestVertexOnScreen(
    scene,
    bufferX,
    bufferY,
    triangleVerts,
    screenThresholdPx,
  );

  if (screenVertex) {
    return {
      position: screenVertex.clone(),
      isSnapped: true,
      mesh,
      normal,
      triangleVerts,
    };
  }

  const corner = snapToTriangleCorner(mesh, faceId, hit.pickedPoint);
  return {
    position: (corner ?? hit.pickedPoint).clone(),
    isSnapped: corner !== null,
    mesh,
    normal,
    triangleVerts,
  };
}

export { DEFAULT_SCREEN_THRESHOLD_PX };
