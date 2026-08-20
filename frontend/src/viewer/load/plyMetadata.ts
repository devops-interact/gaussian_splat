import type { ModelMetadata } from '../types';
import type { ModelMetadataResponse } from '@/types/job';

export interface PLYMeta {
  positions: Float32Array;
  vertexCount: number;
  totalVertices: number;
  properties: string[];
  format: string;
  hasColors: boolean;
  hasOpacity: boolean;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  center: [number, number, number];
}

/** Fallback PLY header parse when server metadata is unavailable. */
export function parsePLYForMeta(buffer: ArrayBuffer): PLYMeta {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8');

  let headerEnd = -1;
  const searchLimit = Math.min(bytes.length, 20000);
  for (let i = 0; i < searchLimit; i++) {
    if (
      bytes[i] === 0x65 && bytes[i + 1] === 0x6e && bytes[i + 2] === 0x64 &&
      bytes[i + 3] === 0x5f && bytes[i + 4] === 0x68 && bytes[i + 5] === 0x65 &&
      bytes[i + 6] === 0x61 && bytes[i + 7] === 0x64 && bytes[i + 8] === 0x65 &&
      bytes[i + 9] === 0x72
    ) {
      headerEnd = i + 10;
      while (headerEnd < bytes.length && (bytes[headerEnd] === 0x0a || bytes[headerEnd] === 0x0d)) headerEnd++;
      break;
    }
  }
  if (headerEnd === -1) throw new Error('Invalid PLY: no end_header');

  const headerText = decoder.decode(bytes.slice(0, headerEnd));
  const headerLines = headerText.split('\n').map((l) => l.trim());

  let vertexCount = 0;
  let isBinary = false;
  let isLittleEndian = true;
  const properties: { name: string; type: string }[] = [];

  for (const line of headerLines) {
    if (line.startsWith('format binary_little_endian')) { isBinary = true; isLittleEndian = true; }
    else if (line.startsWith('format binary_big_endian')) { isBinary = true; isLittleEndian = false; }
    else if (line.startsWith('format ascii')) { isBinary = false; }
    else if (line.startsWith('element vertex')) { vertexCount = parseInt(line.split(/\s+/)[2], 10); }
    else if (line.startsWith('property')) {
      const parts = line.split(/\s+/);
      properties.push({ type: parts[1], name: parts[2] });
    }
  }

  if (vertexCount === 0) throw new Error('No vertices in PLY');

  const propNames = properties.map((p) => p.name);
  const xIdx = propNames.indexOf('x');
  const yIdx = propNames.indexOf('y');
  const zIdx = propNames.indexOf('z');
  const hasColors = propNames.includes('f_dc_0') || propNames.includes('red');
  const hasOpacity = propNames.includes('opacity');

  const positions = new Float32Array(vertexCount * 3);
  let visibleCount = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  if (isBinary) {
    const dataView = new DataView(buffer, headerEnd);
    const propOffsets: number[] = [];
    let currentOffset = 0;
    for (const prop of properties) {
      propOffsets.push(currentOffset);
      switch (prop.type) {
        case 'float': case 'float32': currentOffset += 4; break;
        case 'double': case 'float64': currentOffset += 8; break;
        case 'uchar': case 'uint8': currentOffset += 1; break;
        default: currentOffset += 4;
      }
    }
    const bytesPerVertex = currentOffset;
    const maxVerts = Math.min(vertexCount, Math.floor((buffer.byteLength - headerEnd) / bytesPerVertex));
    const opacityIdx = propNames.indexOf('opacity');
    const opOff = opacityIdx !== -1 ? propOffsets[opacityIdx] : -1;

    for (let i = 0; i < maxVerts; i++) {
      const vOff = i * bytesPerVertex;
      const x = dataView.getFloat32(vOff + propOffsets[xIdx], isLittleEndian);
      const y = dataView.getFloat32(vOff + propOffsets[yIdx], isLittleEndian);
      const z = dataView.getFloat32(vOff + propOffsets[zIdx], isLittleEndian);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      if (opOff !== -1) {
        const rawOp = dataView.getFloat32(vOff + opOff, isLittleEndian);
        if (1 / (1 + Math.exp(-rawOp)) < 0.005) continue;
      }
      const idx3 = visibleCount * 3;
      positions[idx3] = x; positions[idx3 + 1] = y; positions[idx3 + 2] = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      visibleCount++;
    }
  } else {
    throw new Error('ASCII PLY fallback parse not supported — use server metadata or binary PLY');
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  return {
    positions: positions.slice(0, visibleCount * 3),
    vertexCount: visibleCount,
    totalVertices: vertexCount,
    properties: propNames,
    format: isBinary ? (isLittleEndian ? 'binary_little_endian' : 'binary_big_endian') : 'ascii',
    hasColors,
    hasOpacity,
    boundingBox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    center: [cx, cy, cz],
  };
}

export function modelMetadataFromJobResponse(s: ModelMetadataResponse, fileSize: number): ModelMetadata {
  const bbox = s.bounding_box ?? {
    min: [0, 0, 0] as [number, number, number],
    max: [1, 1, 1] as [number, number, number],
  };
  return {
    vertexCount: s.vertex_count ?? s.point_count ?? 0,
    faceCount: s.face_count ?? 0,
    pointCount: s.point_count ?? s.vertex_count ?? 0,
    fileSize,
    boundingBox: bbox,
    hasColors: s.has_colors ?? false,
    hasPbr: s.has_pbr ?? false,
    hasOpacity: s.has_opacity ?? false,
    properties: s.properties ?? [],
    format: s.format ?? 'glb',
  };
}

export function modelHasSphericalHarmonics(meta: ModelMetadata | ModelMetadataResponse): boolean {
  const props = 'properties' in meta && meta.properties ? meta.properties : [];
  return props.some((p) => /^f_rest_\d+$/.test(p));
}

export function splatModelUrl(modelUrl: string, apiBase: string): string {
  if (modelUrl.startsWith('http')) return modelUrl.replace(/\/model\/?$/, '/model.splat');
  const base = modelUrl.startsWith('/') ? modelUrl : `${apiBase}${modelUrl}`;
  return base.replace(/\/model\/?$/, '/model.splat');
}

export function plyModelUrl(modelUrl: string, apiBase: string): string {
  return modelUrl.startsWith('http') ? modelUrl : `${apiBase}${modelUrl}`;
}
