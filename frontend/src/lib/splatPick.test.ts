import { describe, expect, it } from 'vitest';
import {
  ArcRotateCamera,
  Matrix,
  NullEngine,
  Plane,
  Scene,
  Vector2,
  Vector3,
} from '@babylonjs/core';
import {
  buildCenterGridAcceleration,
  buildSplatCenterWorldCache,
  CENTER_GRID_MIN_SPLATS,
  filterSplatsByMinAlpha,
  maxSplatPickDistance,
  ndcFromMousePos,
  PICK_CENTER_ALPHA_FLOOR,
  pickNearestCenterConeAlongRay,
  pickSplatMeasure,
  worldRayFromCameraScreen,
  type SplatMeshWithCenters,
} from './splatPick';

/** Build a synthetic 32-byte-per-row splat buffer with positions, alpha bytes, and scales. */
function makeSplatsData(
  positions: [number, number, number][],
  alphas: number[],
  scales?: [number, number, number][],
): ArrayBuffer {
  const buf = new ArrayBuffer(positions.length * 32);
  const f = new Float32Array(buf);
  const u = new Uint8Array(buf);
  positions.forEach((p, i) => {
    f[i * 8] = p[0];
    f[i * 8 + 1] = p[1];
    f[i * 8 + 2] = p[2];
    if (scales) {
      f[i * 8 + 3] = scales[i][0];
      f[i * 8 + 4] = scales[i][1];
      f[i * 8 + 5] = scales[i][2];
    }
    u[i * 32 + 27] = alphas[i];
  });
  return buf;
}

function mockSplatMesh(data: ArrayBuffer): SplatMeshWithCenters {
  return {
    splatsData: data,
    getWorldMatrix: () => Matrix.Identity(),
    computeWorldMatrix: () => Matrix.Identity(),
  };
}

function makeTestScene(): { scene: Scene; camera: ArcRotateCamera } {
  const engine = new NullEngine();
  engine.setSize(800, 600);
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2, 5, Vector3.Zero(), scene);
  camera.minZ = 0.1;
  camera.maxZ = 100;
  camera.setPosition(new Vector3(0, 0, 5));
  camera.setTarget(Vector3.Zero());
  scene.activeCamera = camera;
  camera.getViewMatrix();
  camera.getProjectionMatrix(true);
  return { scene, camera };
}

describe('ndcFromMousePos', () => {
  it('maps pixel center to origin NDC', () => {
    const mouse = new Vector2(400, 300);
    const dims = new Vector2(800, 600);
    const { ndcX, ndcY } = ndcFromMousePos(mouse, dims);
    expect(ndcX).toBeCloseTo(0);
    expect(ndcY).toBeCloseTo(0);
  });
});

describe('maxSplatPickDistance', () => {
  it('scales with bbox diagonal', () => {
    const d = maxSplatPickDistance({
      min: [0, 0, 0],
      max: [1, 0, 0],
    });
    expect(d).toBeGreaterThanOrEqual(3);
    expect(d).toBeCloseTo(4, 0);
  });
});

describe('worldRayFromCameraScreen', () => {
  it('returns a unit direction ray from the camera pick path', () => {
    const { scene, camera } = makeTestScene();
    const mouse = new Vector2(400, 300);
    const ray = worldRayFromCameraScreen(scene, camera, mouse);
    expect(ray.direction.length()).toBeCloseTo(1, 3);
  });
});

