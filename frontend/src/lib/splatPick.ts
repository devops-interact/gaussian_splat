import {
  Camera,
  Matrix,
  Plane,
  Ray,
  Scene,
  Vector2,
  Vector3,
} from '@babylonjs/core';
import type { GaussianSplattingMesh } from '@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMesh';

/** Scene-scale max ray distance for accepting a splat hit (axis-aligned bbox diagonal). */
export function maxSplatPickDistance(bbox: {
  min: [number, number, number];
  max: [number, number, number];
}): number {
  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const dz = bbox.max[2] - bbox.min[2];
  const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Math.max(diagonal * 4, 3);
}

// Screen-space pick cone in physical pixels. 12 physical px ≈ 4 CSS px on Retina,
// which is too tight. 28 physical px ≈ 9 CSS px at DPR=3 — comfortable for finger / mouse.
export const PICK_RADIUS_PX = 22;

/** Cap for size-aware acceptance: huge splats never grab picks farther than this. */
export const PICK_RADIUS_MAX_PX = 64;

/** Depth-cluster window along the ray as a fraction of maxDist (see pick scoring). */
export const PICK_DEPTH_WINDOW_FRAC = 0.005;

/** Build uniform grid over centers when count exceeds this (plan: large-PLY acceleration). */
export const CENTER_GRID_MIN_SPLATS = 50_000;

/** Splats with alpha below this (0-255) are excluded from the pick center cache. */
export const PICK_CENTER_ALPHA_FLOOR = 55;

const SPLAT_ROW_BYTES = 32;
const SPLAT_FLOATS = 8;
/** .splat row layout: pos f32×3 (floats 0-2), scale f32×3 (floats 3-5), RGBA u8×4, quat u8×4. */
const SPLAT_SCALE_FLOAT_OFFSET = 3;
const SPLAT_ALPHA_BYTE_OFFSET = 27;

export type SplatMeshWithCenters = Pick<
  GaussianSplattingMesh,
  'splatsData' | 'getWorldMatrix' | 'computeWorldMatrix'
>;

export interface PickResult {
  position: Vector3;
  isSnapped: boolean;
  /** Set when the pick resolved to a splat world center (cone / center-cache path). */
  splatCenterIndex?: number;
}

/** Uniform axis-aligned grid: ~equal cells per axis, variable cell size per axis. */
export interface SplatCenterGridAccel {
  minX: number;
  minY: number;
  minZ: number;
  cellSizeX: number;
  cellSizeY: number;
  cellSizeZ: number;
  nx: number;
  ny: number;
  nz: number;
  /** flat: ix + nx * (iy + ny * iz) */
  buckets: number[][];
  /** Per-cell visit stamps (generation counter) for traversal dedupe; internal. */
  cellStamp: Int32Array;
  /** Current stamp generation; internal. */
  stampGen: number;
}

const _vProj = new Vector3();
const _clip = new Vector3();
const _oc = new Vector3();
/** Reusable candidate index list for grid traversal (module-scoped, single-threaded). */
const _gridCandidates: number[] = [];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export interface SplatCenterCache {
  /** Compacted world-space xyz per kept splat. */
  positions: Float32Array;
  /** World-space max-axis Gaussian scale per kept splat (linear .splat scale × mesh scale). */
  radii: Float32Array;
}

/**
 * Read world-space splat centers + sizes from Babylon GaussianSplattingMesh.splatsData
 * (32 B / splat). Splats with alpha below `alphaFloor` (0-255) are skipped so measure
 * picks never snap to near-invisible floaters; buffers are compacted (indices are
 * cache-local).
 */
