import type { AbstractMesh } from '@babylonjs/core';
import type { BabylonViewerCtx } from '../types';
import type { InspectionState } from '../inspection/inspectionControls';
import { applyLighting } from '../lighting/sceneLighting';
import { SHELL_VISIBILITY, ZONE_DETAIL_VISIBILITY } from '../load/loadMeshScene';

export interface SceneViewState {
  inspection: InspectionState;
  visibleZones: Set<number>;
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

/** True when shell should be auto-enabled because no zone geometry is available. */
export function shouldAutoShowShell(ctx: BabylonViewerCtx): boolean {
  if (ctx.shellMeshes.length === 0) return false;
  if (ctx.zoneMeshes.length === 0) return true;
  return ctx.zoneMeshes.every((z) => z.geometryMeshes.length === 0);
}

/** Avoid empty visibleZones disabling all room zones before React state syncs. */
export function resolveEffectiveVisibleZones(
  visibleZones: Set<number>,
  zoneMeshes: BabylonViewerCtx['zoneMeshes'],
): Set<number> {
  if (visibleZones.size === 0 && zoneMeshes.length > 0) {
    return new Set(zoneMeshes.map((z) => z.zoneId));
  }
  return visibleZones;
}

/** Single entry point for inspection, shell, zone visibility, and overlays. */
export function applySceneState(ctx: BabylonViewerCtx, state: SceneViewState): void {
  const { scene, geometryMeshes, shellMeshes, zoneMeshes } = ctx;
  const { inspection, visibleZones } = state;

  scene.forceWireframe = inspection.wireframe;

  if (scene.imageProcessingConfiguration) {
    scene.imageProcessingConfiguration.exposure = inspection.exposure;
    scene.imageProcessingConfiguration.isEnabled = true;
  }

  applyLighting(scene, inspection.lighting, inspection.exposure);

  for (const mesh of geometryMeshes) {
    applyMeshMaterialFlags(mesh, inspection);
  }
  for (const mesh of shellMeshes) {
    applyMeshMaterialFlags(mesh, inspection);
  }

  for (const mesh of shellMeshes) {
    mesh.setEnabled(inspection.showShell);
    if (inspection.showShell) {
      mesh.visibility = SHELL_VISIBILITY;
    }
  }

  const effectiveVisibleZones = resolveEffectiveVisibleZones(visibleZones, zoneMeshes);

  for (const { zoneId, rootMesh, geometryMeshes: zoneGeometry } of zoneMeshes) {
    const visible = inspection.showZoneDetail && effectiveVisibleZones.has(zoneId);
    rootMesh.setEnabled(visible);
    for (const gm of zoneGeometry) {
      gm.setEnabled(visible);
      if (visible) {
        gm.visibility = ZONE_DETAIL_VISIBILITY;
      }
    }
  }

  const grid = scene.getMeshByName('viewerGrid');
  if (grid) grid.setEnabled(inspection.showGrid);

  for (const name of ['axisX', 'axisY', 'axisZ']) {
    const axis = scene.getMeshByName(name);
    if (axis) axis.setEnabled(inspection.showAxes);
  }
}
