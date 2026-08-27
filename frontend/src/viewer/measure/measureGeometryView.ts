import { Color3 } from '@babylonjs/core';
import type { AbstractMesh, Material, PBRMaterial } from '@babylonjs/core';
import type { BabylonViewerCtx } from '../types';
import { collectSceneGeometryMeshes } from '../scene/sceneGeometry';

export const MEASURE_EDGE_EPSILON = 0.92;
export const MEASURE_BASE_VISIBILITY = 0.08;
export const MEASURE_EDGE_COLOR = new Color3(0.4, 0.85, 1);
export const MEASURE_GEOMETRY_PREPARING_HINT = 'Preparing geometry view…';

interface MaterialSnapshot {
  wireframe?: boolean;
  emissiveColor?: Color3;
  emissionColor?: Color3;
  metallic?: number;
  roughness?: number;
  environmentIntensity?: number;
  albedoLevel?: number;
  baseColorLevel?: number;
  metallicLevel?: number;
  bumpLevel?: number;
  emissiveLevel?: number;
}

interface MeshGeometrySnapshot {
  visibility: number;
  edgesEnabledByMeasure: boolean;
  materialSnapshots: MaterialSnapshot[];
}

const meshSnapshots = new WeakMap<AbstractMesh, MeshGeometrySnapshot>();
let active = false;

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

function snapshotMaterial(mat: Material): MaterialSnapshot {
  const snap: MaterialSnapshot = {};
  if ('wireframe' in mat) {
    snap.wireframe = (mat as { wireframe: boolean }).wireframe;
  }
  if ('albedoTexture' in mat) {
    const pbr = mat as PBRMaterial;
    snap.emissiveColor = pbr.emissiveColor?.clone();
    snap.metallic = pbr.metallic;
    snap.roughness = pbr.roughness;
    snap.environmentIntensity = pbr.environmentIntensity;
    snap.albedoLevel = pbr.albedoTexture?.level;
    snap.metallicLevel = pbr.metallicTexture?.level;
    snap.bumpLevel = pbr.bumpTexture?.level;
    snap.emissiveLevel = pbr.emissiveTexture?.level;
  }
  if ('baseColorTexture' in mat) {
    const openPbr = mat as PBRMaterial & {
      baseColorTexture?: { level: number } | null;
      emissionColor?: Color3;
      emissionColorTexture?: { level: number } | null;
    };
    snap.emissionColor = openPbr.emissionColor?.clone();
    snap.baseColorLevel = openPbr.baseColorTexture?.level;
    snap.metallic = openPbr.metallic;
    snap.roughness = openPbr.roughness;
    snap.environmentIntensity = openPbr.environmentIntensity;
  }
  return snap;
}

function snapshotMeshMaterials(mesh: AbstractMesh): MaterialSnapshot[] {
  const snaps: MaterialSnapshot[] = [];
  forEachMaterial(mesh.material, (mat) => snaps.push(snapshotMaterial(mat)));
  return snaps;
}

function restoreMaterial(mat: Material, snap: MaterialSnapshot): void {
  if (snap.wireframe !== undefined && 'wireframe' in mat) {
    (mat as { wireframe: boolean }).wireframe = snap.wireframe;
  }
  if ('albedoTexture' in mat) {
    const pbr = mat as PBRMaterial;
    if (snap.emissiveColor) pbr.emissiveColor = snap.emissiveColor.clone();
    if (snap.metallic !== undefined) pbr.metallic = snap.metallic;
    if (snap.roughness !== undefined) pbr.roughness = snap.roughness;
    if (snap.environmentIntensity !== undefined) pbr.environmentIntensity = snap.environmentIntensity;
    if (snap.albedoLevel !== undefined) setTextureLevel(pbr.albedoTexture, snap.albedoLevel);
    if (snap.metallicLevel !== undefined) setTextureLevel(pbr.metallicTexture, snap.metallicLevel);
    if (snap.bumpLevel !== undefined) setTextureLevel(pbr.bumpTexture, snap.bumpLevel);
    if (snap.emissiveLevel !== undefined) setTextureLevel(pbr.emissiveTexture, snap.emissiveLevel);
  }
  if ('baseColorTexture' in mat) {
    const openPbr = mat as PBRMaterial & {
      baseColorTexture?: { level: number } | null;
      emissionColor?: Color3;
      emissionColorTexture?: { level: number } | null;
    };
    if (snap.emissionColor) openPbr.emissionColor = snap.emissionColor.clone();
    if (snap.metallic !== undefined) openPbr.metallic = snap.metallic;
    if (snap.roughness !== undefined) openPbr.roughness = snap.roughness;
    if (snap.environmentIntensity !== undefined) openPbr.environmentIntensity = snap.environmentIntensity;
    if (snap.baseColorLevel !== undefined) setTextureLevel(openPbr.baseColorTexture, snap.baseColorLevel);
  }
}

