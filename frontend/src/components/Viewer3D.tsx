import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Viewer, SceneRevealMode, LogLevel, PlyLoader, KSplatLoader } from '@mkkellogg/gaussian-splats-3d';
import { isAxiosError, isCancel } from 'axios';
import { getApiBaseUrl } from '@/lib/apiBase';
import type { InitialCameraResponse } from '@/api/jobs';
import { getInitialCamera } from '@/api/jobs';
import type { ModelMetadataResponse } from '@/types/job';
import {
  buildCenterGridAcceleration,
  buildSplatCenterWorldCache,
  maxSplatPickDistance,
  pickSplatMeasure,
  type PickResult,
  type SplatCenterGridAccel,
  type SplatMeshWithCenters,
} from '@/lib/splatPick';
import { cn } from '@/lib/utils';
import {
  Camera,
  Ruler,
  RotateCcw,
  Footprints,
  MousePointer,
  X,
  Info,
  Trash2,
  CircleDot,
  SlidersHorizontal,
  Download,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Viewer3DProps {
  modelUrl: string | null;
  /** When set, viewer may load `/api/jobs/{jobId}/initial_camera` for pose-based default framing. */
  jobId?: string | null;
  /** From job status API when the job completes — skips full PLY vertex parse for bbox/metadata. */
  prefetchedJobModelMetadata?: ModelMetadataResponse | null;
  onModelMetadata?: (meta: ModelMetadata) => void;
}

export interface ModelMetadata {
  pointCount: number;
  fileSize: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  hasColors: boolean;
  hasOpacity: boolean;
  properties: string[];
  format: string;
}

type ViewerMode = 'orbit' | 'walkthrough' | 'measure';

interface MeasurePoint {
  position: THREE.Vector3;
}

type MeasurePhase = 'calibrate' | 'measure';

interface CalibrationState {
  points: MeasurePoint[];
  rawDistance: number;
  realMeters: number;
  scaleFactor: number;
}

/** Use progressive PLY loading in GaussianSplats3D when splat count is high (trades peak perf for time-to-first-frame). */
const PROGRESSIVE_VERTEX_THRESHOLD = 50_000;

/** Bbox fallback camera: eye distance scales as diagonal × mult (lower = closer / fills frame more). */
const BBOX_CAM_DIST_MULT = 0.92;
/** Floor so tiny reconstructions are not framed from too far away (world units). */
const BBOX_CAM_DIST_MIN = 1.75;
/** Initial splat ellipsoid scale before user adjusts Display panel (1 = library default). */
const DEFAULT_SPLAT_SCALE = 1.25;

/** Measure-mode hover: ms between picks; larger reduces main-thread / scene churn. */
const MEASURE_HOVER_MIN_MS = 100;
/** Skip rebuilding measure preview if pick moved less than this (world units). */
const MEASURE_PREVIEW_MOVE_EPS = 0.03;

const PLY_FETCH_TIMEOUT_MS = 120_000;
const ADD_SPLAT_SCENE_TIMEOUT_MS = 90_000;

function plyFetchAbortSignal(): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(PLY_FETCH_TIMEOUT_MS);
  }
  return undefined;
}

function forceLegacyGs3dWorkers(): boolean {
  const v = import.meta.env.VITE_GS3D_FORCE_LEGACY_WORKERS;
  return v === '1' || String(v).toLowerCase() === 'true';
}

const VIEWER_SCENE_SCALE_MIN = 0.25;
const VIEWER_SCENE_SCALE_MAX = 10;

/** Uniform world scale for splat mesh + camera (Vite build-time). 1 = default. */
function parseViewerSceneScale(): number {
  const raw = import.meta.env.VITE_VIEWER_SCENE_SCALE;
  if (raw === undefined || raw === '') return 1;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return 1;
  return THREE.MathUtils.clamp(n, VIEWER_SCENE_SCALE_MIN, VIEWER_SCENE_SCALE_MAX);
}

/** Orbit dolly limits vs effective scene diagonal (after mesh scale). */
const ORBIT_MIN_DIST_FRAC = 0.035;
const ORBIT_MAX_DIST_MULT = 150;

function applyOrbitZoomLimitsFromDiagonal(viewer: Viewer, effectiveDiagonal: number): void {
  if (!(effectiveDiagonal > 0)) return;
  const ctrl = (viewer as unknown as { controls?: unknown }).controls;
  if (!ctrl || typeof ctrl !== 'object') {
    console.info('[GS3D] Orbit controls missing — skip zoom limit patch');
    return;
  }
  const minD = Math.max(1e-4, effectiveDiagonal * ORBIT_MIN_DIST_FRAC);
  const maxD = Math.max(minD * 2, effectiveDiagonal * ORBIT_MAX_DIST_MULT);
  const c = ctrl as Record<string, unknown>;
  try {
    if ('minDistance' in c) {
      (c as { minDistance: number }).minDistance = minD;
    }
    if ('maxDistance' in c) {
      (c as { maxDistance: number }).maxDistance = maxD;
    }
    const upd = (c as { update?: () => void }).update;
    if (typeof upd === 'function') upd.call(ctrl);
    console.log('[GS3D] Orbit limits', {
      minDistance: minD.toFixed(4),
      maxDistance: maxD.toFixed(2),
      effectiveDiagonal: effectiveDiagonal.toFixed(2),
    });
  } catch (e) {
    console.warn('[GS3D] Could not patch orbit limits:', e);
  }
}

/** Scale camera offset from lookAt (keeps target fixed when scaling position alone). */
function scaleCameraPairFromOrigin(
  position: [number, number, number],
  lookAt: [number, number, number],
  scale: number,
): { position: [number, number, number]; lookAt: [number, number, number] } {
  if (scale === 1) {
    return { position: [...position] as [number, number, number], lookAt: [...lookAt] as [number, number, number] };
  }
  return {
    position: [
      lookAt[0] + (position[0] - lookAt[0]) * scale,
      lookAt[1] + (position[1] - lookAt[1]) * scale,
      lookAt[2] + (position[2] - lookAt[2]) * scale,
    ],
    lookAt: [...lookAt] as [number, number, number],
  };
}

function modelMetadataFromJobResponse(s: ModelMetadataResponse, fileSize: number): ModelMetadata {
  const bbox = s.bounding_box ?? {
    min: [0, 0, 0] as [number, number, number],
    max: [1, 1, 1] as [number, number, number],
  };
  return {
    pointCount: s.point_count ?? 0,
    fileSize,
    boundingBox: bbox,
    hasColors: s.has_colors ?? false,
    hasOpacity: s.has_opacity ?? false,
    properties: s.properties ?? [],
    format: s.format ?? 'gaussian_splat',
  };
}

function removeMeasurePreviewFromScene(scene: THREE.Scene) {
  const toRemove: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData.__measurePreview) toRemove.push(o);
  });
  for (const obj of toRemove) {
    scene.remove(obj);
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry.dispose();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else (mat as THREE.Material).dispose();
    }
  }
}

const MEASURE_PICK_HINT_IDLE = 'Move over the model…';

interface MeasurePreviewOptions {
  previousWorld?: THREE.Vector3 | null;
}

function setMeasurePreviewInScene(
  scene: THREE.Scene,
  pick: PickResult | null,
  camera: THREE.PerspectiveCamera,
  options?: MeasurePreviewOptions,
) {
  removeMeasurePreviewFromScene(scene);
  if (!pick) return;

  const { position, isSnapped } = pick;
  const color = isSnapped ? 0xefe752 : 0xff6b6b;
  const camDist = camera.position.distanceTo(position);
  const scale = Math.max(0.01, camDist * 0.012);

  // Ring indicator
  const ringGeo = new THREE.RingGeometry(scale * 0.5, scale, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: isSnapped ? 0.75 : 0.4,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(position);
  ring.lookAt(camera.position);
  ring.userData.__measurePreview = true;
  scene.add(ring);

  // Crosshair lines through the ring center
  const halfLen = scale * 1.2;
  const lineColor = isSnapped ? 0xefe752 : 0xff6b6b;
  const lineMat = new THREE.LineBasicMaterial({
    color: lineColor,
    transparent: true,
    opacity: isSnapped ? 0.6 : 0.3,
    depthTest: false,
    depthWrite: false,
  });

  const up = new THREE.Vector3(0, 1, 0);
  const toCamera = new THREE.Vector3().subVectors(camera.position, position).normalize();
  const right = new THREE.Vector3().crossVectors(toCamera, up).normalize();
  const localUp = new THREE.Vector3().crossVectors(right, toCamera).normalize();

  const hPts = [
    position.clone().addScaledVector(right, -halfLen),
    position.clone().addScaledVector(right, halfLen),
  ];
  const hGeo = new THREE.BufferGeometry().setFromPoints(hPts);
  const hLine = new THREE.Line(hGeo, lineMat);
  hLine.userData.__measurePreview = true;
  scene.add(hLine);

  const vPts = [
    position.clone().addScaledVector(localUp, -halfLen),
    position.clone().addScaledVector(localUp, halfLen),
  ];
  const vGeo = new THREE.BufferGeometry().setFromPoints(vPts);
  const vLine = new THREE.Line(vGeo, lineMat.clone());
  vLine.userData.__measurePreview = true;
  scene.add(vLine);

  // Small center dot for precision
  const dotGeo = new THREE.SphereGeometry(scale * 0.15, 8, 8);
  const dotMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: isSnapped ? 0.9 : 0.5,
    depthTest: false,
    depthWrite: false,
  });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.position.copy(position);
  dot.userData.__measurePreview = true;
  scene.add(dot);

  if (isSnapped) {
    const ghostGeo = new THREE.SphereGeometry(0.012, 12, 12);
    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0xefe752,
      transparent: true,
      opacity: 0.34,
      depthTest: false,
      depthWrite: false,
    });
    const ghost = new THREE.Mesh(ghostGeo, ghostMat);
    ghost.position.copy(position);
    ghost.userData.__measurePreview = true;
    scene.add(ghost);
  }

  const prev = options?.previousWorld;
  if (isSnapped && prev) {
    const dashGeo = new THREE.BufferGeometry().setFromPoints([prev.clone(), position.clone()]);
    const dashMat = new THREE.LineDashedMaterial({
      color: 0xf5ec99,
      dashSize: 0.045,
      gapSize: 0.03,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
    });
    const dashLine = new THREE.Line(dashGeo, dashMat);
    dashLine.computeLineDistances();
    dashLine.userData.__measurePreview = true;
    scene.add(dashLine);
  }
}

