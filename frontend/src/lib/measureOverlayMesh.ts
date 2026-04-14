/**
 * Low-poly measure overlay mesh from splat center world positions (docs/measure-mesh-overlay-prompt.md).
 */
import * as THREE from 'three';
import Delaunator from 'delaunator';
import { ndcFromMousePos } from './splatPick';

export const MEASURE_OVERLAY_VOXEL_TARGET = 640;
export const MEASURE_OVERLAY_MAX_EDGE_FRAC = 0.22;

const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

export type BuildMeasureOverlayResult =
  | { ok: true; geometry: THREE.BufferGeometry }
  | { ok: false; error: string };

type Pt3 = { x: number; y: number; z: number; u: number; v: number };

function bboxFromCenters(centers: Float32Array): { min: THREE.Vector3; max: THREE.Vector3; diagonal: number } {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const n = centers.length / 3;
  for (let i = 0; i < n; i++) {
    const x = centers[i * 3];
    const y = centers[i * 3 + 1];
    const z = centers[i * 3 + 2];
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }
  const d = new THREE.Vector3().subVectors(max, min).length();
  return { min, max, diagonal: Math.max(d, 1e-6) };
}

export function voxelDownsampleCenters(centers: Float32Array, voxelTarget: number): Float32Array {
  const { min, max } = bboxFromCenters(centers);
  const dx = Math.max(max.x - min.x, 1e-6);
  const dy = Math.max(max.y - min.y, 1e-6);
  const dz = Math.max(max.z - min.z, 1e-6);
  const vol = dx * dy * dz;
  const cell = Math.cbrt(vol / Math.max(32, voxelTarget)) * 1.15;

  const map = new Map<string, number>();
  const n = centers.length / 3;
  for (let i = 0; i < n; i++) {
    const x = centers[i * 3];
    const y = centers[i * 3 + 1];
    const z = centers[i * 3 + 2];
    const ix = Math.floor((x - min.x) / cell);
    const iy = Math.floor((y - min.y) / cell);
    const iz = Math.floor((z - min.z) / cell);
    const key = `${ix},${iy},${iz}`;
    if (!map.has(key)) map.set(key, i);
  }

  const out = new Float32Array(map.size * 3);
  let o = 0;
  for (const idx of map.values()) {
    out[o++] = centers[idx * 3];
    out[o++] = centers[idx * 3 + 1];
    out[o++] = centers[idx * 3 + 2];
  }
  return out.subarray(0, o);
}

function dropAxisForProjection(min: THREE.Vector3, max: THREE.Vector3, prefer: 0 | 1 | 2 | null): 0 | 1 | 2 {
  const sx = max.x - min.x;
  const sy = max.y - min.y;
  const sz = max.z - min.z;
  const spans: [0 | 1 | 2, number][] = [
    [0, sx],
    [1, sy],
    [2, sz],
  ];
  spans.sort((a, b) => a[1] - b[1]);
  if (prefer !== null) {
    const order = spans.map((s) => s[0]);
    if (order[0] === prefer) return order[1];
    return order[0];
  }
  return spans[0][0];
}

function uvForDrop(drop: 0 | 1 | 2, x: number, y: number, z: number): [number, number] {
  switch (drop) {
    case 0:
      return [y, z];
    case 1:
      return [x, z];
    default:
      return [x, y];
  }
}

function pointsFromDownsampled(down: Float32Array, drop: 0 | 1 | 2): Pt3[] {
  const n = down.length / 3;
  const pts: Pt3[] = [];
  for (let i = 0; i < n; i++) {
    const x = down[i * 3];
    const y = down[i * 3 + 1];
    const z = down[i * 3 + 2];
    const [u, v] = uvForDrop(drop, x, y, z);
    pts.push({ x, y, z, u, v });
  }
  return pts;
}