function restoreMeshMaterials(mesh: AbstractMesh, snapshots: MaterialSnapshot[]): void {
  let i = 0;
  forEachMaterial(mesh.material, (mat) => {
    const snap = snapshots[i++];
    if (snap) restoreMaterial(mat, snap);
  });
}

/** Dim solid fill so crease edges read clearly on dense Meshy GLBs. */
export function flattenGhostSurfaceMaterial(mat: Material): void {
  if ('wireframe' in mat) {
    (mat as { wireframe: boolean }).wireframe = false;
  }
  if ('albedoTexture' in mat) {
    const pbr = mat as PBRMaterial;
    setTextureLevel(pbr.albedoTexture, 0);
    setTextureLevel(pbr.metallicTexture, 0);
    setTextureLevel(pbr.bumpTexture, 0);
    setTextureLevel(pbr.emissiveTexture, 0);
    setTextureLevel(pbr.ambientTexture, 0);
    setTextureLevel(pbr.lightmapTexture, 0);
    setTextureLevel(pbr.reflectivityTexture, 0);
    setTextureLevel(pbr.microSurfaceTexture, 0);
    pbr.environmentIntensity = 0;
    pbr.metallic = 0;
    pbr.roughness = 1;
    if ('emissiveColor' in pbr) {
      pbr.emissiveColor = Color3.Black();
    }
  }
  if ('baseColorTexture' in mat) {
    const openPbr = mat as PBRMaterial & {
      baseColorTexture?: { level: number } | null;
      emissionColor?: Color3;
      emissionColorTexture?: { level: number } | null;
    };
    setTextureLevel(openPbr.baseColorTexture, 0);
    setTextureLevel(openPbr.emissionColorTexture, 0);
    openPbr.environmentIntensity = 0;
    openPbr.metallic = 0;
    openPbr.roughness = 1;
    if (openPbr.emissionColor) {
      openPbr.emissionColor = Color3.Black();
    }
  }
}

function flattenGhostSurface(mesh: AbstractMesh): void {
  forEachMaterial(mesh.material, flattenGhostSurfaceMaterial);
}

function edgeWidthForDiagonal(diagonal: number): number {
  return Math.min(80, Math.max(20, diagonal * 12));
}

function enableMeshEdges(mesh: AbstractMesh, diagonal: number): void {
  if (!mesh._edgesRenderer) {
    mesh.enableEdgesRendering(MEASURE_EDGE_EPSILON, false, {
      useAlternateEdgeFinder: true,
    });
  }
  const edges = mesh._edgesRenderer;
  if (!edges) return;
  edges.isEnabled = true;
  edges.edgesWidthScalerForPerspective = edgeWidthForDiagonal(diagonal);
  if (edges.lineShader) {
    edges.lineShader.emissiveColor = MEASURE_EDGE_COLOR.clone();
  }
}

export function isMeasureGeometryViewActive(): boolean {
  return active;
}

export function applyMeasureGeometryView(ctx: BabylonViewerCtx): void {
  const meshes = collectSceneGeometryMeshes(ctx);

  for (const mesh of meshes) {
    if (!meshSnapshots.has(mesh)) {
      meshSnapshots.set(mesh, {
        visibility: mesh.visibility,
        edgesEnabledByMeasure: false,
        materialSnapshots: snapshotMeshMaterials(mesh),
      });
    }

    flattenGhostSurface(mesh);
    mesh.visibility = MEASURE_BASE_VISIBILITY;

    const snap = meshSnapshots.get(mesh)!;
    if (!snap.edgesEnabledByMeasure) {
      enableMeshEdges(mesh, ctx.effectiveDiagonal);
      snap.edgesEnabledByMeasure = true;
    } else if (mesh._edgesRenderer) {
      mesh._edgesRenderer.edgesWidthScalerForPerspective = edgeWidthForDiagonal(ctx.effectiveDiagonal);
    }
  }

  active = true;
}

export function restoreMeasureGeometryView(ctx: BabylonViewerCtx): void {
  if (!active) return;

  for (const mesh of collectSceneGeometryMeshes(ctx)) {
    const snap = meshSnapshots.get(mesh);
    if (!snap) continue;

    if (snap.edgesEnabledByMeasure) {
      mesh.disableEdgesRendering();
    }
    mesh.visibility = snap.visibility;
    restoreMeshMaterials(mesh, snap.materialSnapshots);
    meshSnapshots.delete(mesh);
  }

  active = false;
}
