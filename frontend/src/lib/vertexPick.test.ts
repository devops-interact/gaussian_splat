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

    const centerPick = pickMeshMeasureVertex(scene, 256, 256, 48);
    expect(centerPick).not.toBeNull();
    expect(centerPick!.mesh).toBe(mesh);
    expect(centerPick!.triangleVerts?.length).toBe(3);

    mesh.dispose();
    scene.dispose();
    engine.dispose();
  });
});
