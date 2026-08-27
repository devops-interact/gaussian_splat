import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { BabylonViewerCtx } from '../types';
import {
  applyMeasureGeometryView,
  isMeasureGeometryViewActive,
  MEASURE_BASE_VISIBILITY,
  restoreMeasureGeometryView,
} from './measureGeometryView';

function makeCtx(scene: Scene): BabylonViewerCtx {
  const mesh = MeshBuilder.CreateBox('geo', { size: 1 }, scene);
  return {
    engine: scene.getEngine(),
    scene,
    orbitCamera: null as never,
    walkCamera: null as never,
    rootMesh: mesh,
    geometryMeshes: [mesh],
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

describe('measureGeometryView', () => {
  it('enables edges and dims base mesh visibility', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const ctx = makeCtx(scene);
    const mesh = ctx.geometryMeshes[0];
    mesh.visibility = 1;

    expect(isMeasureGeometryViewActive()).toBe(false);
    applyMeasureGeometryView(ctx);

    expect(isMeasureGeometryViewActive()).toBe(true);
    expect(mesh._edgesRenderer).toBeTruthy();
    expect(mesh._edgesRenderer?.isEnabled).toBe(true);
    expect(mesh.visibility).toBe(MEASURE_BASE_VISIBILITY);

    restoreMeasureGeometryView(ctx);
    expect(isMeasureGeometryViewActive()).toBe(false);
    expect(mesh._edgesRenderer).toBeNull();
    expect(mesh.visibility).toBe(1);

    scene.dispose();
    engine.dispose();
  });

  it('restores PBR material properties after measure view', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const ctx = makeCtx(scene);
    const mesh = ctx.geometryMeshes[0];
    const pbr = new PBRMaterial('pbr', scene);
    pbr.metallic = 0.75;
    pbr.roughness = 0.25;
    mesh.material = pbr;

    applyMeasureGeometryView(ctx);
    expect(pbr.metallic).toBe(0);
    expect(pbr.roughness).toBe(1);

    restoreMeasureGeometryView(ctx);
    expect(pbr.metallic).toBe(0.75);
    expect(pbr.roughness).toBe(0.25);

    scene.dispose();
    engine.dispose();
  });
});