function filterTriangles(pts: Pt3[], triangles: Uint32Array, maxEdgeSq: number): Uint32Array {
  const out: number[] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const ia = triangles[i];
    const ib = triangles[i + 1];
    const ic = triangles[i + 2];
    const a = pts[ia];
    const b = pts[ib];
    const c = pts[ic];
    const d2 = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      const dx = ax - bx;
      const dy = ay - by;
      const dz = az - bz;
      return dx * dx + dy * dy + dz * dz;
    };
    const e0 = d2(a.x, a.y, a.z, b.x, b.y, b.z);
    const e1 = d2(b.x, b.y, b.z, c.x, c.y, c.z);
    const e2 = d2(c.x, c.y, c.z, a.x, a.y, a.z);
    const m = Math.max(e0, e1, e2);
    if (m <= maxEdgeSq) out.push(ia, ib, ic);
  }
  return Uint32Array.from(out);
}

function triangulatePlanar(pts: Pt3[], maxEdgeSq: number): Uint32Array | null {
  if (pts.length < 3) return null;
  try {
    const del = Delaunator.from(pts, (p) => p.u, (p) => p.v);
    return filterTriangles(pts, del.triangles, maxEdgeSq);
  } catch {
    return null;
  }
}

export function buildMeasureOverlayFromCenters(centers: Float32Array): BuildMeasureOverlayResult {
  if (!centers || centers.length < 9) {
    return { ok: false, error: 'Need at least 3 splat centers' };
  }

  const down = voxelDownsampleCenters(centers, MEASURE_OVERLAY_VOXEL_TARGET);
  if (down.length < 9) {
    return { ok: false, error: 'Too few points after downsampling' };
  }

  const { min, max, diagonal } = bboxFromCenters(down);
  const dx = max.x - min.x;
  const dy = max.y - min.y;
  const dz = max.z - min.z;
  const maxSpan = Math.max(dx, dy, dz, 1e-6);
  // Cap long Delaunay chords (sky bridges) but never tighter than ~half the longest bbox edge
  // so small volumes (tests, tiny scans) still produce triangles.
  const maxEdge = Math.max(diagonal * MEASURE_OVERLAY_MAX_EDGE_FRAC, maxSpan * 1.25);
  const maxEdgeSq = maxEdge * maxEdge;

  const dropPrimary = dropAxisForProjection(min, max, null);
  let pts = pointsFromDownsampled(down, dropPrimary);
  let indices = triangulatePlanar(pts, maxEdgeSq);

  if (!indices || indices.length < 3) {
    const dropAlt = dropAxisForProjection(min, max, dropPrimary);
    pts = pointsFromDownsampled(down, dropAlt);
    indices = triangulatePlanar(pts, maxEdgeSq);
  }

  if (!indices || indices.length < 3) {
    return {
      ok: false,
      error: 'Could not triangulate (scene may be too flat or degenerate in all projections)',
    };
  }

  const pos = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    pos[i * 3] = pts[i].x;
    pos[i * 3 + 1] = pts[i].y;
    pos[i * 3 + 2] = pts[i].z;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  return { ok: true, geometry: geom };
}

export function createMeasureOverlayWireframeMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x5a8a9a,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2.5,
    polygonOffsetUnits: -2.5,
  });
}

export interface PickMeshSurfaceInput {
  camera: THREE.PerspectiveCamera;
  mousePos: THREE.Vector2;
  renderDims: THREE.Vector2;
  mesh: THREE.Mesh;
}

export function pickMeshSurface(input: PickMeshSurfaceInput): THREE.Vector3 | null {
  const { camera, mousePos, renderDims, mesh } = input;
  if (!mesh.visible) return null;
  camera.updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);
  const { ndcX, ndcY } = ndcFromMousePos(mousePos, renderDims);
  _ndc.set(ndcX, ndcY);
  _raycaster.setFromCamera(_ndc, camera);
  const hits = _raycaster.intersectObject(mesh, false);
  if (hits.length === 0) return null;
  return hits[0].point.clone();
}
