import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { getTriangleWorldVertices } from './meshPick';
import { pickMeshMeasureVertex } from './vertexPick';

describe('getTriangleWorldVertices', () => {
  it('returns three world corners for face 0 on a box', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox('box', { size: 1 }, scene);
    mesh.computeWorldMatrix(true);

    const verts = getTriangleWorldVertices(mesh, 0);
    expect(verts).not.toBeNull();
    expect(verts).toHaveLength(3);

    mesh.dispose();
    scene.dispose();
    engine.dispose();
  });
});

describe('pickMeshMeasureVertex', () => {
  it('snaps to a triangle vertex when cursor is near a projected corner', () => {
    const engine = new NullEngine({ renderWidth: 512, renderHeight: 512 });
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox('pickBox', { size: 2 }, scene);
    mesh.isPickable = true;
    mesh.position.z = 0;

    const camera = new UniversalCamera('cam', new Vector3(0, 0, -6), scene);
    camera.setTarget(Vector3.Zero());
    scene.activeCamera = camera;

    const centerPick = pickMeshMeasureVertex(scene, 256, 256, 256, 256, 48);
    expect(centerPick).not.toBeNull();
    expect(centerPick!.mesh).toBe(mesh);
    expect(centerPick!.triangleVerts?.length).toBe(3);

    mesh.dispose();
    scene.dispose();
    engine.dispose();
  });

  it('uses CSS coords for ray pick and buffer coords for screen snap at DPR 2', () => {
    const engine = new NullEngine({ renderWidth: 512, renderHeight: 512 });
    engine.setHardwareScalingLevel(2);
    const scene = new Scene(engine);
    const mesh = MeshBuilder.CreateBox('dprBox', { size: 2 }, scene);
    mesh.isPickable = true;
    mesh.position.z = 0;

    const camera = new UniversalCamera('cam', new Vector3(0, 0, -6), scene);
    camera.setTarget(Vector3.Zero());
    scene.activeCamera = camera;

    const cssX = 256;
    const cssY = 256;
    const bufferX = cssX * 2;
    const bufferY = cssY * 2;

    const pickWithSplitCoords = pickMeshMeasureVertex(scene, cssX, cssY, bufferX, bufferY, 48);
    expect(pickWithSplitCoords).not.toBeNull();
    expect(pickWithSplitCoords!.mesh).toBe(mesh);
    expect(pickWithSplitCoords!.isSnapped).toBe(true);

    const pickWithWrongRay = pickMeshMeasureVertex(scene, bufferX, bufferY, bufferX, bufferY, 48);
    expect(pickWithWrongRay?.isSnapped).not.toBe(true);

    mesh.dispose();
    scene.dispose();
    engine.dispose();
  });
});
