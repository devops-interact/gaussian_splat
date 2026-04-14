import * as THREE from 'three';

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
export const PICK_RADIUS_PX = 28;

/** Build uniform grid over centers when count exceeds this (plan: large-PLY acceleration). */
export const CENTER_GRID_MIN_SPLATS = 50_000;

export type SplatMeshWithCenters = THREE.Object3D & {
  getSplatCount?: (includeSinceLastBuild?: boolean) => number;
  /** GS3D < 0.3.x: boolean; newer: Matrix4 | null */
  getSplatCenter?: (
    globalIndex: number,
    outCenter: THREE.Vector3,
    sceneTransform?: boolean | THREE.Matrix4 | null,
  ) => void;
};

export interface PickResult {
  position: THREE.Vector3;
  isSnapped: boolean;
  /** Set when the pick resolved to a splat world center (cone / center-cache path). */
  splatCenterIndex?: number;
}

export interface SplatHit {
  origin: THREE.Vector3;
  distance: number;
  splatIndex: number;
}

export interface GaussianSplatPickAdapter {
  setFromCameraAndScreenPosition(
    camera: THREE.Camera,
    screenPosition: THREE.Vector2,
    screenDimensions: THREE.Vector2,
  ): void;
  intersectSplatMesh(
    splatMesh: THREE.Object3D,
    outHits?: SplatHit[],
  ): SplatHit[];
  splatMesh: THREE.Object3D;
  isLoading: () => boolean;
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
}

const _sharedRaycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _vProj = new THREE.Vector3();
const _oc = new THREE.Vector3();

export function buildSplatCenterWorldCache(splatMesh: SplatMeshWithCenters): Float32Array | null {
  const countFn = splatMesh.getSplatCount;
  const centerFn = splatMesh.getSplatCenter;
  if (!countFn || !centerFn) return null;

  // Pass false to count only splats committed to the last SplatTree build.
  // If the tree hasn't been built yet this returns 0 and we bail out cleanly.
  const n = countFn.call(splatMesh, false);
  if (!n || n <= 0) return null;

  // Always obtain the current world transform so we are independent of whether
  // the third parameter of getSplatCenter is a boolean or a Matrix4.
  splatMesh.updateMatrixWorld(true);
  const matWorld = (splatMesh as unknown as THREE.Object3D).matrixWorld;
  const isIdentity =
    matWorld.elements[0] === 1 &&
    matWorld.elements[5] === 1 &&
    matWorld.elements[10] === 1 &&
    matWorld.elements[15] === 1 &&
    matWorld.elements[12] === 0 &&
    matWorld.elements[13] === 0 &&
    matWorld.elements[14] === 0;

  const buf = new Float32Array(n * 3);
  const p = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    // Pass 'false' for the third param (local space) and apply matrixWorld ourselves.
    // This is safe for both old (boolean) and new (Matrix4) versions of the API.
    centerFn.call(splatMesh, i, p, false);
    if (!isIdentity) p.applyMatrix4(matWorld);
    buf[i * 3] = p.x;
    buf[i * 3 + 1] = p.y;
    buf[i * 3 + 2] = p.z;
  }

  console.log(
    `[splatPick] center cache built: ${n} splats,`,
    `matWorld identity: ${isIdentity}`,
    `sample[0]: (${buf[0].toFixed(3)}, ${buf[1].toFixed(3)}, ${buf[2].toFixed(3)})`,
  );

  return buf;
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
    const ix = THREE.MathUtils.clamp(Math.floor((x - minX) / cellSizeX), 0, nx - 1);
    const iy = THREE.MathUtils.clamp(Math.floor((y - minY) / cellSizeY), 0, ny - 1);
    const iz = THREE.MathUtils.clamp(Math.floor((z - minZ) / cellSizeZ), 0, nz - 1);
    const flat = ix + nx * (iy + ny * iz);
    buckets[flat].push(i);
  }

  return { minX, minY, minZ, cellSizeX, cellSizeY, cellSizeZ, nx, ny, nz, buckets };
}

