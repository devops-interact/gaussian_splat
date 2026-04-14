/**
 * Mid-poly measure overlay mesh from splat center world positions (docs/measure-mesh-overlay-prompt.md).
 * PCA plane fit + bbox-axis fallback; voxel downsample + planar Delaunay + long-edge cull.
 */
import * as THREE from 'three';
import Delaunator from 'delaunator';
import { ndcFromMousePos } from './splatPick';

/** Target voxel-occupancy budget (higher → denser proxy mesh, heavier Delaunay + raycast). */
export const MEASURE_OVERLAY_VOXEL_TARGET = 3000;
/** Max triangle edge vs bbox diagonal; slightly relaxed vs old 0.22 for mid-poly hole control. */
export const MEASURE_OVERLAY_MAX_EDGE_FRAC = 0.24;
/** Use PCA projection when smallest/largest eigenvalue ratio falls below this (planar-ish cloud). */
export const MEASURE_OVERLAY_PCA_PLANARITY_MAX = 0.22;

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

/** Mean-centered covariance (upper triangle + diagonal); divisor = n. */
function covariance3FromCenters(down: Float32Array): {
  mx: number;
  my: number;
  mz: number;
  c00: number;
  c01: number;
  c02: number;
  c11: number;
  c12: number;
  c22: number;
} | null {
  const n = down.length / 3;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < n; i++) {
    mx += down[i * 3];
    my += down[i * 3 + 1];
    mz += down[i * 3 + 2];
  }
  mx /= n;
  my /= n;
  mz /= n;
  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  for (let i = 0; i < n; i++) {
    const dx = down[i * 3] - mx;
    const dy = down[i * 3 + 1] - my;
    const dz = down[i * 3 + 2] - mz;
    c00 += dx * dx;
    c01 += dx * dy;
    c02 += dx * dz;
    c11 += dy * dy;
    c12 += dy * dz;
    c22 += dz * dz;
  }
  const inv = 1 / n;
  return {
    mx,
    my,
    mz,
    c00: c00 * inv,
    c01: c01 * inv,
    c02: c02 * inv,
    c11: c11 * inv,
    c12: c12 * inv,
    c22: c22 * inv,
  };
}

type Mat3 = number[][];

/** Jacobi eigen-decomposition for symmetric 3×3; returns ascending eigenvalues and column eigenvectors in `V`. */
function jacobiEigenSymmetric3(
  c00: number,
  c01: number,
  c02: number,
  c11: number,
  c12: number,
  c22: number,
): { w: [number, number, number]; V: Mat3 } {
  const A: Mat3 = [
    [c00, c01, c02],
    [c01, c11, c12],
    [c02, c12, c22],
  ];
  const V: Mat3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const n = 3;
  const tol = 1e-14;
  for (let sweep = 0; sweep < 32; sweep++) {
    let max = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = Math.abs(A[i][j]);
        if (v > max) {
          max = v;
          p = i;
          q = j;
        }
      }
    }
    if (max < tol) break;

    const app = A[p][p];
    const aqq = A[q][q];
    const apq = A[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, app - aqq);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const aip = A[i][p];
        const aiq = A[i][q];
        const nip = c * aip - s * aiq;
        const niq = s * aip + c * aiq;
        A[i][p] = A[p][i] = nip;
        A[i][q] = A[q][i] = niq;
      }
    }
    const newApp = c * c * app - 2 * c * s * apq + s * s * aqq;
    const newAqq = s * s * app + 2 * c * s * apq + c * c * aqq;
    A[p][p] = newApp;
    A[q][q] = newAqq;
    A[p][q] = A[q][p] = 0;

    for (let i = 0; i < n; i++) {
      const vip = V[i][p];
      const viq = V[i][q];
      V[i][p] = c * vip - s * viq;
      V[i][q] = s * vip + c * viq;
    }
  }

  const rawW: [number, number, number] = [A[0][0], A[1][1], A[2][2]];
  const order = [0, 1, 2].sort((a, b) => rawW[a] - rawW[b]);
  const w: [number, number, number] = [rawW[order[0]], rawW[order[1]], rawW[order[2]]];
  const Vsorted: Mat3 = [
    [V[0][order[0]], V[0][order[1]], V[0][order[2]]],
    [V[1][order[0]], V[1][order[1]], V[1][order[2]]],
    [V[2][order[0]], V[2][order[1]], V[2][order[2]]],
  ];
  return { w, V: Vsorted };
}