export function buildSplatCenterWorldCache(
  splatMesh: SplatMeshWithCenters,
  alphaFloor: number = PICK_CENTER_ALPHA_FLOOR,
): SplatCenterCache | null {
  const data = splatMesh.splatsData;
  if (!data || data.byteLength < SPLAT_ROW_BYTES) return null;

  const n = Math.floor(data.byteLength / SPLAT_ROW_BYTES);
  if (n <= 0) return null;

  splatMesh.computeWorldMatrix(true);
  const matWorld = splatMesh.getWorldMatrix();
  // Uniform mesh scale from the world matrix basis (rotation preserves row length).
  const m = matWorld.m;
  const worldScale = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]) || 1;
  const fBuffer = new Float32Array(data);
  const uBuffer = new Uint8Array(data);
  const buf = new Float32Array(n * 3);
  const rad = new Float32Array(n);
  const p = new Vector3();

  let kept = 0;
  for (let i = 0; i < n; i++) {
    if (uBuffer[i * SPLAT_ROW_BYTES + SPLAT_ALPHA_BYTE_OFFSET] < alphaFloor) continue;
    const base = i * SPLAT_FLOATS;
    p.set(fBuffer[base], fBuffer[base + 1], fBuffer[base + 2]);
    Vector3.TransformCoordinatesToRef(p, matWorld, p);
    buf[kept * 3] = p.x;
    buf[kept * 3 + 1] = p.y;
    buf[kept * 3 + 2] = p.z;
    const s0 = Math.abs(fBuffer[base + SPLAT_SCALE_FLOAT_OFFSET]);
    const s1 = Math.abs(fBuffer[base + SPLAT_SCALE_FLOAT_OFFSET + 1]);
    const s2 = Math.abs(fBuffer[base + SPLAT_SCALE_FLOAT_OFFSET + 2]);
    rad[kept] = Math.max(s0, s1, s2) * worldScale;
    kept++;
  }

  // Fall back to no alpha filtering if the floor would leave nothing pickable.
  if (kept === 0 && alphaFloor > 0) {
    return buildSplatCenterWorldCache(splatMesh, 0);
  }
  if (kept === 0) return null;

  const positions = kept === n ? buf : buf.slice(0, kept * 3);
  const radii = kept === n ? rad : rad.slice(0, kept);
  console.log(
    `[splatPick] center cache built: ${kept}/${n} splats (alphaFloor=${alphaFloor}), sample[0]: (${positions[0].toFixed(3)}, ${positions[1].toFixed(3)}, ${positions[2].toFixed(3)})`,
  );

  return { positions, radii };
}

/**
 * Spatial index over splat centers for large scenes. Returns null when splat count is small.
 */
export function buildCenterGridAcceleration(centers: Float32Array): SplatCenterGridAccel | null {
  const n = centers.length / 3;
  if (n <= CENTER_GRID_MIN_SPLATS) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = centers[i * 3];
    const y = centers[i * 3 + 1];
    const z = centers[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const dx = Math.max(maxX - minX, 1e-6);
  const dy = Math.max(maxY - minY, 1e-6);
  const dz = Math.max(maxZ - minZ, 1e-6);

  const dim = Math.min(128, Math.max(16, Math.ceil(Math.cbrt(n / 32))));
  const nx = dim;
  const ny = dim;
  const nz = dim;
  const cellSizeX = dx / nx;
  const cellSizeY = dy / ny;
  const cellSizeZ = dz / nz;

  const numCells = nx * ny * nz;
  const buckets: number[][] = new Array(numCells);
  for (let c = 0; c < numCells; c++) buckets[c] = [];

  for (let i = 0; i < n; i++) {
    const x = centers[i * 3];
    const y = centers[i * 3 + 1];
    const z = centers[i * 3 + 2];
    const ix = clamp(Math.floor((x - minX) / cellSizeX), 0, nx - 1);
    const iy = clamp(Math.floor((y - minY) / cellSizeY), 0, ny - 1);
    const iz = clamp(Math.floor((z - minZ) / cellSizeZ), 0, nz - 1);
    const flat = ix + nx * (iy + ny * iz);
    buckets[flat].push(i);
  }

  return {
    minX,
    minY,
    minZ,
    cellSizeX,
    cellSizeY,
    cellSizeZ,
    nx,
    ny,
    nz,
    buckets,
    cellStamp: new Int32Array(numCells),
    stampGen: 0,
  };
}

export function ndcFromMousePos(
  mousePos: Vector2,
  renderDims: Vector2,
): { ndcX: number; ndcY: number } {
  const w = Math.max(1e-6, renderDims.x);
  const h = Math.max(1e-6, renderDims.y);
  return {
    ndcX: (mousePos.x / w) * 2 - 1,
    ndcY: -(mousePos.y / h) * 2 + 1,
  };
}

export function worldRayFromCameraScreen(
  scene: Scene,
  camera: Camera,
  mousePos: Vector2,
): Ray {
  return scene.createPickingRay(mousePos.x, mousePos.y, Matrix.Identity(), camera, false);
}

/** Project world position to NDC via a cached view-projection matrix; writes into `out`. */
function projectWorldToNdcRef(viewProj: Matrix, worldPos: Vector3, out: Vector3): boolean {
  Vector3.TransformCoordinatesToRef(worldPos, viewProj, out);
  return out.z >= 0 && out.z <= 1;
}

function flatCellIndex(
  grid: SplatCenterGridAccel,
  ix: number,
  iy: number,
  iz: number,
): number {
  return ix + grid.nx * (iy + grid.ny * iz);
}

/** Ray vs axis-aligned box [min, max]; returns [tEnter, tExit] or null if miss. */
function rayAabbSlab(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): { t0: number; t1: number } | null {
  let t0 = 0;
  let t1 = Infinity;
  const axes = [
    { o: ox, d: dx, min: minX, max: maxX },
    { o: oy, d: dy, min: minY, max: maxY },
    { o: oz, d: dz, min: minZ, max: maxZ },
  ];
  for (const a of axes) {
    if (Math.abs(a.d) < 1e-12) {
      if (a.o < a.min || a.o > a.max) return null;
      continue;
    }
    const inv = 1 / a.d;
    let tNear = (a.min - a.o) * inv;
    let tFar = (a.max - a.o) * inv;
    if (tNear > tFar) {
      const s = tNear;
      tNear = tFar;
      tFar = s;
    }
    t0 = Math.max(t0, tNear);
    t1 = Math.min(t1, tFar);
    if (t0 > t1) return null;
  }
  return { t0, t1 };
}

/**
 * Emit splat indices from a cell's 3x3x3 neighborhood into `out`, deduped by cell stamps.
 * The 1-cell dilation makes the traversal cover the screen-space pick cone so no
 * full-scan fallback is needed when the ray itself misses populated cells.
 */
function emitCellNeighborhood(
  grid: SplatCenterGridAccel,
  ix: number,
  iy: number,
  iz: number,
  out: number[],
): void {
  for (let dz = -1; dz <= 1; dz++) {
    const z = iz + dz;
    if (z < 0 || z >= grid.nz) continue;
    for (let dy = -1; dy <= 1; dy++) {
      const y = iy + dy;
      if (y < 0 || y >= grid.ny) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const x = ix + dx;
        if (x < 0 || x >= grid.nx) continue;
        const fi = flatCellIndex(grid, x, y, z);
        if (grid.cellStamp[fi] === grid.stampGen) continue;
        grid.cellStamp[fi] = grid.stampGen;
        const bucket = grid.buckets[fi];
        for (let b = 0; b < bucket.length; b++) out.push(bucket[b]);
      }
    }
  }
}

