import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  buildCenterGridAcceleration,
  CENTER_GRID_MIN_SPLATS,
  maxSplatPickDistance,
  ndcFromMousePos,
  pickNearestCenterConeAlongRay,
  pickSplatMeasure,
  type SplatHit,
  worldRayFromCameraScreen,
} from './splatPick';

describe('ndcFromMousePos', () => {
  it('maps pixel center to origin NDC', () => {
    const mouse = new THREE.Vector2(400, 300);
    const dims = new THREE.Vector2(800, 600);
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
  it('origin matches camera and direction looks into the scene', () => {
    const cam = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 100);
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    const mouse = new THREE.Vector2(400, 300);
    const dims = new THREE.Vector2(800, 600);
    const { origin, direction } = worldRayFromCameraScreen(cam, mouse, dims);
    expect(origin.distanceTo(cam.position)).toBeLessThan(1e-4);
    expect(direction.length()).toBeCloseTo(1, 5);
    expect(direction.z).toBeLessThan(0);
  });
});

describe('pickNearestCenterConeAlongRay', () => {
  function cameraOnZAxis(): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return cam;
  }

  it('chooses front-most splat (smallest t) among centers under the cursor', () => {
    const cam = cameraOnZAxis();
    const renderDims = new THREE.Vector2(800, 600);
    const mouse = new THREE.Vector2(400, 300);
    const ray = worldRayFromCameraScreen(cam, mouse, renderDims);
    const { ndcX, ndcY } = ndcFromMousePos(mouse, renderDims);
    // Along the view ray from z=5 toward -Z: (0,0,3) is in front of (0,0,0.5)
    const centers = new Float32Array([
      0, 0, 0.5,
      0, 0, 3,
    ]);
    const hit = pickNearestCenterConeAlongRay(
      cam,
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

describe('pickSplatMeasure', () => {
  it('uses closest library hit by distance when SplatTree is ready', () => {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(0, 2, 5);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    const splatMesh = new THREE.Group();
    const gs3d = {
      setFromCameraAndScreenPosition: vi.fn(),
      intersectSplatMesh: vi.fn((_mesh: THREE.Object3D, out: { origin: THREE.Vector3; distance: number; splatIndex: number }[]) => {
        out.length = 0;
        out.push({ origin: new THREE.Vector3(1, 0, 0), distance: 10, splatIndex: 0 });
        out.push({ origin: new THREE.Vector3(2, 0, 0), distance: 5, splatIndex: 1 });
        return out;
      }),
      splatMesh,
      isLoading: () => false,
    };

    const pick = pickSplatMeasure({
      camera: cam,
      mousePos: new THREE.Vector2(400, 300),
      renderDims: new THREE.Vector2(800, 600),
      maxDist: 100,
      splatMeshVisible: true,
      splatTreeReady: true,
      centers: null,
      centerGrid: null,
      gs3d,
    });

    expect(pick?.isSnapped).toBe(true);
    expect(pick?.position.x).toBeCloseTo(2);
    expect(gs3d.setFromCameraAndScreenPosition).toHaveBeenCalled();
  });

  it('returns unsnapped ground pick when no splat hits', () => {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cam.position.set(3, 5, 3);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    const splatMesh = new THREE.Group();
    const gs3d = {
      setFromCameraAndScreenPosition: vi.fn(),
      intersectSplatMesh: vi.fn((_mesh: THREE.Object3D, out: SplatHit[]) => {
        out.length = 0;
        return out;
      }),
      splatMesh,
      isLoading: () => false,
    };

    const pick = pickSplatMeasure({
      camera: cam,
      mousePos: new THREE.Vector2(400, 300),
      renderDims: new THREE.Vector2(800, 600),
      maxDist: 100,
      splatMeshVisible: true,
      splatTreeReady: true,
      centers: null,
      centerGrid: null,
      gs3d,
      groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    });

    expect(pick).not.toBeNull();
    expect(pick!.isSnapped).toBe(false);
    expect(Math.abs(pick!.position.y)).toBeLessThan(1e-3);
  });

  it('splatCentersOnly skips GS3D and returns nearest center with index', () => {
    const cam = new THREE.PerspectiveCamera(60, 800 / 600, 0.1, 100);
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    const centers = new Float32Array([
      0, 0, 0.5,
      0, 0, 3,
    ]);
    const gs3d = {
      setFromCameraAndScreenPosition: vi.fn(),
      intersectSplatMesh: vi.fn(() => []),
      splatMesh: new THREE.Group(),
      isLoading: () => false,
    };

    const pick = pickSplatMeasure({
      camera: cam,
      mousePos: new THREE.Vector2(400, 300),
      renderDims: new THREE.Vector2(800, 600),
      maxDist: 100,
      splatMeshVisible: true,
      splatTreeReady: true,
      centers,
      centerGrid: null,
      gs3d,
      splatCentersOnly: true,
    });

    expect(gs3d.setFromCameraAndScreenPosition).not.toHaveBeenCalled();
    expect(pick?.isSnapped).toBe(true);
    expect(pick?.splatCenterIndex).toBe(1);
    expect(pick?.position.z).toBeCloseTo(3);
  });

  it('splatCentersOnly returns null when no center in cone', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    const centers = new Float32Array([10, 10, 10]);
    const pick = pickSplatMeasure({
      camera: cam,
      mousePos: new THREE.Vector2(400, 300),
      renderDims: new THREE.Vector2(800, 600),
      maxDist: 100,
      splatMeshVisible: true,
      splatTreeReady: false,
      centers,
      centerGrid: null,
      gs3d: null,
      splatCentersOnly: true,
    });
    expect(pick).toBeNull();
  });
});