describe('pickNearestCenterConeAlongRay', () => {
  it('chooses the front depth cluster when centers are well separated along the ray', () => {
    const { scene, camera } = makeTestScene();
    const renderDims = new Vector2(800, 600);
    const mouse = new Vector2(400, 300);
    const ray = worldRayFromCameraScreen(scene, camera, mouse);
    const { ndcX, ndcY } = ndcFromMousePos(mouse, renderDims);
    // Both under the cursor: z=3 is nearer to the camera (at z=5) than z=0.5;
    // the far one is outside the front depth window, so it never wins.
    const centers = new Float32Array([
      0, 0, 0.5,
      0, 0, 3,
    ]);
    const hit = pickNearestCenterConeAlongRay(
      camera,
      ray.origin,
      ray.direction,
      ndcX,
      ndcY,
      centers,
      renderDims,
      100,
      null,
    );
    expect(hit).not.toBeNull();
    expect(hit!.position.x).toBeCloseTo(0);
    expect(hit!.position.y).toBeCloseTo(0);
    expect(hit!.position.z).toBeCloseTo(3);
    expect(hit!.splatIndex).toBe(1);
  });

  it('picks the front-most splat under the cursor (closest along the ray)', () => {
    const { scene, camera } = makeTestScene();
    const renderDims = new Vector2(800, 600);
    const mouse = new Vector2(400, 300);
    const ray = worldRayFromCameraScreen(scene, camera, mouse);
    const { ndcX, ndcY } = ndcFromMousePos(mouse, renderDims);
    // Index 0 is slightly nearer (smaller t) but off-cursor; index 1 sits exactly
    // under the cursor at nearly the same depth — front-most wins (index 0).
    const centers = new Float32Array([
      0.05, 0, 3.02,
      0, 0, 3.0,
    ]);
    const hit = pickNearestCenterConeAlongRay(
      camera,
      ray.origin,
      ray.direction,
      ndcX,
      ndcY,
      centers,
      renderDims,
      100,
      null,
    );
    expect(hit).not.toBeNull();
    expect(hit!.splatIndex).toBe(0);
    expect(hit!.position.z).toBeCloseTo(3.02);
  });

  it('accepts large splats beyond the base pick radius when radii are provided', () => {
    const { scene, camera } = makeTestScene();
    const renderDims = new Vector2(800, 600);
    const mouse = new Vector2(400, 300);
    const ray = worldRayFromCameraScreen(scene, camera, mouse);
    const { ndcX, ndcY } = ndcFromMousePos(mouse, renderDims);
    // Center is ~0.2 world units off-axis at depth 2 — well outside the 28 px cone,
    // but inside the splat's own projected footprint (world radius 0.5).
    const centers = new Float32Array([0.2, 0, 3]);

    const withoutRadii = pickNearestCenterConeAlongRay(
      camera, ray.origin, ray.direction, ndcX, ndcY, centers, renderDims, 100, null,
    );
    expect(withoutRadii).toBeNull();

    const withRadii = pickNearestCenterConeAlongRay(
      camera, ray.origin, ray.direction, ndcX, ndcY, centers, renderDims, 100, null,
      new Float32Array([0.5]),
    );
    expect(withRadii).not.toBeNull();
    expect(withRadii!.splatIndex).toBe(0);
  });
});

describe('buildCenterGridAcceleration', () => {
  it('returns null when splat count is at or below threshold', () => {
    const n = Math.min(100, CENTER_GRID_MIN_SPLATS);
    const centers = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      centers[i * 3] = i;
      centers[i * 3 + 1] = 0;
      centers[i * 3 + 2] = 0;
    }
    expect(buildCenterGridAcceleration(centers)).toBeNull();
  });

  it('builds a grid when above threshold', () => {
    const n = CENTER_GRID_MIN_SPLATS + 1;
    const centers = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      centers[i * 3] = (i % 50) * 0.1;
      centers[i * 3 + 1] = Math.floor(i / 50) * 0.1;
      centers[i * 3 + 2] = 0;
    }
    const grid = buildCenterGridAcceleration(centers);
    expect(grid).not.toBeNull();
    expect(grid!.buckets.length).toBe(grid!.nx * grid!.ny * grid!.nz);
  });
});