/**
 * Collect splat indices whose grid cells the ray traverses (Amanatides & Woo style, t from ray origin),
 * dilated by one neighbor ring per visited cell. Indices are unique (cell-stamp dedupe).
 */
export function collectGridCandidatesAlongRay(
  grid: SplatCenterGridAccel,
  O: Vector3,
  D: Vector3,
  tRayMax: number,
  out: number[],
): void {
  grid.stampGen++;
  if (grid.stampGen >= 0x7fffffff) {
    grid.cellStamp.fill(0);
    grid.stampGen = 1;
  }

  const maxGX = grid.minX + grid.nx * grid.cellSizeX;
  const maxGY = grid.minY + grid.ny * grid.cellSizeY;
  const maxGZ = grid.minZ + grid.nz * grid.cellSizeZ;

  // Pad the bounds by one cell so rays that graze the grid border (within the
  // screen-space pick cone of border splats) still start a traversal; the 1-ring
  // dilation covers the border cells from the clamped lattice position.
  const slab = rayAabbSlab(
    O.x,
    O.y,
    O.z,
    D.x,
    D.y,
    D.z,
    grid.minX - grid.cellSizeX,
    grid.minY - grid.cellSizeY,
    grid.minZ - grid.cellSizeZ,
    maxGX + grid.cellSizeX,
    maxGY + grid.cellSizeY,
    maxGZ + grid.cellSizeZ,
  );
  if (!slab) return;

  const t0 = Math.max(0, slab.t0);
  const t1 = Math.min(tRayMax, slab.t1);
  if (t0 > t1) return;

  const px = O.x + D.x * t0;
  const py = O.y + D.y * t0;
  const pz = O.z + D.z * t0;

  let ix = clamp(Math.floor((px - grid.minX) / grid.cellSizeX), 0, grid.nx - 1);
  let iy = clamp(Math.floor((py - grid.minY) / grid.cellSizeY), 0, grid.ny - 1);
  let iz = clamp(Math.floor((pz - grid.minZ) / grid.cellSizeZ), 0, grid.nz - 1);

  // Quantize near-zero direction components: if the ray moves less than half a cell
  // along an axis over the clipped segment, don't step on that axis (the neighbor-ring
  // dilation absorbs the sub-cell drift). Prevents boundary-grazing rays from being
  // stepped out of the lattice immediately.
  const span = t1 - t0;
  const Dx = Math.abs(D.x) * span < grid.cellSizeX * 0.5 ? 0 : D.x;
  const Dy = Math.abs(D.y) * span < grid.cellSizeY * 0.5 ? 0 : D.y;
  const Dz = Math.abs(D.z) * span < grid.cellSizeZ * 0.5 ? 0 : D.z;

  const stepX = Dx > 0 ? 1 : Dx < 0 ? -1 : 0;
  const stepY = Dy > 0 ? 1 : Dy < 0 ? -1 : 0;
  const stepZ = Dz > 0 ? 1 : Dz < 0 ? -1 : 0;

  const tDeltaX = Dx !== 0 ? grid.cellSizeX / Math.abs(Dx) : Infinity;
  const tDeltaY = Dy !== 0 ? grid.cellSizeY / Math.abs(Dy) : Infinity;
  const tDeltaZ = Dz !== 0 ? grid.cellSizeZ / Math.abs(Dz) : Infinity;

  let tMaxX: number;
  let tMaxY: number;
  let tMaxZ: number;
  if (stepX > 0) {
    tMaxX = (grid.minX + (ix + 1) * grid.cellSizeX - O.x) / Dx;
  } else if (stepX < 0) {
    tMaxX = (grid.minX + ix * grid.cellSizeX - O.x) / Dx;
  } else {
    tMaxX = Infinity;
  }
  if (stepY > 0) {
    tMaxY = (grid.minY + (iy + 1) * grid.cellSizeY - O.y) / Dy;
  } else if (stepY < 0) {
    tMaxY = (grid.minY + iy * grid.cellSizeY - O.y) / Dy;
  } else {
    tMaxY = Infinity;
  }
  if (stepZ > 0) {
    tMaxZ = (grid.minZ + (iz + 1) * grid.cellSizeZ - O.z) / Dz;
  } else if (stepZ < 0) {
    tMaxZ = (grid.minZ + iz * grid.cellSizeZ - O.z) / Dz;
  } else {
    tMaxZ = Infinity;
  }

  while (tMaxX < t0) {
    tMaxX += tDeltaX;
    ix += stepX;
    if (ix < 0 || ix >= grid.nx) return;
  }
  while (tMaxY < t0) {
    tMaxY += tDeltaY;
    iy += stepY;
    if (iy < 0 || iy >= grid.ny) return;
  }
  while (tMaxZ < t0) {
    tMaxZ += tDeltaZ;
    iz += stepZ;
    if (iz < 0 || iz >= grid.nz) return;
  }

  const maxSteps = 3 * (grid.nx + grid.ny + grid.nz) + 64;
  let steps = 0;

  while (steps < maxSteps) {
    steps++;
    emitCellNeighborhood(grid, ix, iy, iz, out);

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      if (tMaxX > t1) break;
      ix += stepX;
      if (ix < 0 || ix >= grid.nx) break;
      tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      if (tMaxY > t1) break;
      iy += stepY;
      if (iy < 0 || iy >= grid.ny) break;
      tMaxY += tDeltaY;
    } else {
      if (tMaxZ > t1) break;
      iz += stepZ;
      if (iz < 0 || iz >= grid.nz) break;
      tMaxZ += tDeltaZ;
    }
  }
}

