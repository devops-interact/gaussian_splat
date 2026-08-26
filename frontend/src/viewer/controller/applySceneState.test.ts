import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AbstractMesh } from '@babylonjs/core';
import { applySceneState, resolveEffectiveVisibleZones } from './applySceneState';
import { DEFAULT_INSPECTION } from '../inspection/inspectionControls';
import type { BabylonViewerCtx } from '../types';

function makeCtx(scene: Scene): BabylonViewerCtx {
  const zone0 = MeshBuilder.CreateBox('zone0', { size: 1 }, scene);
  const zone1 = MeshBuilder.CreateBox('zone1', { size: 1 }, scene);
  zone1.position.x = 3;
  const shell = MeshBuilder.CreateBox('room_shell', { size: 4 }, scene);

  return {
    engine: scene.getEngine(),
    scene,
    orbitCamera: null as never,
    walkCamera: null as never,
    rootMesh: null,
    geometryMeshes: [zone0, zone1],
    shellMeshes: [shell],
    zoneMeshes: [
      { zoneId: 0, rootMesh: zone0, geometryMeshes: [zone0] },
      { zoneId: 1, rootMesh: zone1, geometryMeshes: [zone1] },
    ],
    collisionMesh: null,
    utilityLayer: null as never,
    framingBehavior: null as never,
    floorY: 0,
    effectiveDiagonal: 4,
    roomBounds: {
      min: new Vector3(-2, -2, -2),
      max: new Vector3(4, 2, 2),
      diagonal: 6,
    },
    walkPath: null,
  };
}

describe('resolveEffectiveVisibleZones', () => {
  it('defaults to all zone ids when visibleZones is empty', () => {
    const zones = resolveEffectiveVisibleZones(new Set(), [
      { zoneId: 0, rootMesh: null as never, geometryMeshes: [] },
      { zoneId: 2, rootMesh: null as never, geometryMeshes: [] },
    ]);
    expect([...zones].sort()).toEqual([0, 2]);
  });

  it('preserves explicit zone toggles', () => {
    const zones = resolveEffectiveVisibleZones(new Set([1]), [
      { zoneId: 0, rootMesh: null as never, geometryMeshes: [] },
      { zoneId: 1, rootMesh: null as never, geometryMeshes: [] },
    ]);
    expect([...zones]).toEqual([1]);
  });
});

describe('applySceneState', () => {
  it('respects per-zone visibility when inspection lighting changes', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const ctx = makeCtx(scene);

    applySceneState(ctx, {
      inspection: { ...DEFAULT_INSPECTION, showZoneDetail: true, showShell: false },
      visibleZones: new Set([0]),
    });

    expect(ctx.zoneMeshes[0].geometryMeshes[0].isEnabled()).toBe(true);
    expect(ctx.zoneMeshes[1].geometryMeshes[0].isEnabled()).toBe(false);

    applySceneState(ctx, {
      inspection: { ...DEFAULT_INSPECTION, exposure: 1.5, showZoneDetail: true, showShell: false },
      visibleZones: new Set([0]),
    });

    expect(ctx.zoneMeshes[0].geometryMeshes[0].isEnabled()).toBe(true);
    expect(ctx.zoneMeshes[1].geometryMeshes[0].isEnabled()).toBe(false);

    scene.dispose();
    engine.dispose();
  });

  it('keeps all zones visible when visibleZones is empty on first apply', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const ctx = makeCtx(scene);

    applySceneState(ctx, {
      inspection: { ...DEFAULT_INSPECTION, showZoneDetail: true, showShell: false },
      visibleZones: new Set(),
    });

    expect(ctx.zoneMeshes[0].geometryMeshes[0].isEnabled()).toBe(true);
    expect(ctx.zoneMeshes[1].geometryMeshes[0].isEnabled()).toBe(true);

    scene.dispose();
    engine.dispose();
  });

  it('toggles all shell meshes together', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const shellA = MeshBuilder.CreateBox('room_shell', { size: 2 }, scene);
    const shellB = MeshBuilder.CreateBox('room_shell', { size: 2 }, scene);
    shellB.position.y = 2;

    const ctx: BabylonViewerCtx = {
      ...makeCtx(scene),
      shellMeshes: [shellA, shellB],
    };

    applySceneState(ctx, {
      inspection: { ...DEFAULT_INSPECTION, showShell: true },
      visibleZones: new Set([0, 1]),
    });
    expect(shellA.isEnabled()).toBe(true);
    expect(shellB.isEnabled()).toBe(true);

    applySceneState(ctx, {
      inspection: { ...DEFAULT_INSPECTION, showShell: false },
      visibleZones: new Set([0, 1]),
    });
    expect(shellA.isEnabled()).toBe(false);
    expect(shellB.isEnabled()).toBe(false);

    scene.dispose();
    engine.dispose();
  });
});

describe('applySceneState shell under room root', () => {
  it('keeps parented shell pickable when enabled', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const roomRoot = new TransformNode('room_root', scene);
    const shell = MeshBuilder.CreateBox('room_shell', { size: 2 }, scene);
    shell.parent = roomRoot;
    shell.isPickable = true;
    shell.computeWorldMatrix(true);

    const ctx: BabylonViewerCtx = {
      ...makeCtx(scene),
      shellMeshes: [shell as AbstractMesh],
      zoneMeshes: [],
      geometryMeshes: [],
    };

    applySceneState(ctx, {
      inspection: { ...DEFAULT_INSPECTION, showShell: true },
      visibleZones: new Set(),
    });

    expect(shell.isEnabled()).toBe(true);
    expect(shell.isPickable).toBe(true);

    scene.dispose();
    engine.dispose();
  });
});
