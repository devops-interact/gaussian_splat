import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { maxMeshPickDistance, snapToNearestVertex, snapToTriangleCorner } from './meshPick';

describe('maxMeshPickDistance', () => {
  it('returns half diagonal with minimum floor', () => {
    const d = maxMeshPickDistance({ min: [0, 0, 0], max: [10, 0, 0] });
    expect(d).toBeGreaterThanOrEqual(0.05);
    expect(d).toBe(5);
  });
});

describe('snapToTriangleCorner', () => {
  it('returns nearest triangle corner in world space', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox('test', { size: 1 }, scene);

    const faceId = 0;
    const nearCorner = new Vector3(0.5, 0.5, 0.5);
    const snapped = snapToTriangleCorner(mesh, faceId, nearCorner);

    expect(snapped).not.toBeNull();
    const corners = [
      new Vector3(-0.5, -0.5, -0.5),
      new Vector3(0.5, -0.5, -0.5),
      new Vector3(0.5, 0.5, -0.5),
      new Vector3(-0.5, 0.5, -0.5),
      new Vector3(-0.5, -0.5, 0.5),
      new Vector3(0.5, -0.5, 0.5),
      new Vector3(0.5, 0.5, 0.5),
      new Vector3(-0.5, 0.5, 0.5),
    ];
    const minDist = Math.min(...corners.map((c) => Vector3.Distance(c, snapped!)));
    expect(minDist).toBeLessThan(0.01);

    scene.dispose();
    engine.dispose();
  });

  it('returns null for invalid face id', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox('test', { size: 1 }, scene);

    expect(snapToTriangleCorner(mesh, -1, Vector3.Zero())).toBeNull();
    expect(snapToTriangleCorner(mesh, 9999, Vector3.Zero())).toBeNull();

    scene.dispose();
    engine.dispose();
  });
});

describe('snapToNearestVertex', () => {
  it('snaps to nearest vertex on parented mesh', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const root = new TransformNode('zone_root', scene);
    root.position = new Vector3(2, 0, 0);
    const mesh = MeshBuilder.CreateBox('zone_mesh', { size: 1 }, scene);
    mesh.parent = root;
    mesh.computeWorldMatrix(true);

    const nearCorner = new Vector3(2.5, 0.5, 0.5);
    const snapped = snapToNearestVertex(mesh, nearCorner);
    expect(snapped).not.toBeNull();
    expect(Vector3.Distance(snapped!, nearCorner)).toBeLessThan(1.5);

    scene.dispose();
    engine.dispose();
  });
});

describe('camera position immutability', () => {
  it('Vector3 subtract does not mutate camera position when using clone pattern', () => {
    const cameraPosition = new Vector3(0, 2, 5);
    const position = new Vector3(1, 0, 0);
    const original = cameraPosition.clone();
    const toCamera = cameraPosition.clone().subtractInPlace(position).normalize();
    expect(cameraPosition.equals(original)).toBe(true);
    expect(toCamera.length()).toBeCloseTo(1, 5);
  });
});