export type NearestSplatCenterHit = { position: Vector3; splatIndex: number };

/** Reusable accepted-candidate scratch (module-scoped, single-threaded). */
const _candIdx: number[] = [];
const _candT: number[] = [];

/**
 * Splat pick within the screen cone:
 * 1. Accept candidates whose screen distance to the cursor is within
 *    `max(PICK_RADIUS_PX, projected splat radius px)` (capped at PICK_RADIUS_MAX_PX).
 * 2. Return the **front-most** candidate (smallest ray parameter t), with the hit
 *    pulled toward the camera by one splat radius when radii are available (surface
 *    approximation instead of the ellipsoid center).
 */
export function pickNearestCenterConeAlongRay(
  camera: Camera,
  rayOrigin: Vector3,
  rayDirection: Vector3,
  ndcX: number,
  ndcY: number,
  centers: Float32Array,
  renderDims: Vector2,
  maxDistAlongRay: number,
  grid: SplatCenterGridAccel | null,
  radii?: Float32Array | null,
): NearestSplatCenterHit | null {
  const shortAxis = Math.max(1, Math.min(renderDims.x, renderDims.y));
  const ndcTolPerPx = 2 / shortAxis;
  const baseNdcTolSq = (PICK_RADIUS_PX * ndcTolPerPx) ** 2;
  const maxNdcTolSq = (PICK_RADIUS_MAX_PX * ndcTolPerPx) ** 2;

  const viewProj = camera.getTransformationMatrix();
  // Vertical projection scale (cot(fov/2)): projected NDC-y radius ≈ r · projY / depth.
  const projY = camera.getProjectionMatrix().m[5];
  const halfH = renderDims.y / 2;

  _candIdx.length = 0;
  _candT.length = 0;

  const visitIndex = (i: number) => {
    const px = centers[i * 3];
    const py = centers[i * 3 + 1];
    const pz = centers[i * 3 + 2];

    _oc.set(px - rayOrigin.x, py - rayOrigin.y, pz - rayOrigin.z);
    const t = Vector3.Dot(_oc, rayDirection);
    if (t <= 0.01) return;
    if (t > maxDistAlongRay) return;

    _vProj.set(px, py, pz);
    if (!projectWorldToNdcRef(viewProj, _vProj, _clip)) return;
    const dx = _clip.x - ndcX;
    const dy = _clip.y - ndcY;
    const distSq = dx * dx + dy * dy;

    let acceptSq = baseNdcTolSq;
    if (radii && radii[i] > 0) {
      // Projected splat radius in px (via NDC-y), converted to the short-axis NDC
      // units the cursor distance uses; approximation is fine for acceptance.
      const radiusPx = ((radii[i] * projY) / t) * halfH;
      if (radiusPx > PICK_RADIUS_PX) {
        const accept = Math.min(radiusPx, PICK_RADIUS_MAX_PX) * ndcTolPerPx;
        acceptSq = Math.min(accept * accept, maxNdcTolSq);
      }
    }
    if (distSq > acceptSq) return;

    _candIdx.push(i);
    _candT.push(t);
  };

  if (grid) {
    _gridCandidates.length = 0;
    collectGridCandidatesAlongRay(grid, rayOrigin, rayDirection, maxDistAlongRay, _gridCandidates);
    for (let k = 0; k < _gridCandidates.length; k++) visitIndex(_gridCandidates[k]);
  } else {
    const count = centers.length / 3;
    for (let i = 0; i < count; i++) visitIndex(i);
  }

  if (_candIdx.length === 0) return null;

  // Front-most splat under the cursor (closest to the camera along the pick ray).
  let bestI = -1;
  let bestT = Infinity;
  for (let k = 0; k < _candIdx.length; k++) {
    const t = _candT[k];
    if (t < bestT) {
      bestT = t;
      bestI = _candIdx[k];
    }
  }

  if (bestI < 0) return null;
  const j = bestI * 3;
  let px = centers[j];
  let py = centers[j + 1];
  let pz = centers[j + 2];
  if (radii && radii[bestI] > 0) {
    const shrink = Math.min(radii[bestI], bestT * 0.95);
    px -= rayDirection.x * shrink;
    py -= rayDirection.y * shrink;
    pz -= rayDirection.z * shrink;
  }
  return {
    position: new Vector3(px, py, pz),
    splatIndex: bestI,
  };
}