function buildMeasurePickHint(
  measurePhase: MeasurePhase,
  calibLen: number,
  measureLen: number,
  pick: PickResult | null,
): string {
  if (!pick) return MEASURE_PICK_HINT_IDLE;
  if (!pick.isSnapped) return 'No splat under cursor — move over the reconstruction to preview a point.';
  if (measurePhase === 'calibrate') {
    if (calibLen === 0) return 'Preview: calibration A · click to place';
    if (calibLen === 1) return 'Preview: calibration B · click to place';
    return 'Preview: click replaces calibration (new A).';
  }
  if (measureLen === 0) return 'Preview: measure A · click to place';
  if (measureLen === 1) return 'Preview: measure B · click to place';
  return 'Preview: click starts a new pair (new A).';
}

/** Avoid innerHTML + Viewer.dispose() both touching the same nodes (removeChild DOMException). */
function removeContainerChildrenSafe(el: HTMLElement) {
  while (el.firstChild) {
    try {
      el.removeChild(el.firstChild);
    } catch {
      break;
    }
  }
}

// ── Lightweight PLY header parser (metadata + positions only) ────────────────

interface PLYMeta {
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

function parsePLYForMeta(buffer: ArrayBuffer): PLYMeta {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8');

  // Find end_header
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
  const headerLines = headerText.split('\n').map(l => l.trim());

  let vertexCount = 0;
  let isBinary = false;
  let isLittleEndian = true;
  const properties: { name: string; type: string }[] = [];

  for (const line of headerLines) {
    if (line.startsWith('format binary_little_endian')) { isBinary = true; isLittleEndian = true; }
    else if (line.startsWith('format binary_big_endian')) { isBinary = true; isLittleEndian = false; }
    else if (line.startsWith('format ascii')) { isBinary = false; }
    else if (line.startsWith('element vertex')) { vertexCount = parseInt(line.split(/\s+/)[2]); }
    else if (line.startsWith('property')) {
      const parts = line.split(/\s+/);
      properties.push({ type: parts[1], name: parts[2] });
    }
  }

  if (vertexCount === 0) throw new Error('No vertices in PLY');

  const propNames = properties.map(p => p.name);
  const format = isBinary ? (isLittleEndian ? 'binary_little_endian' : 'binary_big_endian') : 'ascii';
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
        case 'char': case 'int8': currentOffset += 1; break;
        case 'short': case 'int16': case 'ushort': case 'uint16': currentOffset += 2; break;
        case 'int': case 'int32': case 'uint': case 'uint32': currentOffset += 4; break;
        default: currentOffset += 4;
      }
    }
    const bytesPerVertex = currentOffset;
    const availableSize = buffer.byteLength - headerEnd;
    const maxVerts = Math.min(vertexCount, Math.floor(availableSize / bytesPerVertex));

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
    const dataText = decoder.decode(bytes.slice(headerEnd));
    const dataLines = dataText.split('\n').filter(l => l.trim());
    const count = Math.min(vertexCount, dataLines.length);
    const opacityIdx = propNames.indexOf('opacity');

    for (let i = 0; i < count; i++) {
      const parts = dataLines[i].trim().split(/\s+/).map(parseFloat);
      const x = parts[xIdx], y = parts[yIdx], z = parts[zIdx];
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      if (opacityIdx !== -1 && 1 / (1 + Math.exp(-parts[opacityIdx])) < 0.005) continue;

      const idx3 = visibleCount * 3;
      positions[idx3] = x; positions[idx3 + 1] = y; positions[idx3 + 2] = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      visibleCount++;
    }
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  const centeredPos = positions.slice(0, visibleCount * 3);
  for (let i = 0; i < centeredPos.length; i += 3) {
    centeredPos[i] -= cx;
    centeredPos[i + 1] -= cy;
    centeredPos[i + 2] -= cz;
  }

  return {
    positions: centeredPos,
    vertexCount: visibleCount,
    totalVertices: vertexCount,
    properties: propNames,
    format,
    hasColors,
    hasOpacity,
    boundingBox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    center: [cx, cy, cz],
  };
}

// ── PLY scale/opacity diagnostics (helps debug invisible splats) ─────────────

function logPLYScaleOpacityDiag(buffer: ArrayBuffer) {
  try {
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
    if (headerEnd === -1) return;
    const headerText = decoder.decode(bytes.slice(0, headerEnd));
    const headerLines = headerText.split('\n').map(l => l.trim());
    let vertexCount = 0;
    const props: { name: string; type: string }[] = [];
    for (const line of headerLines) {
      if (line.startsWith('element vertex')) vertexCount = parseInt(line.split(/\s+/)[2]);
      else if (line.startsWith('property')) {
        const parts = line.split(/\s+/);
        props.push({ type: parts[1], name: parts[2] });
      }
    }
    if (vertexCount === 0 || !headerText.includes('binary_little_endian')) return;
    const propNames = props.map(p => p.name);
    const scaleIdx = propNames.indexOf('scale_0');
    const opacityIdx = propNames.indexOf('opacity');
    if (scaleIdx === -1 && opacityIdx === -1) return;

    const propOffsets: number[] = [];
    let bytesPerVertex = 0;
    for (const prop of props) {
      propOffsets.push(bytesPerVertex);
      switch (prop.type) {
        case 'float': case 'float32': bytesPerVertex += 4; break;
        case 'double': case 'float64': bytesPerVertex += 8; break;
        case 'uchar': case 'uint8': bytesPerVertex += 1; break;
        case 'short': case 'int16': case 'ushort': case 'uint16': bytesPerVertex += 2; break;
        default: bytesPerVertex += 4;
      }
    }

    const dv = new DataView(buffer, headerEnd);
    const n = Math.min(vertexCount, Math.floor((buffer.byteLength - headerEnd) / bytesPerVertex));
    const samples = Math.min(10, n);

    if (scaleIdx !== -1) {
      const sOff = propOffsets[scaleIdx];
      let minS = Infinity, maxS = -Infinity, sumS = 0, subPixel = 0;
      for (let i = 0; i < n; i++) {
        const base = i * bytesPerVertex;
        for (let c = 0; c < 3; c++) {
          const s = dv.getFloat32(base + sOff + c * 4, true);
          if (s < minS) minS = s;
          if (s > maxS) maxS = s;
          sumS += s;
          if (s < -6) subPixel++;
        }
      }
      console.log(
        `[GS3D-diag] Scale (log-space): min=${minS.toFixed(3)}, max=${maxS.toFixed(3)}, ` +
        `mean=${(sumS / (n * 3)).toFixed(3)}, sub-pixel(<-6): ${subPixel}/${n * 3} (${(subPixel / (n * 3) * 100).toFixed(1)}%)`,
      );
      console.log(
        `[GS3D-diag] Scale (world): min_exp=${Math.exp(minS).toFixed(6)}, max_exp=${Math.exp(maxS).toFixed(4)}, ` +
        `median_approx_exp=${Math.exp(sumS / (n * 3)).toFixed(6)}`,
      );
      for (let i = 0; i < samples; i++) {
        const base = i * bytesPerVertex;
        const s0 = dv.getFloat32(base + sOff, true);
        const s1 = dv.getFloat32(base + sOff + 4, true);
        const s2 = dv.getFloat32(base + sOff + 8, true);
        console.log(
          `[GS3D-diag] v${i}: scale=[${s0.toFixed(3)},${s1.toFixed(3)},${s2.toFixed(3)}] ` +
          `exp=[${Math.exp(s0).toFixed(5)},${Math.exp(s1).toFixed(5)},${Math.exp(s2).toFixed(5)}]`,
        );
      }
    }

    if (opacityIdx !== -1) {
      const oOff = propOffsets[opacityIdx];
      let minO = Infinity, maxO = -Infinity, sumSig = 0, highCount = 0;
      for (let i = 0; i < n; i++) {
        const raw = dv.getFloat32(i * bytesPerVertex + oOff, true);
        if (raw < minO) minO = raw;
        if (raw > maxO) maxO = raw;
        const sig = 1 / (1 + Math.exp(-raw));
        sumSig += sig;
        if (sig > 0.5) highCount++;
      }
      console.log(
        `[GS3D-diag] Opacity (logit): min=${minO.toFixed(3)}, max=${maxO.toFixed(3)}`,
      );
      console.log(
        `[GS3D-diag] Opacity (sigmoid): mean=${(sumSig / n).toFixed(4)}, >0.5: ${highCount}/${n}`,
      );
    }
  } catch (e) {
    console.warn('[GS3D-diag] Scale/opacity diagnostic failed:', e);
  }
}

// ── Main Viewer Component (standalone Viewer — no R3F) ──────────────────────

