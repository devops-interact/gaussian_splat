import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AbstractMesh, Scene } from '@babylonjs/core';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import axios from 'axios';
import { isCancel } from 'axios';
import { getAuthHeaders } from '@/lib/authHeaders';

const MODEL_FETCH_TIMEOUT_MS = 120_000;

export async function fetchModelBuffer(
  url: string,
  signal?: AbortSignal,
  onProgress?: (pct: number) => void,
): Promise<ArrayBuffer> {
  const resp = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: MODEL_FETCH_TIMEOUT_MS,
    signal,
    headers: { ...getAuthHeaders() },
    onDownloadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
  return resp.data;
}

export async function importGlbBuffer(
  scene: Scene,
  buffer: ArrayBuffer,
  name: string = 'room_mesh',
): Promise<{ rootMesh: AbstractMesh; allMeshes: AbstractMesh[]; geometryMeshes: AbstractMesh[] }> {
  const magic = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  const isGlb =
    magic.length === 4 &&
    magic[0] === 0x67 &&
    magic[1] === 0x6c &&
    magic[2] === 0x54 &&
    magic[3] === 0x46;
  if (!isGlb) {
    throw new Error('Model response is not a valid GLB file (check API proxy or auth)');
  }

  const blob = new Blob([buffer], { type: 'model/gltf-binary' });
  const file = URL.createObjectURL(blob);

  try {
    const result = await ImportMeshAsync(file, scene, {
      pluginExtension: '.glb',
      name,
    });

    const meshes = result.meshes.filter((m) => m.isVisible);
    const geometryMeshes = meshes.filter((m) => m.getTotalVertices() > 0);
    const root = geometryMeshes[0] ?? meshes[0];
    if (!root) {
      throw new Error('GLB import produced no meshes');
    }

    for (const mesh of meshes) {
      mesh.isPickable = true;
    }

    return { rootMesh: root, allMeshes: meshes, geometryMeshes };
  } finally {
    URL.revokeObjectURL(file);
  }
}

/**
 * Create a simplified collision hull for walkthrough mode.
 */
export function createCollisionProxy(scene: Scene, source: AbstractMesh): AbstractMesh {
  const bounds = source.getBoundingInfo().boundingBox;
  const size = bounds.maximumWorld.subtract(bounds.minimumWorld);
  const center = bounds.minimumWorld.add(size.scale(0.5));

  const box = MeshBuilder.CreateBox(
    'collision_proxy',
    {
      width: Math.max(size.x, 0.1),
      height: Math.max(size.y, 0.1),
      depth: Math.max(size.z, 0.1),
    },
    scene,
  );
  box.position.copyFrom(center);
  box.isVisible = false;
  box.isPickable = false;
  box.checkCollisions = true;
  return box;
}

export function glbModelUrl(modelUrl: string, apiBase: string): string {
  if (modelUrl.startsWith('http')) return modelUrl;
  const base = apiBase.replace(/\/$/, '');
  const path = modelUrl.startsWith('/') ? modelUrl : `/${modelUrl}`;
  return `${base}${path}`;
}

export function modelMetadataFromJobResponse(
  meta: import('@/types/job').ModelMetadataResponse,
  fileSize: number,
): import('../types').ModelMetadata {
  const verts = meta.vertex_count ?? 0;
  const faces = meta.face_count ?? 0;
  return {
    vertexCount: verts,
    faceCount: faces,
    pointCount: verts,
    fileSize: meta.file_size ?? fileSize,
    boundingBox: meta.bounding_box ?? { min: [-1, -1, -1], max: [1, 1, 1] },
    hasColors: meta.has_colors ?? true,
    hasPbr: meta.has_pbr ?? false,
    format: meta.format ?? 'glb',
  };
}

export { isCancel };

export interface ZoneMeshHandle {
  zoneId: number;
  rootMesh: AbstractMesh;
  geometryMeshes: AbstractMesh[];
}

export async function importComposedScene(
  scene: Scene,
  manifest: import('@/types/job').SceneManifestResponse,
  apiBase: string,
): Promise<{ rootMesh: AbstractMesh; geometryMeshes: AbstractMesh[]; zoneMeshes: ZoneMeshHandle[] }> {
  const { TransformNode, Matrix, Vector3, Quaternion } = await import('@babylonjs/core');
  const roomRoot = new TransformNode('room_root', scene);
  const allGeometry: AbstractMesh[] = [];
  const zoneMeshes: ZoneMeshHandle[] = [];

  for (const zone of manifest.zones) {
    const url = glbModelUrl(zone.mesh_url, apiBase);
    const buffer = await fetchModelBuffer(url);
    const { rootMesh, geometryMeshes } = await importGlbBuffer(scene, buffer, `zone_${zone.id}`);
    rootMesh.parent = roomRoot;

    if (zone.transform?.length === 4) {
      const matrix = Matrix.FromArray(zone.transform.flat());
      const scale = new Vector3();
      const rotation = new Quaternion();
      const position = new Vector3();
      matrix.decompose(scale, rotation, position);
      rootMesh.position = position;
      rootMesh.rotationQuaternion = rotation;
      rootMesh.scaling = scale;
    }

    for (const gm of geometryMeshes) {
      gm.isPickable = true;
      allGeometry.push(gm);
    }
    zoneMeshes.push({ zoneId: zone.id, rootMesh, geometryMeshes });
  }

  if (manifest.shell_url) {
    try {
      const shellUrl = glbModelUrl(manifest.shell_url, apiBase);
      const shellBuf = await fetchModelBuffer(shellUrl);
      const { rootMesh: shellRoot, geometryMeshes: shellGeo } = await importGlbBuffer(
        scene, shellBuf, 'room_shell',
      );
      shellRoot.parent = roomRoot;
      shellRoot.name = 'room_shell';
      for (const gm of shellGeo) {
        gm.isPickable = false;
      }
    } catch (e) {
      console.warn('[Babylon] Room shell load failed:', e);
    }
  }

  return {
    rootMesh: roomRoot as unknown as AbstractMesh,
    geometryMeshes: allGeometry,
    zoneMeshes,
  };
}
