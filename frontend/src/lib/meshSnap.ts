import { Camera, Matrix, Vector2, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';

/**
 * Vertex/edge snapping for triangle-precise measure picks on the reconstructed
 * Poisson mesh. Given a scene.pick hit (mesh + faceId + surface point), snap to
 * the nearest of: face vertex (priority), closest point on a face edge, or the
 * raw surface hit — using screen-pixel thresholds so snapping feels consistent
 * at any zoom level.
 */

export const VERTEX_SNAP_PX = 16;
export const EDGE_SNAP_PX = 12;

export type MeshSnapType = 'vertex' | 'edge' | 'face';

export interface MeshSnapResult {
  position: Vector3;
  snapType: MeshSnapType;
}

/** Screen-pixel distance between a world point and the cursor (NDC in, px out). */
function screenDistPx(
  viewProj: Matrix,
  world: Vector3,
  ndcX: number,
  ndcY: number,
  renderDims: Vector2,
): number {
  const clip = Vector3.TransformCoordinates(world, viewProj);
  if (clip.z < 0 || clip.z > 1) return Infinity;
  const dxPx = ((clip.x - ndcX) * renderDims.x) / 2;
  const dyPx = ((clip.y - ndcY) * renderDims.y) / 2;
  return Math.hypot(dxPx, dyPx);
}

/** Closest point to `p` on segment [a, b] (world space). */
export function closestPointOnSegment(a: Vector3, b: Vector3, p: Vector3): Vector3 {
  const ab = b.subtract(a);
  const abLenSq = ab.lengthSquared();
  if (abLenSq < 1e-12) return a.clone();
  const t = Math.max(0, Math.min(1, Vector3.Dot(p.subtract(a), ab) / abLenSq));
  return a.add(ab.scale(t));
}

/** World positions of the 3 vertices of `faceId` on `mesh`, or null if unavailable. */
export function faceWorldVertices(mesh: AbstractMesh, faceId: number): [Vector3, Vector3, Vector3] | null {
  const indices = mesh.getIndices();
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!indices || !positions) return null;
  const base = faceId * 3;
  if (base + 2 >= indices.length) return null;
  const matWorld = mesh.getWorldMatrix();
  const out: Vector3[] = [];
  for (let k = 0; k < 3; k++) {
    const vi = indices[base + k] * 3;
    out.push(
      Vector3.TransformCoordinates(
        new Vector3(positions[vi], positions[vi + 1], positions[vi + 2]),
        matWorld,
      ),
    );
  }
  return out as [Vector3, Vector3, Vector3];
}

/**
 * Snap a triangle hit to vertex > edge > face, whichever qualifies within its
 * screen-px threshold. Falls back to the raw surface hit.
 */
export function snapPickToMeshFeature(
  mesh: AbstractMesh,
  faceId: number,
  pickedPoint: Vector3,
  camera: Camera,
  ndcX: number,
  ndcY: number,
  renderDims: Vector2,
): MeshSnapResult {
  const verts = faceWorldVertices(mesh, faceId);
  if (!verts) return { position: pickedPoint.clone(), snapType: 'face' };

  const viewProj = camera.getTransformationMatrix();

  let bestVertex: Vector3 | null = null;
  let bestVertexPx = VERTEX_SNAP_PX;
  for (const v of verts) {
    const d = screenDistPx(viewProj, v, ndcX, ndcY, renderDims);
    if (d <= bestVertexPx) {
      bestVertexPx = d;
      bestVertex = v;
    }
  }
  if (bestVertex) return { position: bestVertex.clone(), snapType: 'vertex' };

  let bestEdgePoint: Vector3 | null = null;
  let bestEdgePx = EDGE_SNAP_PX;
  const edges: [Vector3, Vector3][] = [
    [verts[0], verts[1]],
    [verts[1], verts[2]],
    [verts[2], verts[0]],
  ];
  for (const [a, b] of edges) {
    const p = closestPointOnSegment(a, b, pickedPoint);
    const d = screenDistPx(viewProj, p, ndcX, ndcY, renderDims);
    if (d <= bestEdgePx) {
      bestEdgePx = d;
      bestEdgePoint = p;
    }
  }
  if (bestEdgePoint) return { position: bestEdgePoint, snapType: 'edge' };

  return { position: pickedPoint.clone(), snapType: 'face' };
}