export interface PickSplatMeasureInput {
  scene: Scene;
  camera: Camera;
  mousePos: Vector2;
  renderDims: Vector2;
  maxDist: number;
  splatMeshVisible: boolean;
  centers: Float32Array | null;
  /** Per-splat world radius aligned with `centers` (size-aware acceptance); optional. */
  centerRadii?: Float32Array | null;
  centerGrid: SplatCenterGridAccel | null;
  /** Default: horizontal plane through y = 0 */
  groundPlane?: Plane;
  /**
   * When true: only nearest splat center under the cursor cone (no ground plane).
   * Used for measure mode snapping to discrete splat centers.
   */
  splatCentersOnly?: boolean;
}

export function pickSplatMeasure(input: PickSplatMeasureInput): PickResult | null {
  const {
    scene,
    camera,
    mousePos,
    renderDims,
    maxDist,
    splatMeshVisible,
    centers,
    centerRadii = null,
    centerGrid,
    splatCentersOnly = false,
  } = input;

  if (!splatMeshVisible) return null;

  const groundPlane = input.groundPlane ?? new Plane(0, 1, 0, 0);

  if (splatCentersOnly) {
    if (!centers || centers.length < 3) return null;
    const { ndcX, ndcY } = ndcFromMousePos(mousePos, renderDims);
    const ray = worldRayFromCameraScreen(scene, camera, mousePos);
    const centerHit = pickNearestCenterConeAlongRay(
      camera,
      ray.origin,
      ray.direction,
      ndcX,
      ndcY,
      centers,
      renderDims,
      maxDist,
      centerGrid,
      centerRadii,
    );
    if (centerHit) {
      return {
        position: centerHit.position.clone(),
        isSnapped: true,
        splatCenterIndex: centerHit.splatIndex,
      };
    }
    return null;
  }

  const { ndcX, ndcY } = ndcFromMousePos(mousePos, renderDims);
  const ray = worldRayFromCameraScreen(scene, camera, mousePos);

  if (centers && centers.length >= 3) {
    const centerHit = pickNearestCenterConeAlongRay(
      camera,
      ray.origin,
      ray.direction,
      ndcX,
      ndcY,
      centers,
      renderDims,
      maxDist,
      centerGrid,
      centerRadii,
    );
    if (centerHit) {
      return {
        position: centerHit.position.clone(),
        isSnapped: true,
        splatCenterIndex: centerHit.splatIndex,
      };
    }
  }

  const dist = ray.intersectsPlane(groundPlane);
  if (dist !== null && dist >= 0 && dist <= maxDist) {
    const groundHit = ray.origin.add(ray.direction.scale(dist));
    return { position: groundHit, isSnapped: false };
  }

  return null;
}