/** In-plane axes: eigenvectors for middle and largest eigenvalue; u = dot(p, ex), v = dot(p, ey). */
function pointsFromPcaPlane(down: Float32Array, V: Mat3, mx: number, my: number, mz: number): Pt3[] {
  const ex0 = V[0][1];
  const ex1 = V[1][1];
  const ex2 = V[2][1];
  const ey0 = V[0][2];
  const ey1 = V[1][2];
  const ey2 = V[2][2];
  const n = down.length / 3;
  const pts: Pt3[] = [];
  for (let i = 0; i < n; i++) {
    const x = down[i * 3];
    const y = down[i * 3 + 1];
    const z = down[i * 3 + 2];
    const px = x - mx;
    const py = y - my;
    const pz = z - mz;
    const u = px * ex0 + py * ex1 + pz * ex2;
    const v = px * ey0 + py * ey1 + pz * ey2;
    pts.push({ x, y, z, u, v });
  }
  return pts;
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

function geometryFromPtsAndIndices(pts: Pt3[], indices: Uint32Array): THREE.BufferGeometry {
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
  return geom;
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
  const maxEdge = Math.max(diagonal * MEASURE_OVERLAY_MAX_EDGE_FRAC, maxSpan * 1.25);
  const maxEdgeSq = maxEdge * maxEdge;

  let pts: Pt3[] | null = null;
  let indices: Uint32Array | null = null;

  const cov = covariance3FromCenters(down);
  if (cov) {
    const { w, V } = jacobiEigenSymmetric3(cov.c00, cov.c01, cov.c02, cov.c11, cov.c12, cov.c22);
    const [l0, , l2] = w;
    const planarEnough = l2 > 1e-20 && l0 / l2 < MEASURE_OVERLAY_PCA_PLANARITY_MAX;
    if (planarEnough) {
      const pcaPts = pointsFromPcaPlane(down, V, cov.mx, cov.my, cov.mz);
      const pcaIdx = triangulatePlanar(pcaPts, maxEdgeSq);
      if (pcaIdx && pcaIdx.length >= 3) {
        pts = pcaPts;
        indices = pcaIdx;
      }
    }
  }

  if (!indices || indices.length < 3) {
    const dropPrimary = dropAxisForProjection(min, max, null);
    pts = pointsFromDownsampled(down, dropPrimary);
    indices = triangulatePlanar(pts, maxEdgeSq);
  }

  if (!indices || indices.length < 3) {
    const dropPrimary = dropAxisForProjection(min, max, null);
    const dropAlt = dropAxisForProjection(min, max, dropPrimary);
    pts = pointsFromDownsampled(down, dropAlt);
    indices = triangulatePlanar(pts, maxEdgeSq);
  }

  if (!pts || !indices || indices.length < 3) {
    return {
      ok: false,
      error: 'Could not triangulate (scene may be too flat or degenerate in all projections)',
    };
  }

  const geom = geometryFromPtsAndIndices(pts, indices);
  return { ok: true, geometry: geom };
}

const OVERLAY_SCALE_MIN = 0.25;
const OVERLAY_SCALE_MAX = 10;

/**
 * Wireframe material for the measure overlay. Polygon offset is scaled by `sceneScale` so z-bias
 * stays in the same ballpark when `VITE_VIEWER_SCENE_SCALE` scales the splat (see Viewer3D).
 */
export function createMeasureOverlayWireframeMaterial(sceneScale = 1): THREE.MeshBasicMaterial {
  const s = Math.min(OVERLAY_SCALE_MAX, Math.max(OVERLAY_SCALE_MIN, sceneScale));
  const factor = -2.5 * s;
  const units = -2.5 * s;
  return new THREE.MeshBasicMaterial({
    color: 0x5a8a9a,
    wireframe: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: factor,
    polygonOffsetUnits: units,
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
