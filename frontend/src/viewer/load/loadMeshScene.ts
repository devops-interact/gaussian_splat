import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AbstractMesh, Scene } from '@babylonjs/core';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/loaders/glTF/glTFFileLoader';
import '@babylonjs/loaders/glTF/2.0/glTFLoader';
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
): Promise<{ rootMesh: AbstractMesh; allMeshes: AbstractMesh[] }> {
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
    const root = result.meshes[0];
    if (!root) {
      throw new Error('GLB import produced no meshes');
    }

    for (const mesh of meshes) {
      mesh.isPickable = true;
    }

    return { rootMesh: root, allMeshes: meshes };
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
