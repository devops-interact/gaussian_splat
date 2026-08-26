import { describe, expect, it, vi } from 'vitest';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import * as meshPick from './meshPick';
import {
  MAX_VERTS_FOR_NEAREST_SNAP,
  maxMeshPickDistance,
  pickMeshMeasure,
  pickMeshMeasureAtPointer,
  pickMeshSurface,
  snapToNearestVertex,
  snapToTriangleCorner,
} from './meshPick';

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

describe('pickMeshSurface on parented mesh', () => {
  it('hits a mesh under a rotated TransformNode', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const root = new TransformNode('zone_root', scene);
    root.rotation.y = Math.PI / 6;
    const mesh = MeshBuilder.CreateBox('zone_mesh', { size: 2 }, scene);
    mesh.parent = root;
    mesh.isPickable = true;
    root.computeWorldMatrix(true);
    mesh.computeWorldMatrix(true);
    mesh.getBoundingInfo().update(mesh.getWorldMatrix());

    const camera = new UniversalCamera('cam', new Vector3(0, 0, -6), scene);
    camera.setTarget(Vector3.Zero());
    scene.activeCamera = camera;
    scene.render();

    const w = engine.getRenderWidth() || 512;
    const h = engine.getRenderHeight() || 512;
    const result = pickMeshSurface(scene, w / 2, h / 2);

    expect(result.hit).toBe(true);
    expect(result.mesh?.name).toBe('zone_mesh');
    expect(result.point).not.toBeNull();

    scene.dispose();
    engine.dispose();
  });

  it('returns null for disabled mesh', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox('zone_mesh', { size: 2 }, scene);
    mesh.isPickable = true;
    mesh.setEnabled(false);

    const camera = new UniversalCamera('cam', new Vector3(0, 0, -6), scene);
    scene.activeCamera = camera;
    scene.render();

    const w = engine.getRenderWidth() || 512;
    const h = engine.getRenderHeight() || 512;
    const result = pickMeshSurface(scene, w / 2, h / 2);

    expect(result.hit).toBe(false);

    scene.dispose();
    engine.dispose();
  });
});

describe('pickMeshMeasureAtPointer', () => {
  it('picks using scene pointer coordinates', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox('zone_mesh', { size: 2 }, scene);
    mesh.isPickable = true;

    const camera = new UniversalCamera('cam', new Vector3(0, 0, -6), scene);
    camera.setTarget(Vector3.Zero());
    scene.activeCamera = camera;
    scene.render();

    const w = engine.getRenderWidth() || 512;
    const h = engine.getRenderHeight() || 512;
    scene.pointerX = w / 2;
    scene.pointerY = h / 2;

    const result = pickMeshMeasureAtPointer(scene);

    expect(result).not.toBeNull();
    expect(result!.mesh?.name).toBe('zone_mesh');

    scene.dispose();
    engine.dispose();
  });
});

describe('pickMeshMeasure on room shell', () => {
  it('hits shell mesh parented under room_root', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const roomRoot = new TransformNode('room_root', scene);
    const shell = MeshBuilder.CreateBox('room_shell', { size: 2 }, scene);
    shell.parent = roomRoot;
    shell.isPickable = true;
    roomRoot.computeWorldMatrix(true);
    shell.computeWorldMatrix(true);
    shell.getBoundingInfo().update(shell.getWorldMatrix());

    const camera = new UniversalCamera('cam', new Vector3(0, 0, -6), scene);
    camera.setTarget(Vector3.Zero());
    scene.activeCamera = camera;
    scene.render();

    const w = engine.getRenderWidth() || 512;
    const h = engine.getRenderHeight() || 512;
    const result = pickMeshMeasure(scene, w / 2, h / 2);

    expect(result).not.toBeNull();
    expect(result!.mesh?.name).toBe('room_shell');

    scene.dispose();
    engine.dispose();
  });
});

describe('pickMeshMeasure dense mesh guard', () => {
  it('skips nearest-vertex scan when mesh vertex count exceeds budget', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox('dense', { size: 2 }, scene);
    mesh.isPickable = true;
    vi.spyOn(mesh, 'getTotalVertices').mockReturnValue(MAX_VERTS_FOR_NEAREST_SNAP + 10);
    vi.spyOn(mesh, 'getClosestFacetAtCoordinates').mockReturnValue(null);

    const camera = new UniversalCamera('cam', new Vector3(0, 0, -6), scene);
    scene.activeCamera = camera;
    scene.render();

    const nearestSpy = vi.spyOn(meshPick, 'snapToNearestVertex');
    const pickSpy = vi.spyOn(scene, 'pickWithRay').mockReturnValue({
      hit: true,
      pickedPoint: new Vector3(0, 0, 1),
      pickedMesh: mesh,
      faceId: -1,
    } as unknown as ReturnType<typeof scene.pickWithRay>);

    const result = meshPick.pickMeshMeasure(scene, 256, 256);

    expect(result).not.toBeNull();
    expect(nearestSpy).not.toHaveBeenCalled();
    expect(result!.isSnapped).toBe(false);

    pickSpy.mockRestore();
    nearestSpy.mockRestore();
    scene.dispose();
    engine.dispose();
  });

  it('snaps via facet lookup when pick faceId is missing on dense mesh', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox('dense', { size: 2 }, scene);
    mesh.isPickable = true;
    vi.spyOn(mesh, 'getTotalVertices').mockReturnValue(MAX_VERTS_FOR_NEAREST_SNAP + 10);
    vi.spyOn(mesh, 'getClosestFacetAtCoordinates').mockReturnValue(0);

    const camera = new UniversalCamera('cam', new Vector3(0, 0, -6), scene);
    scene.activeCamera = camera;
    scene.render();

    const nearestSpy = vi.spyOn(meshPick, 'snapToNearestVertex');
    const pickSpy = vi.spyOn(scene, 'pickWithRay').mockReturnValue({
      hit: true,
      pickedPoint: new Vector3(0.5, 0.5, 1),
      pickedMesh: mesh,
      faceId: -1,
    } as unknown as ReturnType<typeof scene.pickWithRay>);

    const result = meshPick.pickMeshMeasure(scene, 256, 256);

    expect(result).not.toBeNull();
    expect(nearestSpy).not.toHaveBeenCalled();
    expect(result!.isSnapped).toBe(true);

    pickSpy.mockRestore();
    nearestSpy.mockRestore();
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