export function ndcFromMousePos(
  mousePos: THREE.Vector2,
  renderDims: THREE.Vector2,
): { ndcX: number; ndcY: number } {
  const w = Math.max(1e-6, renderDims.x);
  const h = Math.max(1e-6, renderDims.y);
  return {
    ndcX: (mousePos.x / w) * 2 - 1,
    ndcY: -(mousePos.y / h) * 2 + 1,
  };
}

export function worldRayFromCameraScreen(
  camera: THREE.PerspectiveCamera,
  mousePos: THREE.Vector2,
  renderDims: THREE.Vector2,
): { origin: THREE.Vector3; direction: THREE.Vector3 } {
  const { ndcX, ndcY } = ndcFromMousePos(mousePos, renderDims);
  _ndc.set(ndcX, ndcY);
  _sharedRaycaster.setFromCamera(_ndc, camera);
  return {
    origin: _sharedRaycaster.ray.origin.clone(),
    direction: _sharedRaycaster.ray.direction.clone(),
  };
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
 * Collect splat indices whose grid cells the ray traverses (Amanatides & Woo style, t from ray origin).
 */
function collectGridCandidatesAlongRay(
  grid: SplatCenterGridAccel,
  O: THREE.Vector3,
  D: THREE.Vector3,
  tRayMax: number,
  outSet: Set<number>,
): void {
  const maxGX = grid.minX + grid.nx * grid.cellSizeX;
  const maxGY = grid.minY + grid.ny * grid.cellSizeY;
  const maxGZ = grid.minZ + grid.nz * grid.cellSizeZ;

  const slab = rayAabbSlab(
    O.x,
    O.y,
    O.z,
    D.x,
    D.y,
    D.z,
    grid.minX,
    grid.minY,
    grid.minZ,
    maxGX,
    maxGY,
    maxGZ,
  );
  if (!slab) return;

  const t0 = Math.max(0, slab.t0);
  const t1 = Math.min(tRayMax, slab.t1);
  if (t0 > t1) return;

  const px = O.x + D.x * t0;
  const py = O.y + D.y * t0;
  const pz = O.z + D.z * t0;

  let ix = THREE.MathUtils.clamp(
    Math.floor((px - grid.minX) / grid.cellSizeX),
    0,
    grid.nx - 1,
  );
  let iy = THREE.MathUtils.clamp(
    Math.floor((py - grid.minY) / grid.cellSizeY),
    0,
    grid.ny - 1,
  );
  let iz = THREE.MathUtils.clamp(
    Math.floor((pz - grid.minZ) / grid.cellSizeZ),
    0,
    grid.nz - 1,
  );

  const stepX = D.x > 0 ? 1 : D.x < 0 ? -1 : 0;
  const stepY = D.y > 0 ? 1 : D.y < 0 ? -1 : 0;
  const stepZ = D.z > 0 ? 1 : D.z < 0 ? -1 : 0;

  const tDeltaX = D.x !== 0 ? grid.cellSizeX / Math.abs(D.x) : Infinity;
  const tDeltaY = D.y !== 0 ? grid.cellSizeY / Math.abs(D.y) : Infinity;
  const tDeltaZ = D.z !== 0 ? grid.cellSizeZ / Math.abs(D.z) : Infinity;

  let tMaxX: number;
  let tMaxY: number;
  let tMaxZ: number;
  if (stepX > 0) {
    tMaxX = (grid.minX + (ix + 1) * grid.cellSizeX - O.x) / D.x;
  } else if (stepX < 0) {
    tMaxX = (grid.minX + ix * grid.cellSizeX - O.x) / D.x;
  } else {
    tMaxX = Infinity;
  }
  if (stepY > 0) {
    tMaxY = (grid.minY + (iy + 1) * grid.cellSizeY - O.y) / D.y;
  } else if (stepY < 0) {
    tMaxY = (grid.minY + iy * grid.cellSizeY - O.y) / D.y;
  } else {
    tMaxY = Infinity;
  }
  if (stepZ > 0) {
    tMaxZ = (grid.minZ + (iz + 1) * grid.cellSizeZ - O.z) / D.z;
  } else if (stepZ < 0) {
    tMaxZ = (grid.minZ + iz * grid.cellSizeZ - O.z) / D.z;
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
    const fi = flatCellIndex(grid, ix, iy, iz);
    const bucket = grid.buckets[fi];
    for (let b = 0; b < bucket.length; b++) outSet.add(bucket[b]);

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

export type NearestSplatCenterHit = { position: THREE.Vector3; splatIndex: number };

/**
 * Nearest splat center along the view ray within screen cone; smallest ray parameter t wins.
 */
export function pickNearestCenterConeAlongRay(
  camera: THREE.PerspectiveCamera,
  rayOrigin: THREE.Vector3,
  rayDirection: THREE.Vector3,
  ndcX: number,
  ndcY: number,
  centers: Float32Array,
  renderDims: THREE.Vector2,
  maxDistAlongRay: number,
  grid: SplatCenterGridAccel | null,
): NearestSplatCenterHit | null {
  const shortAxis = Math.max(1, Math.min(renderDims.x, renderDims.y));
  const ndcTolPerPx = 2 / shortAxis;
  const ndcTol = PICK_RADIUS_PX * ndcTolPerPx;
  const ndcTolSq = ndcTol * ndcTol;

  let bestT = Infinity;
  let bestI = -1;

  const visitIndex = (i: number) => {
    const px = centers[i * 3];
    const py = centers[i * 3 + 1];
    const pz = centers[i * 3 + 2];

    _oc.set(px - rayOrigin.x, py - rayOrigin.y, pz - rayOrigin.z);
    const t = _oc.dot(rayDirection);
    if (t <= 0.01) return;
    if (t > maxDistAlongRay) return;
    if (t >= bestT) return;

    _vProj.set(px, py, pz).project(camera);
    if (_vProj.z < -1 || _vProj.z > 1) return;
    const dx = _vProj.x - ndcX;
    const dy = _vProj.y - ndcY;
    if (dx * dx + dy * dy > ndcTolSq) return;

    bestT = t;
    bestI = i;
  };

  if (grid) {
    const candidates = new Set<number>();
    collectGridCandidatesAlongRay(grid, rayOrigin, rayDirection, maxDistAlongRay, candidates);
    if (candidates.size === 0) {
      const count = centers.length / 3;
      for (let i = 0; i < count; i++) visitIndex(i);
    } else {
      candidates.forEach((i) => visitIndex(i));
      if (bestI < 0) {
        const count = centers.length / 3;
        for (let i = 0; i < count; i++) visitIndex(i);
      }
    }
  } else {
    const count = centers.length / 3;
    for (let i = 0; i < count; i++) visitIndex(i);
  }

  if (bestI < 0) return null;
  const j = bestI * 3;
  return {
    position: new THREE.Vector3(centers[j], centers[j + 1], centers[j + 2]),
    splatIndex: bestI,
  };
}

export interface PickSplatMeasureInput {
  camera: THREE.PerspectiveCamera;
  mousePos: THREE.Vector2;
  renderDims: THREE.Vector2;
  maxDist: number;
  splatMeshVisible: boolean;
  splatTreeReady: boolean;
  centers: Float32Array | null;
  centerGrid: SplatCenterGridAccel | null;
  gs3d: GaussianSplatPickAdapter | null;
  /** Default: horizontal plane through y = 0 */
  groundPlane?: THREE.Plane;
  /**
   * When true: only nearest splat center under the cursor cone (no GS3D surface hit, no ground plane).
   * Used for measure mode snapping to discrete splat centers.
   */
  splatCentersOnly?: boolean;
}

export function pickSplatMeasure(input: PickSplatMeasureInput): PickResult | null {
  const {
    camera,
    mousePos,
    renderDims,
    maxDist,
    splatMeshVisible,
    splatTreeReady,
    centers,
    centerGrid,
    gs3d,
    splatCentersOnly = false,
  } = input;

  if (!splatMeshVisible) return null;
  if (gs3d?.isLoading()) return null;

  const groundPlane = input.groundPlane ?? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  if (splatCentersOnly) {
    if (!centers || centers.length < 3) return null;
    const { ndcX, ndcY } = ndcFromMousePos(mousePos, renderDims);
    const ray = worldRayFromCameraScreen(camera, mousePos, renderDims);
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

  if (splatTreeReady && gs3d) {
    try {
      gs3d.setFromCameraAndScreenPosition(camera, mousePos, renderDims);
      const hits: SplatHit[] = [];
      gs3d.intersectSplatMesh(gs3d.splatMesh, hits);
      let bestLib: SplatHit | null = null;
      for (const h of hits) {
        if (!isFinite(h.distance) || h.distance > maxDist) continue;
        if (!bestLib || h.distance < bestLib.distance) bestLib = h;
      }
      if (bestLib) {
        // GS3D < 0.3.x names the hit position 'origin'; newer versions use 'point'.
        // Guard both and fall through to center-cache if neither looks plausible.
        const hitAny = bestLib as unknown as Record<string, unknown>;
        const rawPos = (
          hitAny['point'] instanceof THREE.Vector3
            ? hitAny['point']
            : hitAny['origin'] instanceof THREE.Vector3
              ? hitAny['origin']
              : null
        ) as THREE.Vector3 | null;

        if (rawPos) {
          const idx =
            typeof bestLib.splatIndex === 'number' && Number.isFinite(bestLib.splatIndex)
              ? bestLib.splatIndex
              : undefined;
          return { position: rawPos.clone(), isSnapped: true, splatCenterIndex: idx };
        }
        // Fall through to center cache.
      }
    } catch {
      // fall through to center cache
    }
  }

  const { ndcX, ndcY } = ndcFromMousePos(mousePos, renderDims);
  const ray = worldRayFromCameraScreen(camera, mousePos, renderDims);

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
    );
    if (centerHit) {
      return {
        position: centerHit.position.clone(),
        isSnapped: true,
        splatCenterIndex: centerHit.splatIndex,
      };
    }
  }

  const groundHit = new THREE.Vector3();
  _sharedRaycaster.setFromCamera(_ndc.set(ndcX, ndcY), camera);
  if (_sharedRaycaster.ray.intersectPlane(groundPlane, groundHit)) {
    return { position: groundHit, isSnapped: false };
  }

  return null;
}

/**
 * Dev-only: project the first N cached splat centers through the camera and log
 * where they would appear on screen. Useful to confirm center cache + render dims alignment.
 *
 * Usage in browser console (after model loads):
 *   import { diagPickAlignment } from '@/lib/splatPick';
 *   diagPickAlignment(camera, centersRef, renderW, renderH);
 */
export function diagPickAlignment(
  camera: THREE.PerspectiveCamera,
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
  const v = new THREE.Vector3();
  console.groupCollapsed(
    `[diagPick] ${sampleCount} sample splat centers → screen pos (renderDims ${renderW}x${renderH})`,
  );
  for (let i = 0; i < sampleCount; i++) {
    const idx = i * step;
    v.set(centers[idx * 3], centers[idx * 3 + 1], centers[idx * 3 + 2]);
    const ndc = v.clone().project(camera);
    const sx = ((ndc.x + 1) / 2) * renderW;
    const sy = ((-ndc.y + 1) / 2) * renderH;
    console.log(
      `  splat[${idx}]: world=(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`,
      `ndc=(${ndc.x.toFixed(3)},${ndc.y.toFixed(3)})`,
      `screen=(${sx.toFixed(0)}px, ${sy.toFixed(0)}px)`,
    );
  }
  console.groupEnd();
}
