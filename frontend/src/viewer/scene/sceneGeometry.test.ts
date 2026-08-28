import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { collectSceneGeometryMeshes } from './sceneGeometry';
import type { BabylonViewerCtx } from '../types';

function makeCtx(scene: Scene): BabylonViewerCtx {
  return {
    engine: scene.getEngine(),
    scene,
    orbitCamera: null as never,
    walkCamera: null as never,
    rootMesh: null,
    geometryMeshes: [],
    shellMeshes: [],
    zoneMeshes: [],
    collisionMesh: null,
    utilityLayer: null as never,
    framingBehavior: null as never,
    floorY: 0,
    effectiveDiagonal: 4,
    roomBounds: {
      min: new Vector3(-1, -1, -1),
      max: new Vector3(1, 1, 1),
      diagonal: 4,
    },
    walkPath: null,
  };
}

describe('collectSceneGeometryMeshes', () => {
  it('includes child submeshes from geometry, shell, and zone roots', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const ctx = makeCtx(scene);

    const root = new TransformNode('root', scene);
    const child = MeshBuilder.CreateBox('child', { size: 1 }, scene);
    child.parent = root;

    const shellRoot = new TransformNode('shellRoot', scene);
    const shellChild = MeshBuilder.CreateBox('room_shell', { size: 2 }, scene);
    shellChild.parent = shellRoot;

    const zoneRoot = MeshBuilder.CreateBox('zoneRoot', { size: 1 }, scene);
    const zoneChild = MeshBuilder.CreateBox('zoneChild', { size: 1 }, scene);
    zoneChild.parent = zoneRoot;

    ctx.geometryMeshes = [root as never];
    ctx.shellMeshes = [shellRoot as never];
    ctx.zoneMeshes = [{ zoneId: 0, rootMesh: zoneRoot, geometryMeshes: [zoneRoot, zoneChild] }];

    const meshes = collectSceneGeometryMeshes(ctx);
    const names = meshes.map((m) => m.name).sort();

    expect(names).toEqual(['child', 'room_shell', 'root', 'shellRoot', 'zoneChild', 'zoneRoot'].sort());

    scene.dispose();
    engine.dispose();
  });
});
