import { AxesViewer, MeshBuilder, Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial';

export function addSceneOverlays(scene: Scene): void {
  const half = 15;
  const ground = MeshBuilder.CreateGround('viewerGrid', { width: half * 2, height: half * 2, subdivisions: 1 }, scene);
  ground.position.y = -0.01;
  ground.isPickable = false;
  ground.renderingGroupId = 1;

  const gridMat = new GridMaterial('viewerGridMat', scene);
  gridMat.majorUnitFrequency = 5;
  gridMat.minorUnitVisibility = 0.35;
  gridMat.gridRatio = 1;
  gridMat.backFaceCulling = false;
  gridMat.mainColor.set(0.11, 0.1, 0.06);
  gridMat.lineColor.set(0.18, 0.16, 0.1);
  gridMat.opacity = 0.85;
  ground.material = gridMat;

  new AxesViewer(scene, 1.5, 1);
}

export { Vector3 };
