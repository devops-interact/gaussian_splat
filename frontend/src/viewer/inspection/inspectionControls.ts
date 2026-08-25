import type { AbstractMesh } from '@babylonjs/core';
import type { BabylonViewerCtx } from '../types';
import type { LightingState } from '../lighting/sceneLighting';
import { applySceneState, type SceneViewState } from '../controller/applySceneState';

export interface InspectionState {
  wireframe: boolean;
  textures: boolean;
  pbr: boolean;
  exposure: number;
  lighting: LightingState;
  showGrid: boolean;
  showAxes: boolean;
  showShell: boolean;
  showZoneDetail: boolean;
}

export const DEFAULT_INSPECTION: InspectionState = {
  wireframe: false,
  textures: true,
  pbr: true,
  exposure: 1,
  lighting: {
    hemiIntensity: 0.9,
    dirIntensity: 0.65,
    envIntensity: 1,
  },
  showGrid: false,
  showAxes: true,
  showShell: false,
  showZoneDetail: true,
};

/** @deprecated Use applySceneState with visibleZones instead. */
export function applyInspectionState(ctx: BabylonViewerCtx, state: InspectionState): void {
  const allZoneIds = new Set(ctx.zoneMeshes.map((z) => z.zoneId));
  applySceneState(ctx, { inspection: state, visibleZones: allZoneIds });
}

export function collectGeometryMeshes(ctx: BabylonViewerCtx): AbstractMesh[] {
  return [...ctx.geometryMeshes, ...ctx.shellMeshes];
}

export type { SceneViewState };