export default function Viewer3D({
  modelUrl,
  jobId = null,
  prefetchedJobModelMetadata = null,
  onModelMetadata,
}: Viewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);

  const walkthroughRef = useRef<{ active: boolean; keys: Set<string>; isLocked: boolean; euler: THREE.Euler; rafId: number | null }>({
    active: false, keys: new Set(), isLocked: false, euler: new THREE.Euler(0, 0, 0, 'YXZ'), rafId: null,
  });

  const metadataRef = useRef<ModelMetadata | null>(null);
  /** Matches VITE_VIEWER_SCENE_SCALE for pick maxDist while viewer is mounted. */
  const sceneScaleRef = useRef(1);
  const splatCentersRef = useRef<Float32Array | null>(null);
  const splatCenterGridRef = useRef<SplatCenterGridAccel | null>(null);
  const splatTreeReadyRef = useRef<boolean>(false);
  const onMetadataRef = useRef(onModelMetadata);
  onMetadataRef.current = onModelMetadata;

  const [mode, setMode] = useState<ViewerMode>('orbit');
  const [showHelp, setShowHelp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Measurement state ──────────────────────────────────────────────────
  const [measurePhase, setMeasurePhase] = useState<MeasurePhase>('calibrate');
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [calibPoints, setCalibPoints] = useState<MeasurePoint[]>([]);
  const [meterInput, setMeterInput] = useState('1.0');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);
  const [measurePickHint, setMeasurePickHint] = useState(MEASURE_PICK_HINT_IDLE);

  const visibleMeasurePoints = measurePhase === 'calibrate' ? calibPoints : measurePoints;

  const measurePickCtxRef = useRef({ measurePhase, calibPoints, measurePoints });
  measurePickCtxRef.current = { measurePhase, calibPoints, measurePoints };

  // Display / render tuning (GaussianSplats3D; see https://projects.markkellogg.org/threejs/demo_gaussian_splats_3d.php)
  const [minAlpha, setMinAlpha] = useState(1);
  const [loadMinAlpha, setLoadMinAlpha] = useState(1);
  const [shDisplayDegree, setShDisplayDegree] = useState<0 | 1 | 2>(2);
  const [splatScale, setSplatScale] = useState(DEFAULT_SPLAT_SCALE);
  const [displayPanelOpen, setDisplayPanelOpen] = useState(false);
  const [ksplatBusy, setKsplatBusy] = useState(false);
  const [ksplatError, setKsplatError] = useState<string | null>(null);
  /** Live Display tuning: false when @mkkellogg/gaussian-splats-3d Viewer omits these methods (e.g. 0.4.7). */
  const [liveViewerApis, setLiveViewerApis] = useState<{ sh: boolean; scale: boolean }>({
    sh: false,
    scale: false,
  });
  const liveTuningInfoLoggedRef = useRef(false);

  useEffect(() => {
    const id = window.setTimeout(() => setLoadMinAlpha(minAlpha), 450);
    return () => clearTimeout(id);
  }, [minAlpha]);

  useEffect(() => {
    setKsplatError(null);
  }, [modelUrl]);

  useEffect(() => {
    if (mode !== 'measure') setMeasurePickHint(MEASURE_PICK_HINT_IDLE);
  }, [mode]);

  // ── Initialize Viewer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !modelUrl) return;
    let disposed = false;
    let splatSafetyPollTimer: number | undefined;
    let unhandledRejectionHandler: ((e: PromiseRejectionEvent) => void) | null = null;

    const apiBase = getApiBaseUrl();
    const fullUrl = modelUrl.startsWith('http') ? modelUrl : `${apiBase}${modelUrl}`;

    setLoading(true);
    setError(null);
    const initialCameraAbort = new AbortController();

    (async () => {
      try {
        console.log('[GS3D] phase: init chain start');
        const initialCameraPromise: Promise<InitialCameraResponse | null> = jobId
          ? getInitialCamera(jobId, { signal: initialCameraAbort.signal }).catch((e: unknown) => {
              if (isCancel(e)) {
                console.info('[GS3D] phase: initial_camera canceled');
                return null;
              }
              if (
                isAxiosError(e) &&
                (e.code === 'ECONNABORTED' || (typeof e.message === 'string' && e.message.toLowerCase().includes('timeout')))
              ) {
                console.info('[GS3D] phase: initial_camera timed out — using bbox default');
                return null;
              }
              console.info('[GS3D] phase: initial_camera unavailable — using bbox default');
              return null;
            })
          : Promise.resolve(null);

        // 1. Fetch PLY (runs in parallel with initial_camera when jobId is set)
        console.log('[GS3D] phase: PLY fetch start', fullUrl);
        const plySignal = plyFetchAbortSignal();
        const response = await fetch(fullUrl, plySignal != null ? { signal: plySignal } : {});
        if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (disposed) return;
        console.log('[GS3D] phase: PLY fetch done', buffer.byteLength, 'bytes');

        const b0 = new Uint8Array(buffer, 0, Math.min(3, buffer.byteLength));
        if (b0.length >= 2 && b0[0] === 0x1f && b0[1] === 0x8b) {
          throw new Error(
            'Received gzip-compressed data without decompression. Use GET /api/jobs/{id}/model (not a raw .ply.gz URL).',
          );
        }
        if (b0.length < 3 || b0[0] !== 0x70 || b0[1] !== 0x6c || b0[2] !== 0x79) {
          throw new Error('Response does not look like a PLY file (expected ASCII header "ply").');
        }

        // 2. Metadata: prefer API job payload (skips full PLY vertex scan); else parse PLY
        const prefetched = prefetchedJobModelMetadata;
        const canUseServerMeta =
          !!prefetched &&
          typeof prefetched.point_count === 'number' &&
          prefetched.point_count > 0 &&
          !!prefetched.bounding_box?.min &&
          !!prefetched.bounding_box?.max;

        let modelMeta: ModelMetadata;
        let bbMin: [number, number, number];
        let bbMax: [number, number, number];
        let vertexCountForProgress: number;

        if (canUseServerMeta) {
          modelMeta = modelMetadataFromJobResponse(prefetched!, buffer.byteLength);
          bbMin = modelMeta.boundingBox.min;
          bbMax = modelMeta.boundingBox.max;
          vertexCountForProgress = modelMeta.pointCount;
          console.log(`[GS3D] Using server job metadata: ${vertexCountForProgress} verts (skipped client PLY parse)`);
        } else {
          const meta = parsePLYForMeta(buffer);
          if (meta.vertexCount === 0) throw new Error('No visible points in PLY');
          console.log(
            `[GS3D] PLY parsed: ${meta.vertexCount}/${meta.totalVertices} verts, center=[${meta.center.map((v) => v.toFixed(2))}]`,
          );
          if (import.meta.env.DEV) {
            logPLYScaleOpacityDiag(buffer);
          }
          modelMeta = {
            pointCount: meta.vertexCount,
            fileSize: buffer.byteLength,
            boundingBox: meta.boundingBox,
            hasColors: meta.hasColors,
            hasOpacity: meta.hasOpacity,
            properties: meta.properties,
            format: 'gaussian_splat',
          };
          bbMin = meta.boundingBox.min;
          bbMax = meta.boundingBox.max;
          vertexCountForProgress = meta.vertexCount;
        }

        const fRestProps = modelMeta.properties.filter((p) => /^f_rest_\d+$/.test(p));
        if (fRestProps.length > 0 && fRestProps.length % 3 !== 0) {
          console.warn(
            '[GS3D] PLY has',
            fRestProps.length,
            'f_rest_* properties (not divisible by 3). @mkkellogg/gaussian-splats-3d may render an empty splat pass. Re-export from a backend that runs _normalize_f_rest_fields (redeploy Docker image + new job).',
          );
        }

        metadataRef.current = modelMeta;
        onMetadataRef.current?.(modelMeta);
        console.log('[GS3D] phase: metadata ready');

        // 3. MetaMask's lockdown-install.js (SES) logs DOMException errors when
        // OrbitControls touches domElement.style. These are cosmetic — the viewer
        // still functions. Test in incognito to confirm SES is the sole source.
        const onUnhandledRejection = (e: PromiseRejectionEvent) => {
          const msg = e.reason?.message || String(e.reason);
          if (msg.includes('SharedArrayBuffer') || msg.includes('postMessage') ||
              msg.includes('DOMException') || msg.includes('Worker') || msg.includes('not usable')) {
            console.warn('[GS3D] Unhandled rejection (browser extension interference?):', msg);
          }
        };
        window.addEventListener('unhandledrejection', onUnhandledRejection);
        unhandledRejectionHandler = onUnhandledRejection;

        // Auto-position camera based on bounding box diagonal
        const diagonal = Math.sqrt(
          (bbMax[0] - bbMin[0]) ** 2 +
          (bbMax[1] - bbMin[1]) ** 2 +
          (bbMax[2] - bbMin[2]) ** 2,
        );
        const sceneScale = parseViewerSceneScale();
        sceneScaleRef.current = sceneScale;
        if (sceneScale !== 1) {
          console.log(`[GS3D] VITE_VIEWER_SCENE_SCALE=${sceneScale} (clamped ${VIEWER_SCENE_SCALE_MIN}–${VIEWER_SCENE_SCALE_MAX})`);
        }
        const camDist = Math.max(diagonal * BBOX_CAM_DIST_MULT, BBOX_CAM_DIST_MIN);
        // Bbox fallback is tuned with Y-flipped up (MASt3R / OpenCV-style). Pose-derived eye/target from
        // LongSplat world use standard Y-up with initial_camera — see ARCHITECTURE.md.
        let cameraUp: [number, number, number] = [0, -1, 0];
        const orientation: [number, number, number, number] = [0, 0, 0, 1];
        console.log(`[GS3D] BBox diagonal=${diagonal.toFixed(2)}, camDist=${camDist.toFixed(2)}, splatOrientation=identity`);

        let initialCameraPosition: [number, number, number] = [0, camDist * 0.35, camDist * 0.75];
        let initialCameraLookAt: [number, number, number] = [0, 0, 0];
        console.log('[GS3D] phase: await initial_camera (may already be resolved)');
        const hint = await initialCameraPromise;
        if (
          !disposed &&
          hint &&
          Array.isArray(hint.position) &&
          hint.position.length === 3 &&
          Array.isArray(hint.target) &&
          hint.target.length === 3
        ) {
          initialCameraPosition = [
            Number(hint.position[0]),
            Number(hint.position[1]),
            Number(hint.position[2]),
          ];
          initialCameraLookAt = [
            Number(hint.target[0]),
            Number(hint.target[1]),
            Number(hint.target[2]),
          ];
          cameraUp = [0, 1, 0];
          console.log(
            '[GS3D] phase: initial_camera applied (first 24 poses + offset); cameraUp=[0,1,0]',
            hint,
          );
        } else if (!disposed && jobId) {
          console.log('[GS3D] phase: initial_camera skipped (missing, error, or canceled)');
        }

        if (sceneScale !== 1) {
          const scaled = scaleCameraPairFromOrigin(initialCameraPosition, initialCameraLookAt, sceneScale);
          initialCameraPosition = scaled.position;
          initialCameraLookAt = scaled.lookAt;
        }

        const isolated = globalThis.crossOriginIsolated === true;
        const forceLegacy = forceLegacyGs3dWorkers();
        const gpuAcceleratedSort = isolated && !forceLegacy;
        const sharedMemoryForWorkers = isolated && !forceLegacy;
        if (forceLegacy && isolated) {
          console.info(
            '[GS3D] VITE_GS3D_FORCE_LEGACY_WORKERS: gpuAcceleratedSort and sharedMemoryForWorkers forced off (see ARCHITECTURE.md).',
          );
        } else if (!isolated) {
          console.info(
            '[GS3D] crossOriginIsolated=false — gpuAcceleratedSort and sharedMemoryForWorkers disabled (see ARCHITECTURE.md COOP/COEP).',
          );
        }

        const useProgressive = vertexCountForProgress >= PROGRESSIVE_VERTEX_THRESHOLD;
        const sceneRevealMode = useProgressive ? SceneRevealMode.Default : SceneRevealMode.Instant;
        if (useProgressive) {
          console.log(
            `[GS3D] progressiveLoad=true (${vertexCountForProgress} >= ${PROGRESSIVE_VERTEX_THRESHOLD} verts)`,
          );
        }

        // 5. Create standalone Viewer (let library manage its own THREE.Scene)
        console.log('[GS3D] phase: create Viewer');
        const viewer = new Viewer({
          cameraUp,
          initialCameraPosition,
          initialCameraLookAt,
          rootElement: containerRef.current!,
          selfDrivenMode: true,
          useBuiltInControls: true,
          integerBasedSort: false,
          sceneRevealMode,
          antialiased: true,
          freeIntermediateSplatData: false,
          logLevel: LogLevel.Info,
          sphericalHarmonicsDegree: 2,
          gpuAcceleratedSort,
          sharedMemoryForWorkers,
        } as Record<string, unknown>);

        // 6. Add grid + axes to the library-managed scene (depthWrite off to avoid occluding splats)
        const libScene = (viewer as unknown as { threeScene: THREE.Scene }).threeScene;
        const grid = new THREE.GridHelper(30, 30, 0x1b1a0e, 0x121008);
        grid.position.y = -0.01;
        (grid.material as THREE.Material).depthWrite = false;
        (grid.material as THREE.Material).depthTest = false;
        libScene.add(grid);
        const axesHelper = new THREE.AxesHelper(1.5);
        (axesHelper.material as THREE.Material).transparent = true;
        (axesHelper.material as THREE.Material).opacity = 0.6;
        (axesHelper.material as THREE.Material).depthWrite = false;
        (axesHelper.material as THREE.Material).depthTest = false;
        libScene.add(axesHelper);

        // 7. Add splat scene from a blob URL so the library does not re-fetch the same PLY over the network
        const plyBlob = new Blob([buffer], { type: 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(plyBlob);
        let splatRaceTimer: number | undefined;
        try {
          console.log('[GS3D] phase: addSplatScene start');
          const splatLoad = viewer.addSplatScene(blobUrl, {
            splatAlphaRemovalThreshold: loadMinAlpha,
            showLoadingUI: false,
            progressiveLoad: useProgressive,
            format: 2,
            orientation,
          } as Record<string, unknown>);
          const splatTimeout = new Promise<never>((_, reject) => {
            splatRaceTimer = window.setTimeout(() => {
              reject(
                new Error(
                  `Splat load timed out after ${ADD_SPLAT_SCENE_TIMEOUT_MS / 1000}s. Set VITE_GS3D_FORCE_LEGACY_WORKERS=true on Vercel and redeploy, or check COOP/COEP + CORP (ARCHITECTURE.md).`,
                ),
              );
            }, ADD_SPLAT_SCENE_TIMEOUT_MS);
          });
          try {
            await Promise.race([splatLoad, splatTimeout]);
          } catch (splatErr) {
            try {
              viewer.dispose();
            } catch {
              /* ignore */
            }
            throw splatErr;
          }
        } finally {
          if (splatRaceTimer !== undefined) {
            window.clearTimeout(splatRaceTimer);
          }
          URL.revokeObjectURL(blobUrl);
        }
        console.log('[GS3D] phase: addSplatScene done');
        if (disposed) return;

        if (sceneScale !== 1 && viewer.splatMesh) {
          viewer.splatMesh.scale.setScalar(sceneScale);
          viewer.splatMesh.updateMatrixWorld(true);
          console.log('[GS3D] splatMesh.scale applied:', sceneScale);
        }

        // 8. Start rendering
        console.log('[GS3D] phase: viewer.start');
        viewer.start();
        applyOrbitZoomLimitsFromDiagonal(viewer, diagonal * sceneScale);
        // True ellipsoid hits align better with the rendered splat surface (measurement).
        try {
          const rc = viewer.raycaster as unknown as Record<string, unknown>;
          if ('raycastAgainstTrueSplatEllipsoid' in rc) {
            rc['raycastAgainstTrueSplatEllipsoid'] = true;
            console.log('[GS3D] raycastAgainstTrueSplatEllipsoid = true (ellipsoid hit accuracy on)');
          } else {
            console.info(
              '[GS3D] raycastAgainstTrueSplatEllipsoid not available in this GS3D build — sphere mode',
            );
          }
        } catch {
          /* MetaMask SES / lockdown may throw on property assignment — ignore */
        }

        console.log('[GS3D] splatMesh.visible:', viewer.splatMesh?.visible);
        console.log('[GS3D] renderer context:', (viewer as any).renderer?.getContext()?.constructor?.name);

        // Diagnostic logging after first sort completes (~3s) — dev only
        if (import.meta.env.DEV) {
          setTimeout(() => {
            if (disposed) return;
            const mesh = viewer.splatMesh as any;
            const cam = (viewer as any).camera as THREE.PerspectiveCamera | undefined;
            console.log(
              '[GS3D] Post-sort check: instanceCount=',
              mesh?.geometry?.instanceCount,
              'splatRenderReady=',
              (viewer as any).splatRenderReady,
            );
            if (cam) {
              console.log(
                '[GS3D] Camera pos=',
                cam.position.toArray().map((v: number) => v.toFixed(2)),
                'fov=',
                cam.fov,
                'near=',
                cam.near,
                'far=',
                cam.far,
              );
            }
            if (mesh?.geometry?.instanceCount === 0) {
              console.warn(
                '[GS3D] instanceCount is 0 — splats loaded but none rendered. Check console for library errors.',
              );
            }
          }, 3000);
        }

        const splatMeshAny = viewer.splatMesh as unknown as {
          getSplatCount?: (includeSinceLastBuild?: boolean) => number;
        };
        const lastBuild = splatMeshAny.getSplatCount?.();
        const bufferTotal = splatMeshAny.getSplatCount?.(true);
        if (lastBuild !== undefined || bufferTotal !== undefined) {
          console.log('[GS3D] Splat count after load (lastBuild / bufferTotal):', lastBuild, '/', bufferTotal);
        }

        // Build splat center cache only after SplatTree is ready (transforms are finalized)
        const rebuildCenterCache = () => {
          const buf = buildSplatCenterWorldCache(viewer.splatMesh as SplatMeshWithCenters);
          splatCentersRef.current = buf;
          splatCenterGridRef.current = buf ? buildCenterGridAcceleration(buf) : null;
          if (buf) {
            console.log(
              '[GS3D] Splat center cache built:',
              buf.length / 3,
              'points',
              splatCenterGridRef.current ? '(spatial grid on)' : '(linear pick)',
            );
          } else {
            console.warn('[GS3D] Failed to build splat center cache');
          }
        };

        // Register SplatTree ready callback for library raycaster.
        // GS3D stores a single callback and clears it after each build; re-register at the
        // end of the handler so progressive / subsequent final builds refresh the center cache.
        splatTreeReadyRef.current = false;
        const splatMeshInternal = viewer.splatMesh as unknown as {
          onSplatTreeReady?: (cb: () => void) => void;
          getSplatTree?: () => unknown;
        };

        const onSplatTreeReadyHandler = () => {
          if (disposed || viewerRef.current !== viewer) return;
          splatTreeReadyRef.current = true;
          rebuildCenterCache();
          console.log('[GS3D] SplatTree ready — library raycaster is now active');

          // If the cache came back null (count = 0 on first build), retry once after
          // a short delay — some GS3D versions fire onSplatTreeReady before the
          // internal buffer swap completes.
          if (!splatCentersRef.current) {
            console.warn('[GS3D] center cache empty on first SplatTree ready — retrying in 1.5s');
            window.setTimeout(() => {
              if (!disposed && viewerRef.current === viewer) {
                rebuildCenterCache();
                if (splatCentersRef.current) {
                  console.log(
                    '[GS3D] center cache rebuilt on retry:',
                    splatCentersRef.current.length / 3,
                    'splats',
                  );
                } else {
                  console.warn(
                    '[GS3D] center cache still empty after retry — picks will use GS3D raycaster only',
                  );
                }
              }
            }, 1500);
          }

          splatMeshInternal.onSplatTreeReady?.(onSplatTreeReadyHandler);
        };

        if (splatMeshInternal.getSplatTree?.()) {
          splatTreeReadyRef.current = true;
          rebuildCenterCache();
          console.log('[GS3D] SplatTree already available');
          if (splatMeshInternal.onSplatTreeReady) {
            splatMeshInternal.onSplatTreeReady(onSplatTreeReadyHandler);
          }
        } else if (splatMeshInternal.onSplatTreeReady) {
          splatMeshInternal.onSplatTreeReady(onSplatTreeReadyHandler);
          console.log('[GS3D] Waiting for SplatTree to build (async)...');
        } else {
          console.warn('[GS3D] onSplatTreeReady not available — building center cache eagerly');
          rebuildCenterCache();
        }

        // Safety re-check: if SplatTree callback was missed, poll after 5s
        splatSafetyPollTimer = window.setTimeout(() => {
          if (disposed) return;
          if (viewerRef.current !== viewer) return;

          if (!splatTreeReadyRef.current) {
            if (splatMeshInternal.getSplatTree?.()) {
              splatTreeReadyRef.current = true;
              rebuildCenterCache();
              splatMeshInternal.onSplatTreeReady?.(onSplatTreeReadyHandler);
              console.log('[GS3D] SplatTree detected via safety poll (5s)');
            } else {
              console.warn('[GS3D] SplatTree still not ready after 5s — library raycaster may not work');
            }
          } else if (!splatCentersRef.current) {
            // Tree was ready but cache is still null — try once more.
            rebuildCenterCache();
            // Ref assignment inside rebuildCenterCache is not reflected in CFA; read with cast.
            const recoveredBuf = splatCentersRef.current as Float32Array | null;
            if (recoveredBuf) {
              console.log(
                '[GS3D] center cache recovered via safety poll:',
                recoveredBuf.length / 3,
                'splats',
              );
            }
          }
        }, 5000);

        viewerRef.current = viewer;
        console.log('[GS3D] Viewer started successfully');
        console.log('[GS3D] phase: init chain complete');
        setLoading(false);
      } catch (err: unknown) {
        if (!disposed) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[GS3D] Viewer error:', msg);
          setError(msg);
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      if (splatSafetyPollTimer !== undefined) {
        window.clearTimeout(splatSafetyPollTimer);
        splatSafetyPollTimer = undefined;
      }
      initialCameraAbort.abort();
      splatCentersRef.current = null;
      splatCenterGridRef.current = null;
      splatTreeReadyRef.current = false;
      sceneScaleRef.current = 1;
      if (unhandledRejectionHandler) {
        window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
        unhandledRejectionHandler = null;
      }
      try {
        document.exitPointerLock?.();
      } catch { /* ignore */ }
      const root = containerRef.current;
      const viewer = viewerRef.current;
      viewerRef.current = null;
      if (viewer) {
        try {
          viewer.dispose();
        } catch {
          /* GaussianSplats3D may removeChild after React already detached nodes */
        }
      }
      if (root) {
        removeContainerChildrenSafe(root);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, jobId, loadMinAlpha, prefetchedJobModelMetadata]);

  useEffect(() => {
    if (loading) {
      setLiveViewerApis({ sh: false, scale: false });
      return;
    }
    const v = viewerRef.current;
    if (!v) return;
    const sh = typeof (v as { setActiveSphericalHarmonicsDegrees?: (d: number) => void }).setActiveSphericalHarmonicsDegrees === 'function';
    const scale = typeof (v as { setSplatScale?: (s?: number) => void }).setSplatScale === 'function';
    setLiveViewerApis({ sh, scale });
    if ((!sh || !scale) && !liveTuningInfoLoggedRef.current) {
      liveTuningInfoLoggedRef.current = true;
      const missing: string[] = [];
      if (!sh) missing.push('setActiveSphericalHarmonicsDegrees');
      if (!scale) missing.push('setSplatScale');
      console.info(
        `[GS3D] Viewer has no ${missing.join(' / ')} — Display live controls for those are disabled (fixed at Viewer init for this library build).`,
      );
    }
  }, [loading, modelUrl]);

  useEffect(() => {
    if (loading) return;
    const v = viewerRef.current;
    if (!v) return;
    const fn = (v as { setActiveSphericalHarmonicsDegrees?: (d: number) => void }).setActiveSphericalHarmonicsDegrees;
    if (typeof fn === 'function') fn.call(v, shDisplayDegree);
  }, [shDisplayDegree, loading]);

  useEffect(() => {
    if (loading) return;
    const v = viewerRef.current;
    if (!v) return;
    const fn = (v as { setSplatScale?: (s?: number) => void }).setSplatScale;
    if (typeof fn === 'function') fn.call(v, splatScale);
  }, [splatScale, loading]);

  // ── Walkthrough Mode ───────────────────────────────────────────────────
  useEffect(() => {
    const wt = walkthroughRef.current;
    const viewer = viewerRef.current;
    const canvas = containerRef.current?.querySelector('canvas');

    wt.active = mode === 'walkthrough';

    if (!wt.active || !viewer || !canvas) {
      // Disable walkthrough
      document.exitPointerLock?.();
      wt.isLocked = false;
      if (wt.rafId !== null) { cancelAnimationFrame(wt.rafId); wt.rafId = null; }
      if (viewer) {
        try {
          const v = viewer as unknown as Record<string, CallableFunction>;
          v.setOrbitControlsEnabled?.(true);
        } catch { /* ignore */ }
      }
      return;
    }

    try {
      const v = viewer as unknown as Record<string, CallableFunction>;
      v.setOrbitControlsEnabled?.(false);
    } catch { /* ignore */ }

    const camera = (viewer as unknown as { camera?: THREE.PerspectiveCamera }).camera;
    if (!camera) return;

    const viewerInstance = viewer;

    const onKeyDown = (e: KeyboardEvent) => wt.keys.add(e.code);
    const onKeyUp = (e: KeyboardEvent) => wt.keys.delete(e.code);
    const onClick = () => {
      if (!wt.active || wt.isLocked || !canvas.isConnected) return;
      try {
        canvas.requestPointerLock();
      } catch {
        /* user gesture / policy / disposed canvas */
      }
    };
    const onPLC = () => { wt.isLocked = document.pointerLockElement === canvas; };
    const onMM = (e: MouseEvent) => {
      if (!wt.isLocked) return;
      if (viewerRef.current !== viewerInstance || !canvas.isConnected) return;
      wt.euler.setFromQuaternion(camera.quaternion);
      wt.euler.y -= e.movementX * 0.002;
      wt.euler.x -= e.movementY * 0.002;
      wt.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, wt.euler.x));
      camera.quaternion.setFromEuler(wt.euler);
    };

    let lastTime = performance.now();
    const animate = () => {
      if (!wt.active) return;
      if (viewerRef.current !== viewerInstance || !canvas.isConnected) {
        wt.rafId = null;
        return;
      }
      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      if (wt.isLocked) {
        const dir = new THREE.Vector3();
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        if (wt.keys.has('KeyW') || wt.keys.has('ArrowUp')) dir.add(fwd);
        if (wt.keys.has('KeyS') || wt.keys.has('ArrowDown')) dir.sub(fwd);
        if (wt.keys.has('KeyA') || wt.keys.has('ArrowLeft')) dir.sub(right);
        if (wt.keys.has('KeyD') || wt.keys.has('ArrowRight')) dir.add(right);
        if (wt.keys.has('Space')) dir.y += 1;
        if (wt.keys.has('ShiftLeft')) dir.y -= 1;
        if (dir.lengthSq() > 0) { dir.normalize().multiplyScalar(3 * delta); camera.position.add(dir); }
      }
      wt.rafId = requestAnimationFrame(animate);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onPLC);
    document.addEventListener('mousemove', onMM);
    wt.rafId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onPLC);
      document.removeEventListener('mousemove', onMM);
      document.exitPointerLock?.();
      wt.isLocked = false;
      if (wt.rafId !== null) { cancelAnimationFrame(wt.rafId); wt.rafId = null; }
    };
  }, [mode, loading]);

  // ── Canvas cursor (re-apply when viewer finishes loading and canvas exists) ──
  useEffect(() => {
    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;
    try {
      if (mode === 'measure') canvas.style.cursor = 'crosshair';
      else if (mode === 'walkthrough') canvas.style.cursor = 'none';
      else canvas.style.cursor = 'grab';
    } catch {
      /* MetaMask SES / lockdown can throw on domElement.style — ignore */
    }
  }, [mode, loading]);

  // ── Measurement Click Handler (effect below, after handleAddMeasurePoint) ──
  const lastClickTimeRef = useRef<number>(0);

  // ── Measurement Visuals (add/remove spheres and lines in the threeScene) ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const scene = (viewer as unknown as { threeScene?: THREE.Scene }).threeScene;
    if (!scene) return;

    // Remove old measurement visuals
    const toRemove: THREE.Object3D[] = [];
    scene.traverse((o) => { if (o.userData.__measure) toRemove.push(o); });
    toRemove.forEach(o => { scene.remove(o); });

    const sphereGeo = new THREE.SphereGeometry(0.012, 12, 12);
    const primaryMat = new THREE.MeshBasicMaterial({ color: '#efe752' });
    const secondaryMat = new THREE.MeshBasicMaterial({ color: '#f5ec99' });

    visibleMeasurePoints.forEach((pt, i) => {
      const mesh = new THREE.Mesh(sphereGeo, i === 0 ? secondaryMat : primaryMat);
      mesh.position.copy(pt.position);
      mesh.userData.__measure = true;
      scene.add(mesh);
    });

    if (visibleMeasurePoints.length === 2) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(visibleMeasurePoints.map(p => p.position));
      const lineMat = new THREE.LineBasicMaterial({ color: '#efe752', linewidth: 2 });
      const line = new THREE.Line(lineGeo, lineMat);
      line.userData.__measure = true;
      scene.add(line);
    }

    return () => {
      if (viewerRef.current !== viewer) return;
      try {
        const removalList: THREE.Object3D[] = [];
        scene.traverse((o) => { if (o.userData.__measure) removalList.push(o); });
        removalList.forEach((o) => scene.remove(o));
      } catch {
        /* scene may be disposed with viewer */
      }
    };
  }, [visibleMeasurePoints]);

  // ── Measurement Callbacks ──────────────────────────────────────────────

  const handleAddMeasurePoint = useCallback((point: THREE.Vector3) => {
    if (measurePhase === 'calibrate') {
      setCalibPoints(prev => {
        if (prev.length >= 2) return [{ position: point }];
        return [...prev, { position: point }];
      });
    } else {
      setMeasurePoints(prev => {
        const next = prev.length >= 2 ? [{ position: point }] : [...prev, { position: point }];
        if (next.length === 2 && calibration) {
          const rawDist = next[0].position.distanceTo(next[1].position);
          setMeasuredDistance(rawDist * calibration.scaleFactor);
        } else {
          setMeasuredDistance(null);
        }
        return next;
      });
    }
  }, [measurePhase, calibration]);

  useEffect(() => {
    if (mode !== 'measure') return;
    const viewer = viewerRef.current;
    const canvas = containerRef.current?.querySelector('canvas');
    if (loading || !viewer || !canvas) return;

    const viewerAny = viewer as unknown as {
      camera?: THREE.PerspectiveCamera;
      threeScene?: THREE.Scene;
      raycaster?: {
        setFromCameraAndScreenPosition: (camera: THREE.Camera, screenPos: THREE.Vector2, screenDims: THREE.Vector2) => void;
        intersectSplatMesh: (splatMesh: THREE.Object3D, outHits?: { origin: THREE.Vector3; distance: number; splatIndex: number }[]) => { origin: THREE.Vector3; distance: number; splatIndex: number }[];
      };
      splatMesh?: THREE.Object3D;
      getRenderDimensions?: (out: THREE.Vector2) => void;
      isLoading?: () => boolean;
    };

    const camera = viewerAny.camera;
    const gsRaycaster = viewerAny.raycaster;
    const splatMesh = viewerAny.splatMesh;
    const threeScene = viewerAny.threeScene;
    if (!camera || !gsRaycaster || !splatMesh || !threeScene) return;

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let pickDimsLogged = false;

    const gs3dAdapter = {
      setFromCameraAndScreenPosition: gsRaycaster.setFromCameraAndScreenPosition.bind(gsRaycaster),
      intersectSplatMesh: gsRaycaster.intersectSplatMesh.bind(gsRaycaster),
      splatMesh,
      isLoading: () => (typeof viewerAny.isLoading === 'function' ? viewerAny.isLoading() : false),
    };

    const pickWorldFromEvent = (e: MouseEvent): PickResult | null => {
      camera.updateMatrixWorld(true);

      const physW = canvas.width;
      const physH = canvas.height;
      const gs3dDims = new THREE.Vector2();
      if (viewerAny.getRenderDimensions) viewerAny.getRenderDimensions(gs3dDims);

      const DIM_EPS = 2;
      const useGs3dDims =
        gs3dDims.x > 0 &&
        gs3dDims.y > 0 &&
        (Math.abs(gs3dDims.x - physW) > DIM_EPS || Math.abs(gs3dDims.y - physH) > DIM_EPS);
      const pickW = useGs3dDims ? gs3dDims.x : physW;
      const pickH = useGs3dDims ? gs3dDims.y : physH;
      const renderDims = new THREE.Vector2(pickW, pickH);

      if (!pickDimsLogged) {
        pickDimsLogged = true;
        console.log(
          `[Pick:dims] physical=${physW}x${physH}`,
          `pickUsing=${useGs3dDims ? 'gs3d' : 'canvas'} (${pickW}x${pickH})`,
          `cssClient=${canvas.clientWidth}x${canvas.clientHeight}`,
          `gs3dReported=${gs3dDims.x}x${gs3dDims.y}`,
          `DPR=${window.devicePixelRatio}`,
        );
      }

      // rect is in CSS pixels. Normalise to [0,1] relative to the visible canvas, then scale
      // to the same pixel space GS3D's raycaster uses (canvas backing store or getRenderDimensions).
      const rect = canvas.getBoundingClientRect();
      const mousePos = new THREE.Vector2();
      if (rect.width > 0 && rect.height > 0) {
        mousePos.x = ((e.clientX - rect.left) / rect.width) * pickW;
        mousePos.y = ((e.clientY - rect.top) / rect.height) * pickH;
      } else {
        const cw = Math.max(1, canvas.clientWidth);
        const ch = Math.max(1, canvas.clientHeight);
        mousePos.set((e.offsetX / cw) * pickW, (e.offsetY / ch) * pickH);
      }
      mousePos.x = THREE.MathUtils.clamp(mousePos.x, 0, pickW);
      mousePos.y = THREE.MathUtils.clamp(mousePos.y, 0, pickH);

      const baseMax = metadataRef.current
        ? maxSplatPickDistance(metadataRef.current.boundingBox)
        : 100;
      const maxDist = baseMax * sceneScaleRef.current;

      return pickSplatMeasure({
        camera,
        mousePos,
        renderDims,
        maxDist,
        splatMeshVisible: splatMesh.visible,
        splatTreeReady: splatTreeReadyRef.current,
        centers: splatCentersRef.current,
        centerGrid: splatCenterGridRef.current,
        gs3d: gs3dAdapter,
        groundPlane,
      });
    };

    const onClick = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastClickTimeRef.current < 300) return;
      lastClickTimeRef.current = now;
      try {
        const pick = pickWorldFromEvent(e);
        if (pick && pick.isSnapped) {
          handleAddMeasurePoint(pick.position);
        } else if (pick && !pick.isSnapped) {
          console.log('[GS3D] Click rejected — no splat surface under cursor');
        }
      } catch (err) {
        console.warn('[GS3D] Raycaster intersection failed (likely during mid-sort):', err);
      }
    };

    let lastHoverMs = 0;
    const lastPreviewWorld = new THREE.Vector3();
    let hasLastPreviewWorld = false;

    const onMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastHoverMs < MEASURE_HOVER_MIN_MS) return;
      lastHoverMs = now;
      try {
        const pick = pickWorldFromEvent(e);
        const ctx = measurePickCtxRef.current;
        const visible = ctx.measurePhase === 'calibrate' ? ctx.calibPoints : ctx.measurePoints;
        const previousWorld =
          visible.length > 0 ? visible[visible.length - 1].position.clone() : null;

        if (pick && hasLastPreviewWorld && lastPreviewWorld.distanceTo(pick.position) < MEASURE_PREVIEW_MOVE_EPS) {
          const hint = buildMeasurePickHint(
            ctx.measurePhase,
            ctx.calibPoints.length,
            ctx.measurePoints.length,
            pick,
          );
          setMeasurePickHint((prev) => (prev === hint ? prev : hint));
          return;
        }
        if (pick) {
          lastPreviewWorld.copy(pick.position);
          hasLastPreviewWorld = true;
        } else {
          hasLastPreviewWorld = false;
        }

        setMeasurePreviewInScene(threeScene, pick, camera, { previousWorld });
        const hint = buildMeasurePickHint(
          ctx.measurePhase,
          ctx.calibPoints.length,
          ctx.measurePoints.length,
          pick,
        );
        setMeasurePickHint((prev) => (prev === hint ? prev : hint));
      } catch {
        removeMeasurePreviewFromScene(threeScene);
        setMeasurePickHint(MEASURE_PICK_HINT_IDLE);
        hasLastPreviewWorld = false;
      }
    };

    const onLeave = () => {
      hasLastPreviewWorld = false;
      removeMeasurePreviewFromScene(threeScene);
      setMeasurePickHint(MEASURE_PICK_HINT_IDLE);
    };

    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      removeMeasurePreviewFromScene(threeScene);
    };
  }, [mode, measurePhase, calibration, loading, handleAddMeasurePoint]);

  const handleConfirmCalibration = useCallback(() => {
    if (calibPoints.length !== 2) return;
    const rawDist = calibPoints[0].position.distanceTo(calibPoints[1].position);
    const meters = parseFloat(meterInput) || 1.0;
    const scale = meters / rawDist;
    setCalibration({ points: calibPoints, rawDistance: rawDist, realMeters: meters, scaleFactor: scale });
    setMeasurePhase('measure');
    setMeasurePoints([]);
    setMeasuredDistance(null);
  }, [calibPoints, meterInput]);

  const handleResetCalibration = useCallback(() => {
    setCalibration(null);
    setCalibPoints([]);
    setMeasurePhase('calibrate');
    setMeasurePoints([]);
    setMeasuredDistance(null);
    setMeterInput('1.0');
  }, []);

  const handleClearMeasure = useCallback(() => { setMeasurePoints([]); setMeasuredDistance(null); }, []);

  const handleSnapshot = useCallback(() => {
    const glCanvas = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!glCanvas) return;

    // Force a render pass so the draw buffer is fresh (safety for preserveDrawingBuffer edge cases)
    try {
      const v = viewerRef.current;
      if (v) { v.update(); v.render(); }
    } catch { /* ignore */ }

    try {
      const w = glCanvas.width;
      const h = glCanvas.height;
      const dpr = window.devicePixelRatio || 1;

      // Create offscreen canvas at same resolution
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;

      // 1. Draw the 3D render
      ctx.drawImage(glCanvas, 0, 0);

      // 2. Build watermark lines
      const meta = metadataRef.current;
      const lines: string[] = [];

      if (meta) {
        lines.push(`Points: ${meta.pointCount.toLocaleString()}`);
        lines.push(`Size: ${(meta.fileSize / 1e6).toFixed(1)} MB`);
        lines.push(`Colors: ${meta.hasColors ? 'Yes' : 'No'}  |  Opacity: ${meta.hasOpacity ? 'Yes' : 'No'}`);
      }

      if (measuredDistance !== null) {
        lines.push(`Measurement: ${measuredDistance.toFixed(3)} m`);
      }
      if (calibration) {
        lines.push(`Scale: 1 unit = ${calibration.scaleFactor.toFixed(3)} m`);
      }

      const now = new Date();
      lines.push(now.toISOString().replace('T', '  ').slice(0, 21));

      // 3. Compute panel dimensions (scale font to canvas resolution)
      const baseFontSize = Math.max(11, Math.round(12 * dpr));
      const titleFontSize = Math.max(12, Math.round(13 * dpr));
      const lineHeight = Math.round(baseFontSize * 1.7);
      const padX = Math.round(14 * dpr);
      const padY = Math.round(12 * dpr);
      const margin = Math.round(16 * dpr);

      ctx.font = `${baseFontSize}px monospace`;
      let maxTextWidth = 0;
      for (const line of lines) {
        const tw = ctx.measureText(line).width;
        if (tw > maxTextWidth) maxTextWidth = tw;
      }

      const title = 'Gaussian Splat Snapshot';
      ctx.font = `bold ${titleFontSize}px monospace`;
      const titleWidth = ctx.measureText(title).width;
      if (titleWidth > maxTextWidth) maxTextWidth = titleWidth;

      const panelW = maxTextWidth + padX * 2;
      const panelH = titleFontSize + lineHeight * lines.length + padY * 2 + Math.round(6 * dpr);
      const panelX = margin;
      const panelY = h - panelH - margin;

      // 4. Draw semi-transparent panel background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.beginPath();
      const r = Math.round(8 * dpr);
      ctx.moveTo(panelX + r, panelY);
      ctx.lineTo(panelX + panelW - r, panelY);
      ctx.quadraticCurveTo(panelX + panelW, panelY, panelX + panelW, panelY + r);
      ctx.lineTo(panelX + panelW, panelY + panelH - r);
      ctx.quadraticCurveTo(panelX + panelW, panelY + panelH, panelX + panelW - r, panelY + panelH);
      ctx.lineTo(panelX + r, panelY + panelH);
      ctx.quadraticCurveTo(panelX, panelY + panelH, panelX, panelY + panelH - r);
      ctx.lineTo(panelX, panelY + r);
      ctx.quadraticCurveTo(panelX, panelY, panelX + r, panelY);
      ctx.closePath();
      ctx.fill();

      // Subtle border
      ctx.strokeStyle = 'rgba(239, 231, 82, 0.25)';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.stroke();

      // 5. Draw title
      let textY = panelY + padY + titleFontSize;
      ctx.font = `bold ${titleFontSize}px monospace`;
      ctx.fillStyle = '#efe752';
      ctx.fillText(title, panelX + padX, textY);

      // 6. Draw info lines
      textY += Math.round(6 * dpr);
      ctx.font = `${baseFontSize}px monospace`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';

      for (const line of lines) {
        textY += lineHeight;
        // Highlight measurement value in accent color
        if (line.startsWith('Measurement:')) {
          ctx.fillStyle = '#efe752';
          ctx.fillText(line, panelX + padX, textY);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        } else if (line.startsWith('Scale:')) {
          ctx.fillStyle = '#f5ec99';
          ctx.fillText(line, panelX + padX, textY);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        } else {
          ctx.fillText(line, panelX + padX, textY);
        }
      }

      // 7. Small branding in top-right corner
      const brand = 'METROA';
      ctx.font = `bold ${Math.max(10, Math.round(10 * dpr))}px monospace`;
      ctx.fillStyle = 'rgba(239, 231, 82, 0.4)';
      const brandW = ctx.measureText(brand).width;
      ctx.fillText(brand, w - brandW - margin, margin + Math.round(10 * dpr));

      // 8. Download
      const a = document.createElement('a');
      a.href = offscreen.toDataURL('image/png');
      a.download = `gaussian-splat-snapshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.warn('Snapshot failed:', err);
    }
  }, [measuredDistance, calibration]);

  const handleReset = useCallback(() => {
    setMode('orbit');
    handleResetCalibration();
  }, [handleResetCalibration]);

  const handleDownloadKsplat = useCallback(async () => {
    if (!modelUrl) return;
    setKsplatError(null);
    setKsplatBusy(true);
    try {
      const apiBase = getApiBaseUrl();
      const fullUrl = modelUrl.startsWith('http') ? modelUrl : `${apiBase}${modelUrl}`;
      const resp = await fetch(fullUrl);
      if (!resp.ok) throw new Error(`Fetch failed: HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const b0 = new Uint8Array(buf, 0, Math.min(3, buf.byteLength));
      if (b0.length >= 2 && b0[0] === 0x1f && b0[1] === 0x8b) {
        throw new Error('Need decompressed PLY (not raw .ply.gz) for browser .ksplat conversion.');
      }
      if (b0.length < 3 || b0[0] !== 0x70 || b0[1] !== 0x6c || b0[2] !== 0x79) {
        throw new Error('Response is not a PLY file.');
      }
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
      try {
        const ma = Math.max(0, Math.min(255, Math.round(loadMinAlpha)));
        const sh = Math.min(2, Math.max(0, shDisplayDegree)) as 0 | 1 | 2;
        const splatBuffer = (await PlyLoader.loadFromURL(
          blobUrl,
          undefined,
          false,
          undefined,
          ma,
          1,
          true,
          sh,
        )) as { bufferData: ArrayBuffer };
        KSplatLoader.downloadFile(splatBuffer, `model-${Date.now()}.ksplat`);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } catch (e) {
      setKsplatError(e instanceof Error ? e.message : String(e));
    } finally {
      setKsplatBusy(false);
    }
  }, [modelUrl, loadMinAlpha, shDisplayDegree]);

  useEffect(() => { if (mode !== 'measure') { handleResetCalibration(); } }, [mode, handleResetCalibration]);

  if (!modelUrl) return null;

  return (
    <div className="w-full h-full relative group bg-black rounded-xl overflow-hidden">
      {/* Viewer container — the Viewer class creates its own <canvas> inside */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Loading overlay */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/80">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[#efe752]/35 border-t-[#efe752] rounded-full animate-spin" />
            <span className="text-[#f5ec99]/70 font-mono text-xs">Loading Gaussian Splats...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute top-12 left-3 right-3 z-30 bg-red-900/80 backdrop-blur-md text-white text-xs p-3 rounded-lg border border-red-500/38 font-mono break-all">
          <span className="text-red-300 font-bold">Viewer Error: </span>{error}
        </div>
      )}

      {!loading && !error && (
        <div className="absolute bottom-4 right-3 z-20 flex flex-col items-end gap-2 max-w-[min(100vw-1.5rem,260px)]">
          {ksplatError && (
            <div className="text-[10px] text-red-300 font-mono bg-black/85 border border-red-500/28 rounded px-2 py-1">
              {ksplatError}
            </div>
          )}
          {displayPanelOpen && (
            <div className="w-full min-w-[200px] bg-black/95 backdrop-blur-md border border-white/[0.22] rounded-xl p-3 text-[10px] text-white/80 font-mono space-y-3">
              {!forceLegacyGs3dWorkers() && (
                <div className="text-white/45 text-[9px] leading-snug">
                  {globalThis.crossOriginIsolated === true
                    ? 'crossOriginIsolated: GPU-accelerated sort + shared worker memory enabled.'
                    : 'crossOriginIsolated=false: sort flags disabled (set COOP/COEP per ARCHITECTURE.md).'}
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-[#f5ec99]">Min alpha (PLY reload ~0.5s)</span>
                <input
                  type="range"
                  min={1}
                  max={255}
                  value={minAlpha}
                  onChange={(e) => setMinAlpha(Number(e.target.value))}
                  className="w-full accent-[#efe752]"
                />
                <span className="text-white/40">{minAlpha}</span>
              </label>
              <div className="space-y-1">
                <span className={cn('text-[#f5ec99]', !liveViewerApis.sh && 'text-white/40')}>
                  SH level (live)
                </span>
                <div className="flex gap-1">
                  {([0, 1, 2] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={!liveViewerApis.sh}
                      onClick={() => setShDisplayDegree(d)}
                      className={cn(
                        'flex-1 py-1 rounded border text-[10px] transition-colors',
                        !liveViewerApis.sh && 'opacity-40 cursor-not-allowed',
                        shDisplayDegree === d
                          ? 'border-[#efe752]/75 bg-[#efe752]/15 text-[#efe752]'
                          : 'border-white/[0.26] text-white/50 hover:border-white/[0.34]',
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                {!liveViewerApis.sh && (
                  <p className="text-[9px] text-white/35">SH fixed at Viewer init on this library build.</p>
                )}
              </div>
              <label className={cn('block space-y-1', !liveViewerApis.scale && 'opacity-50')}>
                <span className={cn('text-[#f5ec99]', !liveViewerApis.scale && 'text-white/40')}>
                  Splat scale (live)
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.05}
                  value={splatScale}
                  disabled={!liveViewerApis.scale}
                  onChange={(e) => setSplatScale(Number(e.target.value))}
                  className="w-full accent-[#efe752] disabled:cursor-not-allowed"
                />
                <span className="text-white/40">{splatScale.toFixed(2)}</span>
                {!liveViewerApis.scale && (
                  <p className="text-[9px] text-white/35">Splat scale not supported live on this library build.</p>
                )}
              </label>
              <button
                type="button"
                disabled={ksplatBusy}
                onClick={handleDownloadKsplat}
                className="w-full flex items-center justify-center gap-1 py-1.5 rounded bg-[#efe752]/10 text-[#efe752] border border-[#efe752]/48 hover:bg-[#efe752]/20 disabled:opacity-40"
              >
                <Download className="w-3 h-3" /> {ksplatBusy ? 'Working…' : 'Download .ksplat'}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setDisplayPanelOpen((o) => !o)}
            className={cn(
              'p-2 rounded-lg border font-mono text-xs flex items-center gap-2 shadow-lg',
              displayPanelOpen
                ? 'bg-[#efe752]/15 border-[#efe752]/35 text-[#efe752]'
                : 'bg-black/75 border-white/[0.18] text-white/60 hover:text-white',
            )}
          >
            <SlidersHorizontal className="w-4 h-4" /> Display
          </button>
        </div>
      )}

      {/* ── Top-Left: Mode Indicator ─────────────────────────────────────── */}
      <div className="absolute top-3 left-3 z-10">
        <div className="bg-black/70 backdrop-blur-md text-white/80 text-xs px-3 py-1.5 rounded-lg border border-white/[0.18] font-mono flex items-center gap-2">
          {mode === 'orbit' && <><MousePointer className="w-3 h-3" /> Orbit</>}
          {mode === 'walkthrough' && <><Footprints className="w-3 h-3" /> Walk-Through</>}
          {mode === 'measure' && <><Ruler className="w-3 h-3" /> Measure</>}
        </div>
      </div>

      {/* ── Top-Right: Toolbar ────────────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        <ToolbarButton icon={<MousePointer className="w-3.5 h-3.5" />} label="Orbit" active={mode === 'orbit'} onClick={() => setMode('orbit')} />
        <ToolbarButton icon={<Footprints className="w-3.5 h-3.5" />} label="Walk" active={mode === 'walkthrough'} onClick={() => setMode('walkthrough')} />
        <ToolbarButton icon={<Ruler className="w-3.5 h-3.5" />} label="Measure" active={mode === 'measure'} onClick={() => setMode('measure')} />

        <div className="border-t border-white/[0.18] my-1" />

        <ToolbarButton icon={<Camera className="w-3.5 h-3.5" />} label="Snapshot" onClick={handleSnapshot} />
        <ToolbarButton icon={<RotateCcw className="w-3.5 h-3.5" />} label="Reset" onClick={handleReset} />
        <ToolbarButton icon={<Info className="w-3.5 h-3.5" />} label="Help" active={showHelp} onClick={() => setShowHelp(!showHelp)} />
      </div>

      {/* ── Measure Sub-Controls ──────────────────────────────────────────── */}
      {mode === 'measure' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-[min(100vw-1.5rem,42rem)]">
          <div className="bg-black/80 backdrop-blur-md border border-white/[0.18] rounded-xl px-4 py-2.5 flex flex-col gap-1.5 font-mono text-xs">
            <div className="flex flex-wrap items-center gap-3">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${measurePhase === 'calibrate' ? 'bg-[#f5ec99]/15 text-[#f5ec99]' : 'bg-[#efe752]/15 text-[#efe752]'}`}>
              {measurePhase === 'calibrate' ? 'STEP 1: Calibrate' : 'STEP 2: Measure'}
            </span>
            <div className="border-l border-white/[0.18] h-5" />

            {measurePhase === 'calibrate' ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={`flex items-center gap-1 ${calibPoints.length >= 1 ? 'text-[#f5ec99]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> A {calibPoints.length >= 1 ? '✓' : ''}
                  </span>
                  <span className="text-white/15">&rarr;</span>
                  <span className={`flex items-center gap-1 ${calibPoints.length >= 2 ? 'text-[#efe752]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> B {calibPoints.length >= 2 ? '✓' : ''}
                  </span>
                </div>
                {calibPoints.length === 2 && (
                  <>
                    <div className="border-l border-white/[0.18] h-5" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-white/40">=</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={meterInput}
                        onChange={e => setMeterInput(e.target.value)}
                        className="w-16 bg-black border border-white/[0.22] rounded px-1.5 py-0.5 text-white text-xs font-mono text-center focus:border-[#efe752]/40 focus:outline-none"
                      />
                      <span className="text-white/40">m</span>
                    </div>
                    <button
                      onClick={handleConfirmCalibration}
                      className="px-2 py-0.5 rounded bg-[#efe752]/15 text-[#efe752] border border-[#efe752]/40 hover:bg-[#efe752]/25 transition-colors"
                    >
                      Confirm
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className={`flex items-center gap-1 ${measurePoints.length >= 1 ? 'text-[#f5ec99]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> A {measurePoints.length >= 1 ? '✓' : ''}
                  </span>
                  <span className="text-white/15">&rarr;</span>
                  <span className={`flex items-center gap-1 ${measurePoints.length >= 2 ? 'text-[#efe752]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> B {measurePoints.length >= 2 ? '✓' : ''}
                  </span>
                </div>
                {measuredDistance !== null && (
                  <>
                    <div className="border-l border-white/[0.18] h-5" />
                    <div className="flex items-center gap-2">
                      <Ruler className="w-3.5 h-3.5 text-[#efe752]" />
                      <span className="text-[#efe752] text-sm font-semibold">{measuredDistance.toFixed(3)}</span>
                      <span className="text-white/30">m</span>
                    </div>
                  </>
                )}
                {measurePoints.length > 0 && (
                  <>
                    <div className="border-l border-white/[0.18] h-5" />
                    <button onClick={handleClearMeasure} className="flex items-center gap-1 text-white/40 hover:text-white transition-colors">
                      <Trash2 className="w-3 h-3" /> Clear
                    </button>
                  </>
                )}
                <div className="border-l border-white/[0.18] h-5" />
                <button onClick={handleResetCalibration} className="flex items-center gap-1 text-[#f5ec99]/60 hover:text-[#f5ec99] transition-colors text-[10px]">
                  Recalibrate
                </button>
                {calibration && (
                  <span className="text-white/20 text-[9px]">
                    (1u = {calibration.scaleFactor.toFixed(3)}m)
                  </span>
                )}
              </>
            )}
            </div>
            <p className="text-[10px] text-white/45 leading-snug pl-0.5">{measurePickHint}</p>
          </div>
        </div>
      )}

      {/* ── Bottom-Center: Context Help ───────────────────────────────────── */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10">
        <div className="bg-black/70 backdrop-blur-md text-white/50 text-[10px] px-3 py-1.5 rounded-lg border border-white/[0.18] font-mono">
          {mode === 'orbit' && 'Left: Rotate  |  Right: Pan  |  Scroll: Zoom'}
          {mode === 'walkthrough' && 'Click to lock  |  WASD: Move  |  Space/Shift: Up/Down  |  ESC: Unlock'}
          {mode === 'measure' && (measurePhase === 'calibrate'
            ? 'Hover previews the pick; click two reference points, then enter their real distance in meters'
            : 'Hover previews the pick; click two points to measure the calibrated distance')}
        </div>
      </div>

      {/* ── Help Panel ────────────────────────────────────────────────────── */}
      {showHelp && (
        <div className="absolute top-14 right-3 z-20 w-64">
          <div className="bg-black/95 backdrop-blur-md border border-white/[0.18] rounded-xl p-4 text-xs text-white/70 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white text-sm">Viewer Controls</span>
              <button onClick={() => setShowHelp(false)} className="text-white/40 hover:text-white"><X className="w-3 h-3" /></button>
            </div>
            <div className="space-y-2">
              <HelpItem icon={<MousePointer className="w-3 h-3" />} title="Orbit Mode">Left-click drag to rotate. Right-click drag to pan. Scroll to zoom.</HelpItem>
              <HelpItem icon={<Footprints className="w-3 h-3" />} title="Walk-Through">Click to lock cursor. WASD to move. Mouse to look. Space/Shift for up/down.</HelpItem>
              <HelpItem icon={<Ruler className="w-3 h-3" />} title="Measure">Step 1: Click two reference points and enter their known distance. Step 2: Measure any distance in meters.</HelpItem>
              <HelpItem icon={<Camera className="w-3 h-3" />} title="Snapshot">Captures the current view as a PNG image.</HelpItem>
              <HelpItem icon={<SlidersHorizontal className="w-3 h-3" />} title="Display panel">
                Min alpha culls faint splats (reloads scene). SH 0/1/2 and splat scale update the live render. Download .ksplat uses the same pipeline as the official GaussianSplats3D demo. If the page is not cross-origin isolated, GPU sort is disabled automatically.
              </HelpItem>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Toolbar Button ───────────────────────────────────────────────────────────

function ToolbarButton({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void;
}) {
  const color = active
    ? 'bg-[#efe752]/15 text-[#efe752] border-[#efe752]/40'
    : 'bg-black/70 text-white/50 border-white/[0.22] hover:text-white hover:bg-white/[0.06]';
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition-all duration-150 border ${color} backdrop-blur-md`}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ── Help Item ────────────────────────────────────────────────────────────────

function HelpItem({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-white/80 font-medium mb-0.5">{icon}{title}</div>
      <p className="text-white/40 leading-relaxed pl-5">{children}</p>
    </div>
  );
}
