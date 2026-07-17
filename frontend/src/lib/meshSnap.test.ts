import { describe, expect, it } from 'vitest';
import {
  ArcRotateCamera,
  Matrix,
  NullEngine,
  Scene,
  Vector2,
  Vector3,
} from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { closestPointOnSegment, snapPickToMeshFeature } from './meshSnap';

function makeTestCamera(): ArcRotateCamera {
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
  return camera;
}

/** Minimal mesh stub: one triangle, identity world matrix. */
function makeTriangleMesh(verts: [number, number, number][]): AbstractMesh {
  const positions = new Float32Array(verts.flat());
  return {
    getIndices: () => [0, 1, 2],
    getVerticesData: () => positions,
    getWorldMatrix: () => Matrix.Identity(),
  } as unknown as AbstractMesh;
}

describe('closestPointOnSegment', () => {
  it('clamps to endpoints', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(1, 0, 0);
    expect(closestPointOnSegment(a, b, new Vector3(-2, 1, 0)).x).toBeCloseTo(0);
    expect(closestPointOnSegment(a, b, new Vector3(3, 1, 0)).x).toBeCloseTo(1);
  });

  it('projects onto the segment interior', () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(2, 0, 0);
    const p = closestPointOnSegment(a, b, new Vector3(1, 5, 0));
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(0);
  });
});

describe('snapPickToMeshFeature', () => {
  // Triangle in the z=0 plane around the origin; camera at (0,0,5) looking at origin.
  const verts: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const renderDims = new Vector2(800, 600);

  it('snaps to a vertex when the cursor is on it', () => {
    const camera = makeTestCamera();
    const mesh = makeTriangleMesh(verts);
    // Cursor at NDC of the origin vertex (screen center) with a hit slightly inside the face.
    const result = snapPickToMeshFeature(
      mesh, 0, new Vector3(0.01, 0.01, 0), camera, 0, 0, renderDims,
    );
    expect(result.snapType).toBe('vertex');
    expect(result.position.x).toBeCloseTo(0);
    expect(result.position.y).toBeCloseTo(0);
  });

  it('snaps to an edge when near the edge but away from vertices', () => {
    const camera = makeTestCamera();
    const mesh = makeTriangleMesh(verts);
    // Point near the middle of edge (0,0,0)-(1,0,0), slightly off it in y.
    const hit = new Vector3(0.5, 0.01, 0);
    const clip = Vector3.TransformCoordinates(hit, camera.getTransformationMatrix());
    const result = snapPickToMeshFeature(mesh, 0, hit, camera, clip.x, clip.y, renderDims);
    expect(result.snapType).toBe('edge');
    expect(result.position.y).toBeCloseTo(0, 3);
    expect(result.position.x).toBeCloseTo(0.5, 2);
  });

  it('falls back to the surface hit deep inside a large face', () => {
    const camera = makeTestCamera();
    const big: [number, number, number][] = [
      [-4, -4, 0],
      [4, -4, 0],
      [0, 4, 0],
    ];
    const mesh = makeTriangleMesh(big);
    const hit = new Vector3(0, -1, 0);
    const clip = Vector3.TransformCoordinates(hit, camera.getTransformationMatrix());
    const result = snapPickToMeshFeature(mesh, 0, hit, camera, clip.x, clip.y, renderDims);
    expect(result.snapType).toBe('face');
    expect(result.position.x).toBeCloseTo(0);
    expect(result.position.y).toBeCloseTo(-1);
  });
});
