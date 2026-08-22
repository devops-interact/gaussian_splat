import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AbstractMesh, Scene } from '@babylonjs/core';
import { Matrix, MeshBuilder, Quaternion, Vector3 } from '@babylonjs/core';
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

function hierarchyBounds(source: AbstractMesh): { min: Vector3; max: Vector3 } {
  source.computeWorldMatrix(true);
  return source.getHierarchyBoundingVectors(true);
}

/**
 * Create a simplified collision hull for walkthrough mode (uses full hierarchy bounds).
 */
export function createCollisionProxy(scene: Scene, source: AbstractMesh): AbstractMesh {
  const bounds = hierarchyBounds(source);
  const size = bounds.max.subtract(bounds.min);
  const center = bounds.min.add(size.scale(0.5));

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

/** Backend sends row-major 4x4; Babylon Matrix.FromArray expects column-major. */
export function matrixFromRowMajor(rows: number[][]): Matrix {
  const flat = [
    rows[0][0], rows[1][0], rows[2][0], rows[3][0],
    rows[0][1], rows[1][1], rows[2][1], rows[3][1],
    rows[0][2], rows[1][2], rows[2][2], rows[3][2],
    rows[0][3], rows[1][3], rows[2][3], rows[3][3],
  ];
  return Matrix.FromArray(flat);
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

function applyTransformToNode(
  node: import('@babylonjs/core').TransformNode,
  transform: number[][] | undefined,
): void {
  if (!transform || transform.length !== 4) return;
  const matrix = matrixFromRowMajor(transform);
  const scale = new Vector3();
  const rotation = new Quaternion();
  const position = new Vector3();
  matrix.decompose(scale, rotation, position);
  node.position = position;
  node.rotationQuaternion = rotation;
  node.scaling = scale;
}

export async function importComposedScene(
  scene: Scene,
  manifest: import('@/types/job').SceneManifestResponse,
  apiBase: string,
): Promise<{
  rootMesh: AbstractMesh;
  geometryMeshes: AbstractMesh[];
  zoneMeshes: ZoneMeshHandle[];
  emptyZoneIds: number[];
}> {
  const { TransformNode } = await import('@babylonjs/core');
  const roomRoot = new TransformNode('room_root', scene);
  const allGeometry: AbstractMesh[] = [];
  const zoneMeshes: ZoneMeshHandle[] = [];
  const emptyZoneIds: number[] = [];
  let loaded = 0;

  for (const zone of manifest.zones) {
    const url = glbModelUrl(zone.mesh_url, apiBase);
    let buffer: ArrayBuffer;
    try {
      buffer = await fetchModelBuffer(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to load zone ${zone.id}: ${msg}`);
    }

    const zoneNode = new TransformNode(`zone_${zone.id}_root`, scene);
    zoneNode.parent = roomRoot;
    applyTransformToNode(zoneNode, zone.transform);

    const { allMeshes, geometryMeshes } = await importGlbBuffer(scene, buffer, `zone_${zone.id}`);
    for (const mesh of allMeshes) {
      mesh.parent = zoneNode;
      if (mesh.getTotalVertices() > 0) {
        mesh.isPickable = true;
        allGeometry.push(mesh);
        mesh.computeWorldMatrix(true);
        mesh.getBoundingInfo().update(mesh.getWorldMatrix());
      }
    }
    zoneNode.computeWorldMatrix(true);

    if (geometryMeshes.length === 0) {
      emptyZoneIds.push(zone.id);
      console.warn(`[Babylon] Zone ${zone.id} loaded with no visible geometry`);
      continue;
    }

    zoneMeshes.push({
      zoneId: zone.id,
      rootMesh: zoneNode as unknown as AbstractMesh,
      geometryMeshes,
    });
    loaded += 1;
  }

  roomRoot.computeWorldMatrix(true);

  if (loaded === 0) {
    throw new Error('Scene manifest has no loadable zone meshes');
  }

  if (emptyZoneIds.length > 0) {
    console.warn(
      `[Babylon] ${emptyZoneIds.length} zone(s) had no visible geometry: ${emptyZoneIds.join(', ')}`,
    );
  }

  if (manifest.shell_url && allGeometry.length > 0) {
    try {
      const shellUrl = glbModelUrl(manifest.shell_url, apiBase);
      const shellBuf = await fetchModelBuffer(shellUrl);
      const shellNode = new TransformNode('room_shell_root', scene);
      shellNode.parent = roomRoot;
      const { allMeshes: shellMeshes } = await importGlbBuffer(scene, shellBuf, 'room_shell');
      for (const gm of shellMeshes) {
        gm.parent = shellNode;
        gm.isPickable = false;
        gm.visibility = 0.12;
        if (gm.getTotalVertices() > 0) gm.name = 'room_shell';
      }
    } catch (e) {
      console.warn('[Babylon] Room shell load failed:', e);
    }
  }

  return {
    rootMesh: roomRoot as unknown as AbstractMesh,
    geometryMeshes: allGeometry,
    zoneMeshes,
    emptyZoneIds,
  };
}