/**
 * Dev-only: project the first N cached splat centers through the camera and log
 * where they would appear on screen.
 */
export function diagPickAlignment(
  camera: Camera,
  centers: Float32Array | null,
  renderW: number,
  renderH: number,
  sampleCount = 5,
): void {
  if (!centers || centers.length < 3) {
    console.warn('[diagPick] no center cache');
    return;
  }
  const step = Math.max(1, Math.floor(centers.length / 3 / sampleCount));
  const v = new Vector3();
  const clip = new Vector3();
  const viewProj = camera.getTransformationMatrix();
  console.groupCollapsed(
    `[diagPick] ${sampleCount} sample splat centers → screen pos (renderDims ${renderW}x${renderH})`,
  );
  for (let i = 0; i < sampleCount; i++) {
    const idx = i * step;
    v.set(centers[idx * 3], centers[idx * 3 + 1], centers[idx * 3 + 2]);
    projectWorldToNdcRef(viewProj, v, clip);
    const ndcX = clip.x;
    const ndcY = clip.y;
    const sx = ((ndcX + 1) / 2) * renderW;
    const sy = ((-ndcY + 1) / 2) * renderH;
    console.log(
      `  splat[${idx}]: world=(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`,
      `ndc=(${ndcX.toFixed(3)},${ndcY.toFixed(3)})`,
      `screen=(${sx.toFixed(0)}px, ${sy.toFixed(0)}px)`,
    );
  }
  console.groupEnd();
}

/** Filter .splat buffer rows by alpha byte (offset 27 in each 32-byte record). */
export function filterSplatsByMinAlpha(data: ArrayBuffer, minAlpha: number): ArrayBuffer {
  const threshold = Math.max(0, Math.min(255, Math.round(minAlpha)));
  const src = new Uint8Array(data);
  const stride = SPLAT_ROW_BYTES;
  const n = Math.floor(src.length / stride);

  let keptCount = 0;
  for (let i = 0; i < n; i++) {
    if (src[i * stride + SPLAT_ALPHA_BYTE_OFFSET] >= threshold) keptCount++;
  }

  const out = new Uint8Array(keptCount * stride);
  let dst = 0;
  for (let i = 0; i < n; i++) {
    const off = i * stride;
    if (src[off + SPLAT_ALPHA_BYTE_OFFSET] >= threshold) {
      out.set(src.subarray(off, off + stride), dst);
      dst += stride;
    }
  }
  return out.buffer;
}
