import { Color3 } from '@babylonjs/core';
import type { AbstractMesh, Material, PBRMaterial } from '@babylonjs/core';
import type { BabylonViewerCtx } from '../types';
import type { InspectionState } from '../inspection/inspectionControls';
import { applyLighting } from '../lighting/sceneLighting';
import { SHELL_VISIBILITY, ZONE_DETAIL_VISIBILITY } from '../load/loadMeshScene';
import {
  applyMeasureGeometryView,
  isMeasureGeometryViewActive,
  MEASURE_BASE_VISIBILITY,
  restoreMeasureGeometryView,
} from '../measure/measureGeometryView';
import { collectSceneGeometryMeshes } from '../scene/sceneGeometry';

export { collectSceneGeometryMeshes } from '../scene/sceneGeometry';

export interface SceneViewState {
  inspection: InspectionState;
  visibleZones: Set<number>;
  measureGeometry?: boolean;
}

const WIREFRAME_EMISSIVE = new Color3(0.8, 0.8, 0.8);

function forEachMaterial(mat: Material | null | undefined, fn: (material: Material) => void): void {
  if (!mat) return;
  if (mat.getClassName?.() === 'MultiMaterial' && 'subMaterials' in mat) {
    for (const sub of (mat as { subMaterials: (Material | null)[] }).subMaterials) {
      if (sub) fn(sub);
    }
    return;
  }
  fn(mat);
}

function setTextureLevel(texture: { level: number } | null | undefined, level: number): void {
  if (texture) texture.level = level;
}

function applyMaterialFlags(mat: Material, state: InspectionState, measureGeometry: boolean): void {
  if ('wireframe' in mat && !measureGeometry) {
    (mat as { wireframe: boolean }).wireframe = state.wireframe;
  }

  if ('albedoTexture' in mat) {
    const pbr = mat as PBRMaterial;
    const textureLevel = state.textures ? 1 : 0;
    setTextureLevel(pbr.albedoTexture, textureLevel);
    setTextureLevel(pbr.metallicTexture, textureLevel);
    setTextureLevel(pbr.bumpTexture, textureLevel);
    setTextureLevel(pbr.emissiveTexture, textureLevel);
    setTextureLevel(pbr.ambientTexture, textureLevel);
    setTextureLevel(pbr.lightmapTexture, textureLevel);
    setTextureLevel(pbr.reflectivityTexture, textureLevel);
    setTextureLevel(pbr.microSurfaceTexture, textureLevel);
    pbr.environmentIntensity = state.pbr ? state.lighting.envIntensity : 0;
    pbr.metallic = state.pbr ? (pbr.metallic ?? 0.5) : 0;
    pbr.roughness = state.pbr ? (pbr.roughness ?? 0.8) : 1;
    if (state.wireframe && !state.textures && 'emissiveColor' in pbr) {
      pbr.emissiveColor = WIREFRAME_EMISSIVE;
    }
  }

  if ('baseColorTexture' in mat && !measureGeometry) {
    const openPbr = mat as PBRMaterial & {
      baseColorTexture?: { level: number } | null;
      baseMetalnessTexture?: { level: number } | null;
      normalTexture?: { level: number } | null;
    };
    const textureLevel = state.textures ? 1 : 0;
    setTextureLevel(openPbr.baseColorTexture, textureLevel);
    setTextureLevel(openPbr.baseMetalnessTexture, textureLevel);
    setTextureLevel(openPbr.normalTexture, textureLevel);
    openPbr.environmentIntensity = state.pbr ? state.lighting.envIntensity : 0;
    openPbr.metallic = state.pbr ? (openPbr.metallic ?? 0.5) : 0;
    openPbr.roughness = state.pbr ? (openPbr.roughness ?? 0.8) : 1;
  }
}

function applyMeshMaterialFlags(mesh: AbstractMesh, state: InspectionState, measureGeometry: boolean): void {
  forEachMaterial(mesh.material, (mat) => applyMaterialFlags(mat, state, measureGeometry));
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
  const { scene, shellMeshes, zoneMeshes } = ctx;
  const { inspection, visibleZones, measureGeometry = false } = state;

  if (measureGeometry) {
    if (!isMeasureGeometryViewActive()) {
      applyMeasureGeometryView(ctx);
    }
    scene.forceWireframe = false;
  } else {
    if (isMeasureGeometryViewActive()) {
      restoreMeasureGeometryView(ctx);
    }
    scene.forceWireframe = inspection.wireframe;
  }

  if (scene.imageProcessingConfiguration) {
    scene.imageProcessingConfiguration.exposure = inspection.exposure;
    scene.imageProcessingConfiguration.isEnabled = true;
  }

  applyLighting(scene, inspection.lighting, inspection.exposure);

  if (!measureGeometry) {
    for (const mesh of collectSceneGeometryMeshes(ctx)) {
      applyMeshMaterialFlags(mesh, inspection, false);
    }
  }

  for (const mesh of shellMeshes) {
    mesh.setEnabled(inspection.showShell);
    if (inspection.showShell) {
      mesh.visibility = measureGeometry ? MEASURE_BASE_VISIBILITY : SHELL_VISIBILITY;
    }
  }

  const effectiveVisibleZones = resolveEffectiveVisibleZones(visibleZones, zoneMeshes);

  for (const { zoneId, rootMesh, geometryMeshes: zoneGeometry } of zoneMeshes) {
    const visible = inspection.showZoneDetail && effectiveVisibleZones.has(zoneId);
    rootMesh.setEnabled(visible);
    for (const gm of zoneGeometry) {
      gm.setEnabled(visible);
      if (visible) {
        gm.visibility = measureGeometry ? MEASURE_BASE_VISIBILITY : ZONE_DETAIL_VISIBILITY;
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