describe('filterSplatsByMinAlpha', () => {
  it('keeps only rows with alpha >= threshold, preserving row bytes', () => {
    const data = makeSplatsData(
      [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
      [10, 200, 255],
    );
    const out = filterSplatsByMinAlpha(data, 100);
    expect(out.byteLength).toBe(64);
    const f = new Float32Array(out);
    expect([f[0], f[1], f[2]]).toEqual([4, 5, 6]);
    expect([f[8], f[9], f[10]]).toEqual([7, 8, 9]);
    const u = new Uint8Array(out);
    expect(u[27]).toBe(200);
    expect(u[32 + 27]).toBe(255);
  });

  it('returns an empty buffer when nothing passes the threshold', () => {
    const data = makeSplatsData([[1, 2, 3]], [5]);
    expect(filterSplatsByMinAlpha(data, 200).byteLength).toBe(0);
  });

  it('keeps everything at threshold 0', () => {
    const data = makeSplatsData(
      [
        [1, 0, 0],
        [2, 0, 0],
      ],
      [0, 255],
    );
    expect(filterSplatsByMinAlpha(data, 0).byteLength).toBe(64);
  });
});

describe('buildSplatCenterWorldCache', () => {
  it('skips splats below the alpha floor and compacts the buffers', () => {
    const data = makeSplatsData(
      [
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ],
      [0, 255, PICK_CENTER_ALPHA_FLOOR],
    );
    const cache = buildSplatCenterWorldCache(mockSplatMesh(data));
    expect(cache).not.toBeNull();
    expect(cache!.positions.length).toBe(6);
    expect(cache!.positions[0]).toBe(2);
    expect(cache!.positions[3]).toBe(3);
    expect(cache!.radii.length).toBe(2);
  });

  it('falls back to unfiltered centers when the floor would drop everything', () => {
    const data = makeSplatsData([[1, 0, 0]], [0]);
    const cache = buildSplatCenterWorldCache(mockSplatMesh(data));
    expect(cache).not.toBeNull();
    expect(cache!.positions.length).toBe(3);
    expect(cache!.positions[0]).toBe(1);
  });

  it('stores the max-axis scale as the pick radius', () => {
    const data = makeSplatsData(
      [[0, 0, 0]],
      [255],
      [[0.1, 0.25, 0.05]],
    );
    const cache = buildSplatCenterWorldCache(mockSplatMesh(data));
    expect(cache).not.toBeNull();
    expect(cache!.radii[0]).toBeCloseTo(0.25);
  });
});

describe('grid-accelerated cone pick', () => {
  it('resolves a center under the cursor through the dilated grid traversal', () => {
    const { scene, camera } = makeTestScene();
    const n = CENTER_GRID_MIN_SPLATS + 1;
    const centers = new Float32Array(n * 3);
    // Index 0 sits on the view ray at (0, 0, 3); the rest fill a plane far off-axis.
    centers[0] = 0;
    centers[1] = 0;
    centers[2] = 3;
    for (let i = 1; i < n; i++) {
      centers[i * 3] = -20 - (i % 100) * 0.05;
      centers[i * 3 + 1] = Math.floor(i / 100) * 0.05;
      centers[i * 3 + 2] = 0;
    }
    const grid = buildCenterGridAcceleration(centers);
    expect(grid).not.toBeNull();

    const pick = pickSplatMeasure({
      scene,
      camera,
      mousePos: new Vector2(400, 300),
      renderDims: new Vector2(800, 600),
      maxDist: 100,
      splatMeshVisible: true,
      centers,
      centerGrid: grid,
      splatCentersOnly: true,
    });
    expect(pick?.isSnapped).toBe(true);
    expect(pick?.splatCenterIndex).toBe(0);
    expect(pick?.position.z).toBeCloseTo(3);
  });

  it('returns null (no full-scan fallback) when the ray misses all populated cells', () => {
    const { scene, camera } = makeTestScene();
    const n = CENTER_GRID_MIN_SPLATS + 1;
    const centers = new Float32Array(n * 3);
    // Everything far off-axis; view ray down -z near the origin never enters their cells' neighborhood.
    for (let i = 0; i < n; i++) {
      centers[i * 3] = -40 - (i % 100) * 0.05;
      centers[i * 3 + 1] = 20 + Math.floor(i / 100) * 0.05;
      centers[i * 3 + 2] = 0;
    }
    const grid = buildCenterGridAcceleration(centers);
    expect(grid).not.toBeNull();

    const pick = pickSplatMeasure({
      scene,
      camera,
      mousePos: new Vector2(400, 300),
      renderDims: new Vector2(800, 600),
      maxDist: 100,
      splatMeshVisible: true,
      centers,
      centerGrid: grid,
      splatCentersOnly: true,
    });
    expect(pick).toBeNull();
  });
});

describe('pickSplatMeasure', () => {
  it('returns unsnapped ground pick when no splat hits', () => {
    const { scene, camera } = makeTestScene();
    camera.setPosition(new Vector3(3, 5, 3));
    camera.setTarget(Vector3.Zero());
    camera.getViewMatrix();
    camera.getProjectionMatrix(true);

    const pick = pickSplatMeasure({
      scene,
      camera,
      mousePos: new Vector2(400, 300),
      renderDims: new Vector2(800, 600),
      maxDist: 100,
      splatMeshVisible: true,
      centers: null,
      centerGrid: null,
      groundPlane: new Plane(0, 1, 0, 0),
    });

    expect(pick).not.toBeNull();
    expect(pick!.isSnapped).toBe(false);
    expect(Math.abs(pick!.position.y)).toBeLessThan(1e-2);
  });

  it('splatCentersOnly returns nearest center with index', () => {
    const { scene, camera } = makeTestScene();
    const centers = new Float32Array([
      0, 0, 0.5,
      0, 0, 3,
    ]);

    const pick = pickSplatMeasure({
      scene,
      camera,
      mousePos: new Vector2(400, 300),
      renderDims: new Vector2(800, 600),
      maxDist: 100,
      splatMeshVisible: true,
      centers,
      centerGrid: null,
      splatCentersOnly: true,
    });

    expect(pick?.isSnapped).toBe(true);
    expect(pick?.splatCenterIndex).toBe(1);
    expect(pick?.position.z).toBeCloseTo(3);
  });

  it('splatCentersOnly returns null when no center in cone', () => {
    const { scene, camera } = makeTestScene();
    const centers = new Float32Array([10, 10, 10]);
    const pick = pickSplatMeasure({
      scene,
      camera,
      mousePos: new Vector2(400, 300),
      renderDims: new Vector2(800, 600),
      maxDist: 100,
      splatMeshVisible: true,
      centers,
      centerGrid: null,
      splatCentersOnly: true,
    });
    expect(pick).toBeNull();
  });
});
