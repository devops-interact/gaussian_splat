import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { GaussianSplattingMesh } from '@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMesh';
import type { Scene } from '@babylonjs/core';
import '@babylonjs/loaders/SPLAT/splatFileLoader';
import { ADD_SPLAT_SCENE_TIMEOUT_MS } from '../constants';

export type ModelFileKind = 'splat' | 'ply';

export interface LoadSplatResult {
  splatMesh: GaussianSplattingMesh;
  fileKind: ModelFileKind;
  fileSize: number;
}

export async function importSplatBuffer(
  scene: Scene,
  buffer: ArrayBuffer,
  fileKind: ModelFileKind,
): Promise<LoadSplatResult> {
  const ext = fileKind === 'splat' ? '.splat' : '.ply';
  const name = fileKind === 'splat' ? 'model.splat' : 'model.ply';
  const file = new File([buffer], name, { type: 'application/octet-stream' });

  const loadPromise = ImportMeshAsync(file, scene, {
    pluginExtension: ext,
    pluginOptions: { splat: { keepInRam: true } },
  });
  const loadTimeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => {
      reject(new Error(`Splat load timed out after ${ADD_SPLAT_SCENE_TIMEOUT_MS / 1000}s.`));
    }, ADD_SPLAT_SCENE_TIMEOUT_MS);
  });

  const result = await Promise.race([loadPromise, loadTimeout]);
  const splatMesh = result.meshes.find(
    (m): m is GaussianSplattingMesh => (m as GaussianSplattingMesh).getClassName?.() === 'GaussianSplattingMesh',
  ) ?? (result.meshes[0] as GaussianSplattingMesh);

  if (!splatMesh) throw new Error('No GaussianSplattingMesh returned from import');

  return { splatMesh, fileKind, fileSize: buffer.byteLength };
}

export function isPlyBuffer(buffer: ArrayBuffer): boolean {
  const b0 = new Uint8Array(buffer, 0, Math.min(3, buffer.byteLength));
  return b0.length >= 3 && b0[0] === 0x70 && b0[1] === 0x6c && b0[2] === 0x79;
}

export function isGzipBuffer(buffer: ArrayBuffer): boolean {
  const b0 = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  return b0.length >= 2 && b0[0] === 0x1f && b0[1] === 0x8b;
}

export async function fetchModelBuffer(
  url: string,
  signal?: AbortSignal,
  onProgress?: (pct: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url, signal != null ? { signal } : {});
  if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status}`);

  const len = response.headers.get('content-length');
  const total = len ? parseInt(len, 10) : 0;
  if (!response.body || total <= 0 || !onProgress) {
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(Math.min(99, Math.round((received / total) * 100)));
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  onProgress(100);
  return out.buffer;
}
