import type { AbstractMesh } from '@babylonjs/core';
import type { BabylonViewerCtx } from '../types';
import type { LightingState } from '../lighting/sceneLighting';
import { applyLighting } from '../lighting/sceneLighting';
import { ZONE_DETAIL_VISIBILITY } from '../load/loadMeshScene';

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
  showGrid: true,
  showAxes: true,
  showShell: true,
  showZoneDetail: true,
};

export function applyInspectionState(ctx: BabylonViewerCtx, state: InspectionState): void {
  const { scene, geometryMeshes } = ctx;

  scene.forceWireframe = state.wireframe;

  if (scene.imageProcessingConfiguration) {
    scene.imageProcessingConfiguration.exposure = state.exposure;
    scene.imageProcessingConfiguration.isEnabled = true;
  }

  applyLighting(scene, state.lighting, state.exposure);

  for (const mesh of geometryMeshes) {
    applyMeshMaterialFlags(mesh, state);
  }

  const shell = scene.getMeshByName('room_shell');
  if (shell) shell.setEnabled(state.showShell);

  for (const { geometryMeshes } of ctx.zoneMeshes) {
    for (const mesh of geometryMeshes) {
      mesh.setEnabled(state.showZoneDetail);
      if (state.showZoneDetail) {
        mesh.visibility = ZONE_DETAIL_VISIBILITY;
      }
    }
  }

  const grid = scene.getMeshByName('viewerGrid');
  if (grid) grid.setEnabled(state.showGrid);

  // AxesViewer meshes are named axisX, axisY, axisZ
  for (const name of ['axisX', 'axisY', 'axisZ']) {
    const axis = scene.getMeshByName(name);
    if (axis) axis.setEnabled(state.showAxes);
  }
}

function applyMeshMaterialFlags(mesh: AbstractMesh, state: InspectionState): void {
  const mat = mesh.material;
  if (!mat) return;

  if ('wireframe' in mat) {
    (mat as { wireframe: boolean }).wireframe = state.wireframe;
  }

  if ('albedoTexture' in mat) {
    const pbr = mat as import('@babylonjs/core').PBRMaterial;
    if (pbr.albedoTexture) {
      pbr.albedoTexture.level = state.textures ? 1 : 0;
    }
    if ('metallicTexture' in mat || 'reflectivityTexture' in mat) {
      pbr.environmentIntensity = state.pbr ? state.lighting.envIntensity : 0;
    }
    if ('useSpecularOverAlpha' in mat) {
      pbr.metallic = state.pbr ? (pbr.metallic ?? 0.5) : 0;
      pbr.roughness = state.pbr ? (pbr.roughness ?? 0.8) : 1;
    }
  }
}

export function collectGeometryMeshes(ctx: BabylonViewerCtx): AbstractMesh[] {
  return ctx.geometryMeshes;
}
