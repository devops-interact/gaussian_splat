import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArcRotateCamera,
  AxesViewer,
  Color3,
  Color4,
  Engine,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Tools,
  UniversalCamera,
  Vector2,
  Vector3,
} from '@babylonjs/core';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { GaussianSplattingMesh } from '@babylonjs/core/Meshes/GaussianSplatting/gaussianSplattingMesh';
import '@babylonjs/loaders/SPLAT/splatFileLoader';
import { isAxiosError, isCancel } from 'axios';
import { getApiBaseUrl } from '@/lib/apiBase';
import type { InitialCameraResponse } from '@/api/jobs';
import { getInitialCamera } from '@/api/jobs';
import type { ModelMetadataResponse } from '@/types/job';
import {
  buildCenterGridAcceleration,
  buildSplatCenterWorldCache,
  filterSplatsByMinAlpha,
  maxSplatPickDistance,
  pickSplatMeasure,
  type PickResult,
  type SplatCenterGridAccel,
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
  position: Vector3;
}

type MeasurePhase = 'calibrate' | 'measure';

interface CalibrationState {
  points: MeasurePoint[];
  rawDistance: number;
  realMeters: number;
  scaleFactor: number;
}

interface BabylonViewerCtx {
  engine: Engine;
  scene: Scene;
  orbitCamera: ArcRotateCamera;
  walkCamera: UniversalCamera;
  splatMesh: GaussianSplattingMesh | null;
}

/** Bbox fallback camera: eye distance scales as diagonal × mult (lower = closer / fills frame more). */
const BBOX_CAM_DIST_MULT = 0.92;
/** Floor so tiny reconstructions are not framed from too far away (world units). */
const BBOX_CAM_DIST_MIN = 1.75;

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

const VIEWER_SCENE_SCALE_MIN = 0.25;
const VIEWER_SCENE_SCALE_MAX = 10;

/** Uniform world scale for splat mesh + camera (Vite build-time). 1 = default. */
function parseViewerSceneScale(): number {
  const raw = import.meta.env.VITE_VIEWER_SCENE_SCALE;
  if (raw === undefined || raw === '') return 1;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(VIEWER_SCENE_SCALE_MIN, Math.min(VIEWER_SCENE_SCALE_MAX, n));
}

/** Orbit dolly limits vs effective scene diagonal (after mesh scale). */
const ORBIT_MIN_DIST_FRAC = 0.035;
const ORBIT_MAX_DIST_MULT = 150;

function applyOrbitZoomLimitsFromDiagonal(orbitCam: ArcRotateCamera, effectiveDiagonal: number): void {
  if (!(effectiveDiagonal > 0)) return;
  const minD = Math.max(1e-4, effectiveDiagonal * ORBIT_MIN_DIST_FRAC);
  const maxD = Math.max(minD * 2, effectiveDiagonal * ORBIT_MAX_DIST_MULT);
  orbitCam.lowerRadiusLimit = minD;
  orbitCam.upperRadiusLimit = maxD;
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

const MEASURE_PICK_HINT_IDLE =
  'Move over the splat cloud — yellow preview marks the splat center you will select…';

/** Hover pre-select (snapped pick): saturated yellow, distinct from placed-point blue in-scene. */
const MEASURE_PREVIEW_YELLOW = new Color3(1, 0.87, 0);
const MEASURE_PREVIEW_YELLOW_LINES = new Color3(0.94, 0.77, 0.1);
const MEASURE_PREVIEW_CONNECTOR = new Color3(1, 0.93, 0.6);
const MEASURE_PREVIEW_RED = new Color3(1, 0.42, 0.42);

/** Committed measure points in the scene. */
const MEASURE_PLACED_A = new Color3(0.43, 0.72, 1);
const MEASURE_PLACED_B = new Color3(0.18, 0.56, 1);
const MEASURE_PLACED_LINE = new Color3(0.49, 0.78, 1);

function makeOverlayMaterial(scene: Scene, color: Color3, alpha: number): StandardMaterial {
  const mat = new StandardMaterial('measureMat', scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color;
  mat.disableLighting = true;
  mat.alpha = alpha;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  return mat;
}

/**
 * Persistent hover-preview gizmo. All meshes and materials are created once per measure
 * session and repositioned per hover tick — no dispose/recreate churn on mousemove.
 */
class MeasurePreviewGizmo {
  private readonly ring: Mesh;
  private readonly dot: Mesh;
  private readonly ghost: Mesh;
  private readonly hLine: LinesMesh;
  private readonly vLine: LinesMesh;
  private readonly dash: LinesMesh;
  private readonly snappedMat: StandardMaterial;
  private readonly unsnappedMat: StandardMaterial;
  private readonly linePts: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private readonly dashPts: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private disposed = false;

  constructor(scene: Scene, worldUnit: number) {
    this.snappedMat = makeOverlayMaterial(scene, MEASURE_PREVIEW_YELLOW, 1);
    this.unsnappedMat = makeOverlayMaterial(scene, MEASURE_PREVIEW_RED, 1);

    // Unit-size geometry; per-tick sizing is applied through mesh scaling.
    this.ring = MeshBuilder.CreateTorus(
      'measureRing',
      { diameter: 1, thickness: 0.08, tessellation: 24 },
      scene,
    );
    this.dot = MeshBuilder.CreateSphere('measureDot', { diameter: 0.3, segments: 8 }, scene);
    this.ghost = MeshBuilder.CreateSphere('measureGhost', { diameter: 1, segments: 12 }, scene);
    this.ghost.scaling.setAll(worldUnit);
    this.ghost.material = this.snappedMat;
    this.ghost.visibility = 0.4;

    this.hLine = MeshBuilder.CreateLines(
      'measureH',
      { points: [new Vector3(), new Vector3()], updatable: true },
      scene,
    );
    this.vLine = MeshBuilder.CreateLines(
      'measureV',
      { points: [new Vector3(), new Vector3()], updatable: true },
      scene,
    );
    this.dash = MeshBuilder.CreateDashedLines(
      'measureDash',
      {
        points: [new Vector3(), new Vector3(0, worldUnit, 0)],
        dashSize: worldUnit * 1.9,
        gapSize: worldUnit * 1.25,
        updatable: true,
      },
      scene,
    );
    this.dash.color = MEASURE_PREVIEW_CONNECTOR;
    this.dash.alpha = 0.55;

    for (const mesh of [this.ring, this.dot, this.ghost, this.hLine, this.vLine, this.dash]) {
      mesh.renderingGroupId = 2;
      mesh.isPickable = false;
      mesh.setEnabled(false);
    }
  }

  update(pick: PickResult, cameraPosition: Vector3, previousWorld: Vector3 | null): void {
    if (this.disposed) return;
    const { position, isSnapped } = pick;
    const hasCenterId = typeof pick.splatCenterIndex === 'number';
    const mat = isSnapped ? this.snappedMat : this.unsnappedMat;
    const lineColor = isSnapped ? MEASURE_PREVIEW_YELLOW_LINES : MEASURE_PREVIEW_RED;
    const camDist = Vector3.Distance(cameraPosition, position);
    const scaleBase = Math.max(0.01, camDist * 0.012);
    const scale = hasCenterId && isSnapped ? scaleBase * 1.2 : scaleBase;

    this.ring.position.copyFrom(position);
    this.ring.scaling.setAll(scale);
    this.ring.lookAt(cameraPosition);
    this.ring.material = mat;
    this.ring.visibility = isSnapped ? 0.75 : 0.4;
    this.ring.setEnabled(true);

    this.dot.position.copyFrom(position);
    this.dot.scaling.setAll(scale);
    this.dot.material = mat;
    this.dot.visibility = isSnapped ? 0.9 : 0.5;
    this.dot.setEnabled(true);

    const halfLen = scale * 1.2;
    const toCamera = cameraPosition.subtract(position).normalize();
    const right = Vector3.Cross(toCamera, Vector3.Up()).normalize();
    const localUp = Vector3.Cross(right, toCamera).normalize();

    this.linePts[0].copyFrom(position).addInPlace(right.scale(-halfLen));
    this.linePts[1].copyFrom(position).addInPlace(right.scale(halfLen));
    MeshBuilder.CreateLines('measureH', { points: this.linePts, instance: this.hLine });
    this.hLine.color = lineColor;
    this.hLine.setEnabled(true);

    this.linePts[0].copyFrom(position).addInPlace(localUp.scale(-halfLen));
    this.linePts[1].copyFrom(position).addInPlace(localUp.scale(halfLen));
    MeshBuilder.CreateLines('measureV', { points: this.linePts, instance: this.vLine });
    this.vLine.color = lineColor;
    this.vLine.alpha = isSnapped ? 0.6 : 0.3;
    this.vLine.setEnabled(true);

    this.ghost.position.copyFrom(position);
    this.ghost.setEnabled(isSnapped);

    if (isSnapped && previousWorld) {
      this.dashPts[0].copyFrom(previousWorld);
      this.dashPts[1].copyFrom(position);
      MeshBuilder.CreateDashedLines('measureDash', { points: this.dashPts, instance: this.dash });
      this.dash.setEnabled(true);
    } else {
      this.dash.setEnabled(false);
    }
  }

  hide(): void {
    if (this.disposed) return;
    for (const mesh of [this.ring, this.dot, this.ghost, this.hLine, this.vLine, this.dash]) {
      mesh.setEnabled(false);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [this.ring, this.dot, this.ghost, this.hLine, this.vLine, this.dash]) {
      mesh.dispose(false, false);
    }
    this.snappedMat.dispose();
    this.unsnappedMat.dispose();
  }
}

function buildMeasurePickHint(
  measurePhase: MeasurePhase,
  calibLen: number,
  measureLen: number,
  pick: PickResult | null,
  segmentText?: string | null,
): string {
  if (!pick) return MEASURE_PICK_HINT_IDLE;
  if (!pick.isSnapped) {
    return 'No splat center under cursor — move over the reconstruction.';
  }
  const idx =
    typeof pick.splatCenterIndex === 'number' ? ` · splat #${pick.splatCenterIndex}` : '';
  const seg = segmentText ? ` · ${segmentText}` : '';
  if (measurePhase === 'calibrate') {
    if (calibLen === 0) return `Preview: calibration A${idx} · click to place`;
    if (calibLen === 1) return `Preview: calibration B${idx}${seg} · click to place`;
    return `Preview: click replaces calibration (new A)${idx}`;
  }
  if (measureLen === 0) return `Preview: measure A${idx} · click to place`;
  if (measureLen === 1) return `Preview: measure B${idx}${seg} · click to place`;
  return `Preview: click starts a new pair (new A)${idx}`;
}

function addSceneOverlays(scene: Scene) {
  const half = 15;
  const lines: Vector3[][] = [];
  for (let i = -half; i <= half; i++) {
    lines.push([new Vector3(i, -0.01, -half), new Vector3(i, -0.01, half)]);
    lines.push([new Vector3(-half, -0.01, i), new Vector3(half, -0.01, i)]);
  }
  const grid = MeshBuilder.CreateLineSystem('grid', { lines }, scene);
  grid.color = new Color3(0.11, 0.1, 0.06);
  grid.renderingGroupId = 1;
  grid.isPickable = false;

  new AxesViewer(scene, 1.5, 1);
}

function setupCamerasFromPose(
  scene: Scene,
  canvas: HTMLCanvasElement,
  position: [number, number, number],
  lookAt: [number, number, number],
  cameraUp: [number, number, number],
): { orbitCamera: ArcRotateCamera; walkCamera: UniversalCamera } {
  const target = new Vector3(lookAt[0], lookAt[1], lookAt[2]);
  const eye = new Vector3(position[0], position[1], position[2]);
  const up = new Vector3(cameraUp[0], cameraUp[1], cameraUp[2]);

  const orbitCamera = new ArcRotateCamera('orbit', -Math.PI / 2, Math.PI / 2.5, 5, target, scene);
  orbitCamera.upVector = up;
  orbitCamera.setPosition(eye);
  orbitCamera.setTarget(target);
  orbitCamera.attachControl(canvas, true);
  orbitCamera.minZ = 0.01;
  orbitCamera.maxZ = 10000;

  const walkCamera = new UniversalCamera('walk', eye.clone(), scene);
  walkCamera.setTarget(target);
  walkCamera.upVector = up.clone();
  walkCamera.minZ = 0.01;
  walkCamera.maxZ = 10000;
  walkCamera.speed = 0;

  scene.activeCamera = orbitCamera;
  return { orbitCamera, walkCamera };
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
        `[Babylon-diag] Scale (log-space): min=${minS.toFixed(3)}, max=${maxS.toFixed(3)}, ` +
        `mean=${(sumS / (n * 3)).toFixed(3)}, sub-pixel(<-6): ${subPixel}/${n * 3} (${(subPixel / (n * 3) * 100).toFixed(1)}%)`,
      );
      for (let i = 0; i < samples; i++) {
        const base = i * bytesPerVertex;
        const s0 = dv.getFloat32(base + sOff, true);
        const s1 = dv.getFloat32(base + sOff + 4, true);
        const s2 = dv.getFloat32(base + sOff + 8, true);
        console.log(
          `[Babylon-diag] v${i}: scale=[${s0.toFixed(3)},${s1.toFixed(3)},${s2.toFixed(3)}] ` +
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
      console.log(`[Babylon-diag] Opacity (logit): min=${minO.toFixed(3)}, max=${maxO.toFixed(3)}`);
      console.log(`[Babylon-diag] Opacity (sigmoid): mean=${(sumSig / n).toFixed(4)}, >0.5: ${highCount}/${n}`);
    }
  } catch (e) {
    console.warn('[Babylon-diag] Scale/opacity diagnostic failed:', e);
  }
}

// ── Main Viewer Component ────────────────────────────────────────────────────

export default function Viewer3D({
  modelUrl,
  jobId = null,
  prefetchedJobModelMetadata = null,
  onModelMetadata,
}: Viewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<BabylonViewerCtx | null>(null);

  const walkthroughRef = useRef<{ active: boolean; keys: Set<string>; isLocked: boolean; rafId: number | null }>({
    active: false, keys: new Set(), isLocked: false, rafId: null,
  });

  const metadataRef = useRef<ModelMetadata | null>(null);
  const sceneScaleRef = useRef(1);
  /** World-space size unit for measure markers, scaled from the scene diagonal at load. */
  const worldUnitRef = useRef(0.024);
  /** Walkthrough speed (world units/sec), scaled from the scene diagonal at load. */
  const walkSpeedRef = useRef(3);
  const splatCentersRef = useRef<Float32Array | null>(null);
  const splatCenterGridRef = useRef<SplatCenterGridAccel | null>(null);
  const originalSplatsRef = useRef<ArrayBuffer | null>(null);
  const onMetadataRef = useRef(onModelMetadata);
  onMetadataRef.current = onModelMetadata;

  const [mode, setMode] = useState<ViewerMode>('orbit');
  const [showHelp, setShowHelp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [measurePhase, setMeasurePhase] = useState<MeasurePhase>('calibrate');
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [calibPoints, setCalibPoints] = useState<MeasurePoint[]>([]);
  const [meterInput, setMeterInput] = useState('1.0');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);
  const [measurePickHint, setMeasurePickHint] = useState(MEASURE_PICK_HINT_IDLE);

  const visibleMeasurePoints = measurePhase === 'calibrate' ? calibPoints : measurePoints;

  const measurePickCtxRef = useRef({
    measurePhase,
    calibPoints,
    measurePoints,
    calibration,
  });
  measurePickCtxRef.current = {
    measurePhase,
    calibPoints,
    measurePoints,
    calibration,
  };

  const [minAlpha, setMinAlpha] = useState(1);
  const [loadMinAlpha, setLoadMinAlpha] = useState(1);
  const [shDisplayDegree, setShDisplayDegree] = useState<0 | 1 | 2>(2);
  const [displayPanelOpen, setDisplayPanelOpen] = useState(false);
  const [splatDownloadBusy, setSplatDownloadBusy] = useState(false);
  const [splatDownloadError, setSplatDownloadError] = useState<string | null>(null);
  const [liveViewerApis, setLiveViewerApis] = useState<{ sh: boolean }>({ sh: false });

  useEffect(() => {
    const id = window.setTimeout(() => setLoadMinAlpha(minAlpha), 450);
    return () => clearTimeout(id);
  }, [minAlpha]);

  useEffect(() => {
    setSplatDownloadError(null);
  }, [modelUrl]);

  useEffect(() => {
    if (mode !== 'measure') setMeasurePickHint(MEASURE_PICK_HINT_IDLE);
  }, [mode]);

  const rebuildCenterCache = useCallback((mesh: GaussianSplattingMesh | null) => {
    if (!mesh) {
      splatCentersRef.current = null;
      splatCenterGridRef.current = null;
      return;
    }
    const buf = buildSplatCenterWorldCache(mesh);
    splatCentersRef.current = buf;
    splatCenterGridRef.current = buf ? buildCenterGridAcceleration(buf) : null;
    if (buf) {
      console.log(
        '[Babylon] Splat center cache built:',
        buf.length / 3,
        'points',
        splatCenterGridRef.current ? '(spatial grid on)' : '(linear pick)',
      );
    }
  }, []);

  // ── Initialize Babylon viewer ────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !modelUrl) return;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;

    const apiBase = getApiBaseUrl();
    const fullUrl = modelUrl.startsWith('http') ? modelUrl : `${apiBase}${modelUrl}`;

    setLoading(true);
    setError(null);
    const initialCameraAbort = new AbortController();

    (async () => {
      try {
        console.log('[Babylon] phase: init chain start');
        const canvas = canvasRef.current!;

        const initialCameraPromise: Promise<InitialCameraResponse | null> = jobId
          ? getInitialCamera(jobId, { signal: initialCameraAbort.signal }).catch((e: unknown) => {
              if (isCancel(e)) return null;
              if (
                isAxiosError(e) &&
                (e.code === 'ECONNABORTED' || (typeof e.message === 'string' && e.message.toLowerCase().includes('timeout')))
              ) {
                console.info('[Babylon] phase: initial_camera timed out — using bbox default');
                return null;
              }
              console.info('[Babylon] phase: initial_camera unavailable — using bbox default');
              return null;
            })
          : Promise.resolve(null);

        console.log('[Babylon] phase: PLY fetch start', fullUrl);
        const plySignal = plyFetchAbortSignal();
        const response = await fetch(fullUrl, plySignal != null ? { signal: plySignal } : {});
        if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (disposed) return;
        console.log('[Babylon] phase: PLY fetch done', buffer.byteLength, 'bytes');

        const b0 = new Uint8Array(buffer, 0, Math.min(3, buffer.byteLength));
        if (b0.length >= 2 && b0[0] === 0x1f && b0[1] === 0x8b) {
          throw new Error(
            'Received gzip-compressed data without decompression. Use GET /api/jobs/{id}/model (not a raw .ply.gz URL).',
          );
        }
        if (b0.length < 3 || b0[0] !== 0x70 || b0[1] !== 0x6c || b0[2] !== 0x79) {
          throw new Error('Response does not look like a PLY file (expected ASCII header "ply").');
        }

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

        if (canUseServerMeta) {
          modelMeta = modelMetadataFromJobResponse(prefetched!, buffer.byteLength);
          bbMin = modelMeta.boundingBox.min;
          bbMax = modelMeta.boundingBox.max;
          console.log(`[Babylon] Using server job metadata: ${modelMeta.pointCount} verts (skipped client PLY parse)`);
        } else {
          const meta = parsePLYForMeta(buffer);
          if (meta.vertexCount === 0) throw new Error('No visible points in PLY');
          console.log(
            `[Babylon] PLY parsed: ${meta.vertexCount}/${meta.totalVertices} verts, center=[${meta.center.map((v) => v.toFixed(2))}]`,
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
        }

        const fRestProps = modelMeta.properties.filter((p) => /^f_rest_\d+$/.test(p));
        if (fRestProps.length > 0 && fRestProps.length % 3 !== 0) {
          console.warn(
            '[Babylon] PLY has',
            fRestProps.length,
            'f_rest_* properties (not divisible by 3). Re-export from backend with _normalize_f_rest_fields.',
          );
        }

        metadataRef.current = modelMeta;
        onMetadataRef.current?.(modelMeta);
        console.log('[Babylon] phase: metadata ready');

        const diagonal = Math.sqrt(
          (bbMax[0] - bbMin[0]) ** 2 +
          (bbMax[1] - bbMin[1]) ** 2 +
          (bbMax[2] - bbMin[2]) ** 2,
        );
        const sceneScale = parseViewerSceneScale();
        sceneScaleRef.current = sceneScale;
        if (sceneScale !== 1) {
          console.log(`[Babylon] VITE_VIEWER_SCENE_SCALE=${sceneScale}`);
        }
        // Scene-proportional sizing: markers and walk speed track the effective diagonal.
        const effectiveDiagonal = diagonal * sceneScale;
        worldUnitRef.current = Math.min(0.12, Math.max(0.008, effectiveDiagonal * 0.004));
        walkSpeedRef.current = Math.min(20, Math.max(1, effectiveDiagonal * 0.5));
        const camDist = Math.max(diagonal * BBOX_CAM_DIST_MULT, BBOX_CAM_DIST_MIN);
        let cameraUp: [number, number, number] = [0, -1, 0];
        let initialCameraPosition: [number, number, number] = [0, camDist * 0.35, camDist * 0.75];
        let initialCameraLookAt: [number, number, number] = [0, 0, 0];

        console.log('[Babylon] phase: await initial_camera');
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
          console.log('[Babylon] phase: initial_camera applied; cameraUp=[0,1,0]', hint);
        } else if (!disposed && jobId) {
          console.log('[Babylon] phase: initial_camera skipped');
        }

        if (sceneScale !== 1) {
          const scaled = scaleCameraPairFromOrigin(initialCameraPosition, initialCameraLookAt, sceneScale);
          initialCameraPosition = scaled.position;
          initialCameraLookAt = scaled.lookAt;
        }

        const engine = new Engine(canvas, true, {
          preserveDrawingBuffer: true,
          stencil: true,
          adaptToDeviceRatio: true,
        });
        const scene = new Scene(engine);
        scene.clearColor = new Color4(0, 0, 0, 1);

        const { orbitCamera, walkCamera } = setupCamerasFromPose(
          scene,
          canvas,
          initialCameraPosition,
          initialCameraLookAt,
          cameraUp,
        );
        applyOrbitZoomLimitsFromDiagonal(orbitCamera, diagonal * sceneScale);
        addSceneOverlays(scene);

        console.log('[Babylon] phase: ImportMeshAsync start');
        // The SPLAT loader plugin has no loadFile(), so raw ArrayBufferView input throws
        // "Plugin does not support loading ArrayBufferView." — wrap the buffer in a File instead.
        const plyFile = new File([buffer], 'model.ply', { type: 'application/octet-stream' });
        const loadPromise = ImportMeshAsync(plyFile, scene, {
          pluginExtension: '.ply',
          pluginOptions: {
            splat: { keepInRam: true },
          },
        });
        const loadTimeout = new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(new Error(`Splat load timed out after ${ADD_SPLAT_SCENE_TIMEOUT_MS / 1000}s.`));
          }, ADD_SPLAT_SCENE_TIMEOUT_MS);
        });
        const result = await Promise.race([loadPromise, loadTimeout]);
        if (disposed) return;

        const splatMesh = result.meshes.find(
          (m): m is GaussianSplattingMesh => (m as GaussianSplattingMesh).getClassName?.() === 'GaussianSplattingMesh',
        ) ?? (result.meshes[0] as GaussianSplattingMesh);

        if (!splatMesh) throw new Error('No GaussianSplattingMesh returned from PLY import');

        if (sceneScale !== 1) {
          splatMesh.scaling.setAll(sceneScale);
          splatMesh.computeWorldMatrix(true);
          console.log('[Babylon] splatMesh.scale applied:', sceneScale);
        }

        const rawSplats = splatMesh.splatsData;
        if (rawSplats) {
          originalSplatsRef.current = rawSplats.slice(0);
        }

        rebuildCenterCache(splatMesh);
        setLiveViewerApis({ sh: splatMesh.maxShDegree > 0 });
        if (splatMesh.maxShDegree > 0) {
          splatMesh.shDegree = Math.min(shDisplayDegree, splatMesh.maxShDegree);
        }

        console.log('[Babylon] phase: ImportMeshAsync done, splatCount=', splatMesh.splatCount);

        engine.runRenderLoop(() => {
          scene.render();
        });

        resizeObserver = new ResizeObserver(() => {
          engine.resize();
        });
        resizeObserver.observe(canvas);

        viewerRef.current = { engine, scene, orbitCamera, walkCamera, splatMesh };
        console.log('[Babylon] phase: init chain complete');
        setLoading(false);
      } catch (err: unknown) {
        if (!disposed) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[Babylon] Viewer error:', msg);
          setError(msg);
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      initialCameraAbort.abort();
      splatCentersRef.current = null;
      splatCenterGridRef.current = null;
      originalSplatsRef.current = null;
      sceneScaleRef.current = 1;
      worldUnitRef.current = 0.024;
      walkSpeedRef.current = 3;
      resizeObserver?.disconnect();
      try {
        document.exitPointerLock?.();
      } catch { /* ignore */ }
      const ctx = viewerRef.current;
      viewerRef.current = null;
      if (ctx) {
        ctx.engine.stopRenderLoop();
        ctx.scene.dispose();
        ctx.engine.dispose();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, jobId, prefetchedJobModelMetadata]);

  // Min-alpha filter (debounced via loadMinAlpha)
  useEffect(() => {
    const ctx = viewerRef.current;
    const original = originalSplatsRef.current;
    if (!ctx?.splatMesh || !original || loading) return;

    const filtered = filterSplatsByMinAlpha(original, loadMinAlpha);
    if (filtered.byteLength === 0) {
      console.warn('[Babylon] min-alpha filter removed all splats');
      return;
    }
    ctx.splatMesh.updateData(filtered);
    rebuildCenterCache(ctx.splatMesh);
  }, [loadMinAlpha, loading, rebuildCenterCache]);

  useEffect(() => {
    const ctx = viewerRef.current;
    if (!ctx?.splatMesh || loading) return;
    if (ctx.splatMesh.maxShDegree <= 0) return;
    ctx.splatMesh.shDegree = Math.min(shDisplayDegree, ctx.splatMesh.maxShDegree);
  }, [shDisplayDegree, loading]);

  // ── Camera mode switching ────────────────────────────────────────────────
  useEffect(() => {
    const ctx = viewerRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas || loading) return;

    const { scene, orbitCamera, walkCamera } = ctx;

    if (mode === 'orbit') {
      scene.activeCamera = orbitCamera;
      orbitCamera.attachControl(canvas, true);
      walkCamera.detachControl();
    } else if (mode === 'walkthrough') {
      walkCamera.position.copyFrom(orbitCamera.position);
      walkCamera.setTarget(orbitCamera.target);
      scene.activeCamera = walkCamera;
      orbitCamera.detachControl();
    } else {
      scene.activeCamera = orbitCamera;
      orbitCamera.attachControl(canvas, true);
      walkCamera.detachControl();
    }
  }, [mode, loading]);

  // ── Walkthrough Mode ───────────────────────────────────────────────────
  useEffect(() => {
    const wt = walkthroughRef.current;
    const ctx = viewerRef.current;
    const canvas = canvasRef.current;

    wt.active = mode === 'walkthrough';

    if (!wt.active || !ctx || !canvas) {
      document.exitPointerLock?.();
      wt.isLocked = false;
      if (wt.rafId !== null) { cancelAnimationFrame(wt.rafId); wt.rafId = null; }
      return;
    }

    const walkCamera = ctx.walkCamera;
    const viewerInstance = ctx;

    const onKeyDown = (e: KeyboardEvent) => wt.keys.add(e.code);
    const onKeyUp = (e: KeyboardEvent) => wt.keys.delete(e.code);
    const onClick = () => {
      if (!wt.active || wt.isLocked || !canvas.isConnected) return;
      try {
        canvas.requestPointerLock();
      } catch { /* ignore */ }
    };
    const onPLC = () => { wt.isLocked = document.pointerLockElement === canvas; };
    const onMM = (e: MouseEvent) => {
      if (!wt.isLocked) return;
      if (viewerRef.current !== viewerInstance || !canvas.isConnected) return;
      walkCamera.rotation.y -= e.movementX * 0.002;
      walkCamera.rotation.x -= e.movementY * 0.002;
      walkCamera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, walkCamera.rotation.x));
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
        const dir = Vector3.Zero();
        const fwd = walkCamera.getDirection(Vector3.Forward());
        const right = walkCamera.getDirection(Vector3.Right());
        if (wt.keys.has('KeyW') || wt.keys.has('ArrowUp')) dir.addInPlace(fwd);
        if (wt.keys.has('KeyS') || wt.keys.has('ArrowDown')) dir.subtractInPlace(fwd);
        if (wt.keys.has('KeyA') || wt.keys.has('ArrowLeft')) dir.subtractInPlace(right);
        if (wt.keys.has('KeyD') || wt.keys.has('ArrowRight')) dir.addInPlace(right);
        if (wt.keys.has('Space')) dir.y += 1;
        if (wt.keys.has('ShiftLeft')) dir.y -= 1;
        if (dir.lengthSquared() > 0) {
          dir.normalize().scaleInPlace(walkSpeedRef.current * delta);
          walkCamera.position.addInPlace(dir);
        }
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

  // ── Canvas cursor ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      if (mode === 'measure') canvas.style.cursor = 'crosshair';
      else if (mode === 'walkthrough') canvas.style.cursor = 'none';
      else canvas.style.cursor = 'grab';
    } catch { /* ignore */ }
  }, [mode, loading]);

  // ── Measurement Visuals ──────────────────────────────────────────────────
  useEffect(() => {
    const ctx = viewerRef.current;
    if (!ctx) return;
    const { scene } = ctx;

    for (const mesh of [...scene.meshes]) {
      if (mesh.metadata?.__measure) mesh.dispose(false, true);
    }

    visibleMeasurePoints.forEach((pt, i) => {
      const sphere = MeshBuilder.CreateSphere(
        `measurePt${i}`,
        { diameter: worldUnitRef.current, segments: 12 },
        scene,
      );
      sphere.position.copyFrom(pt.position);
      sphere.material = makeOverlayMaterial(scene, i === 0 ? MEASURE_PLACED_A : MEASURE_PLACED_B, 1);
      sphere.renderingGroupId = 2;
      sphere.metadata = { __measure: true };
      sphere.isPickable = false;
    });

    if (visibleMeasurePoints.length === 2) {
      const line = MeshBuilder.CreateLines(
        'measureLine',
        { points: visibleMeasurePoints.map((p) => p.position) },
        scene,
      );
      line.color = MEASURE_PLACED_LINE;
      line.renderingGroupId = 2;
      line.metadata = { __measure: true };
      line.isPickable = false;
    }

    return () => {
      if (viewerRef.current !== ctx) return;
      for (const mesh of [...scene.meshes]) {
        if (mesh.metadata?.__measure) mesh.dispose(false, true);
      }
    };
  }, [visibleMeasurePoints]);

  const handleUndoLastPoint = useCallback(() => {
    if (measurePickCtxRef.current.measurePhase === 'calibrate') {
      setCalibPoints((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
    } else {
      setMeasurePoints((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
      setMeasuredDistance(null);
    }
  }, []);

  const handleAddMeasurePoint = useCallback((point: Vector3) => {
    if (measurePhase === 'calibrate') {
      setCalibPoints(prev => {
        if (prev.length >= 2) return [{ position: point.clone() }];
        return [...prev, { position: point.clone() }];
      });
    } else {
      setMeasurePoints(prev => {
        const next = prev.length >= 2 ? [{ position: point.clone() }] : [...prev, { position: point.clone() }];
        if (next.length === 2 && calibration) {
          const rawDist = Vector3.Distance(next[0].position, next[1].position);
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
    const ctx = viewerRef.current;
    const canvas = canvasRef.current;
    if (loading || !ctx || !canvas) return;

    const { scene } = ctx;
    const camera = scene.activeCamera;
    const splatMesh = ctx.splatMesh;
    if (!camera || !splatMesh) return;

    const pickWorldFromEvent = (e: MouseEvent): PickResult | null => {
      const pickW = canvas.width;
      const pickH = canvas.height;

      const rect = canvas.getBoundingClientRect();
      let mouseX: number;
      let mouseY: number;
      if (rect.width > 0 && rect.height > 0) {
        mouseX = ((e.clientX - rect.left) / rect.width) * pickW;
        mouseY = ((e.clientY - rect.top) / rect.height) * pickH;
      } else {
        const cw = Math.max(1, canvas.clientWidth);
        const ch = Math.max(1, canvas.clientHeight);
        mouseX = (e.offsetX / cw) * pickW;
        mouseY = (e.offsetY / ch) * pickH;
      }
      mouseX = Math.max(0, Math.min(pickW, mouseX));
      mouseY = Math.max(0, Math.min(pickH, mouseY));

      const baseMax = metadataRef.current
        ? maxSplatPickDistance(metadataRef.current.boundingBox)
        : 100;
      const maxDist = baseMax * sceneScaleRef.current;

      return pickSplatMeasure({
        scene,
        camera,
        mousePos: new Vector2(mouseX, mouseY),
        renderDims: new Vector2(pickW, pickH),
        maxDist,
        splatMeshVisible: splatMesh.isEnabled(),
        centers: splatCentersRef.current,
        centerGrid: splatCenterGridRef.current,
        splatCentersOnly: true,
      });
    };

    const gizmo = new MeasurePreviewGizmo(scene, worldUnitRef.current);

    // Distinguish deliberate clicks from orbit drags: ignore click/contextmenu when
    // the pointer moved more than a few pixels since pointerdown.
    const CLICK_DRAG_MAX_PX_SQ = 5 * 5;
    const downPos = { x: 0, y: 0 };
    const onPointerDown = (e: PointerEvent) => {
      downPos.x = e.clientX;
      downPos.y = e.clientY;
    };
    const draggedSincePointerDown = (e: MouseEvent): boolean => {
      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      return dx * dx + dy * dy > CLICK_DRAG_MAX_PX_SQ;
    };

    const onClick = (e: MouseEvent) => {
      if (draggedSincePointerDown(e)) return;
      try {
        const pick = pickWorldFromEvent(e);
        if (pick && pick.isSnapped) {
          handleAddMeasurePoint(pick.position);
        } else if (!pick) {
          console.log('[Measure] Click rejected — no splat center in pick cone');
        }
      } catch (err) {
        console.warn('[Babylon] Measure pick failed:', err);
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (draggedSincePointerDown(e)) return; // right-drag pan, not an undo
      handleUndoLastPoint();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') handleUndoLastPoint();
    };

    const buildSegmentText = (pick: PickResult | null, previousWorld: Vector3 | null): string | null => {
      const pickCtx = measurePickCtxRef.current;
      const visible = pickCtx.measurePhase === 'calibrate' ? pickCtx.calibPoints : pickCtx.measurePoints;
      if (!pick?.isSnapped || !previousWorld || visible.length !== 1) return null;
      const raw = Vector3.Distance(previousWorld, pick.position);
      if (pickCtx.measurePhase === 'measure' && pickCtx.calibration) {
        return `A→B: ${(raw * pickCtx.calibration.scaleFactor).toFixed(3)} m`;
      }
      return `A→B: ${raw.toFixed(2)} u`;
    };

    let lastHoverMs = 0;
    const lastPreviewWorld = new Vector3();
    let hasLastPreviewWorld = false;

    const onMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastHoverMs < MEASURE_HOVER_MIN_MS) return;
      lastHoverMs = now;
      try {
        const pick = pickWorldFromEvent(e);
        const pickCtx = measurePickCtxRef.current;
        const visible = pickCtx.measurePhase === 'calibrate' ? pickCtx.calibPoints : pickCtx.measurePoints;
        const previousWorld = visible.length > 0 ? visible[visible.length - 1].position : null;
        const segmentText = buildSegmentText(pick, previousWorld);

        if (pick && hasLastPreviewWorld && Vector3.Distance(lastPreviewWorld, pick.position) < MEASURE_PREVIEW_MOVE_EPS) {
          const hint = buildMeasurePickHint(
            pickCtx.measurePhase,
            pickCtx.calibPoints.length,
            pickCtx.measurePoints.length,
            pick,
            segmentText,
          );
          setMeasurePickHint((prev) => (prev === hint ? prev : hint));
          return;
        }
        if (pick) {
          lastPreviewWorld.copyFrom(pick.position);
          hasLastPreviewWorld = true;
          gizmo.update(pick, camera.position, previousWorld);
        } else {
          hasLastPreviewWorld = false;
          gizmo.hide();
        }

        const hint = buildMeasurePickHint(
          pickCtx.measurePhase,
          pickCtx.calibPoints.length,
          pickCtx.measurePoints.length,
          pick,
          segmentText,
        );
        setMeasurePickHint((prev) => (prev === hint ? prev : hint));
      } catch {
        gizmo.hide();
        setMeasurePickHint(MEASURE_PICK_HINT_IDLE);
        hasLastPreviewWorld = false;
      }
    };

    const onLeave = () => {
      hasLastPreviewWorld = false;
      gizmo.hide();
      setMeasurePickHint(MEASURE_PICK_HINT_IDLE);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKeyDown);
      gizmo.dispose();
    };
  }, [mode, measurePhase, calibration, loading, handleAddMeasurePoint, handleUndoLastPoint]);

  const handleConfirmCalibration = useCallback(() => {
    if (calibPoints.length !== 2) return;
    const rawDist = Vector3.Distance(calibPoints[0].position, calibPoints[1].position);
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
    const glCanvas = canvasRef.current;
    if (!glCanvas) return;

    try {
      viewerRef.current?.scene.render();
    } catch { /* ignore */ }

    try {
      const w = glCanvas.width;
      const h = glCanvas.height;
      const dpr = window.devicePixelRatio || 1;

      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(glCanvas, 0, 0);

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

      ctx.strokeStyle = 'rgba(239, 231, 82, 0.25)';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.stroke();

      let textY = panelY + padY + titleFontSize;
      ctx.font = `bold ${titleFontSize}px monospace`;
      ctx.fillStyle = '#efe752';
      ctx.fillText(title, panelX + padX, textY);

      textY += Math.round(6 * dpr);
      ctx.font = `${baseFontSize}px monospace`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';

      for (const line of lines) {
        textY += lineHeight;
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

      const brand = 'METROA';
      ctx.font = `bold ${Math.max(10, Math.round(10 * dpr))}px monospace`;
      ctx.fillStyle = 'rgba(239, 231, 82, 0.4)';
      const brandW = ctx.measureText(brand).width;
      ctx.fillText(brand, w - brandW - margin, margin + Math.round(10 * dpr));

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

  const handleDownloadSplat = useCallback(() => {
    const data = viewerRef.current?.splatMesh?.splatsData;
    if (!data) {
      setSplatDownloadError('No splat data in memory (keepInRam required).');
      return;
    }
    setSplatDownloadError(null);
    setSplatDownloadBusy(true);
    try {
      Tools.Download(new Blob([data], { type: 'application/octet-stream' }), `model-${Date.now()}.splat`);
    } catch (e) {
      setSplatDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setSplatDownloadBusy(false);
    }
  }, []);

  useEffect(() => { if (mode !== 'measure') { handleResetCalibration(); } }, [mode, handleResetCalibration]);

  if (!modelUrl) return null;

  return (
    <div className="w-full h-full relative group bg-black rounded-xl overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block touch-none" />

      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/80">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[#efe752]/35 border-t-[#efe752] rounded-full animate-spin" />
            <span className="text-[#f5ec99]/70 font-mono text-xs">Loading Gaussian Splats...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute top-12 left-3 right-3 z-30 bg-red-900/80 backdrop-blur-md text-white text-xs p-3 rounded-lg border border-red-500/38 font-mono break-all">
          <span className="text-red-300 font-bold">Viewer Error: </span>{error}
        </div>
      )}

      {!loading && !error && (
        <div className="absolute bottom-4 right-3 z-20 flex flex-col items-end gap-2 max-w-[min(100vw-1.5rem,260px)]">
          {splatDownloadError && (
            <div className="text-[10px] text-red-300 font-mono bg-black/85 border border-red-500/28 rounded px-2 py-1">
              {splatDownloadError}
            </div>
          )}
          {displayPanelOpen && (
            <div className="w-full min-w-[200px] bg-black/95 backdrop-blur-md border border-white/[0.22] rounded-xl p-3 text-[10px] text-white/80 font-mono space-y-3">
              <label className="block space-y-1">
                <span className="text-[#f5ec99]">Min alpha (live filter)</span>
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
                  <p className="text-[9px] text-white/35">SH not available on this model.</p>
                )}
              </div>
              <button
                type="button"
                disabled={splatDownloadBusy}
                onClick={handleDownloadSplat}
                className="w-full flex items-center justify-center gap-1 py-1.5 rounded bg-[#efe752]/10 text-[#efe752] border border-[#efe752]/48 hover:bg-[#efe752]/20 disabled:opacity-40"
              >
                <Download className="w-3 h-3" /> {splatDownloadBusy ? 'Working…' : 'Download .splat'}
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

      <div className="absolute top-3 left-3 z-10">
        <div className="bg-black/70 backdrop-blur-md text-white/80 text-xs px-3 py-1.5 rounded-lg border border-white/[0.18] font-mono flex items-center gap-2">
          {mode === 'orbit' && <><MousePointer className="w-3 h-3" /> Orbit</>}
          {mode === 'walkthrough' && <><Footprints className="w-3 h-3" /> Walk-Through</>}
          {mode === 'measure' && <><Ruler className="w-3 h-3" /> Measure</>}
        </div>
      </div>

      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        <ToolbarButton icon={<MousePointer className="w-3.5 h-3.5" />} label="Orbit" active={mode === 'orbit'} onClick={() => setMode('orbit')} />
        <ToolbarButton icon={<Footprints className="w-3.5 h-3.5" />} label="Walk" active={mode === 'walkthrough'} onClick={() => setMode('walkthrough')} />
        <ToolbarButton icon={<Ruler className="w-3.5 h-3.5" />} label="Measure" active={mode === 'measure'} onClick={() => setMode('measure')} />

        <div className="border-t border-white/[0.18] my-1" />

        <ToolbarButton icon={<Camera className="w-3.5 h-3.5" />} label="Snapshot" onClick={handleSnapshot} />
        <ToolbarButton icon={<RotateCcw className="w-3.5 h-3.5" />} label="Reset" onClick={handleReset} />
        <ToolbarButton icon={<Info className="w-3.5 h-3.5" />} label="Help" active={showHelp} onClick={() => setShowHelp(!showHelp)} />
      </div>

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
                  <span className={`flex items-center gap-1 ${calibPoints.length >= 1 ? 'text-[#6eb7ff]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> A {calibPoints.length >= 1 ? '✓' : ''}
                  </span>
                  <span className="text-white/15">&rarr;</span>
                  <span className={`flex items-center gap-1 ${calibPoints.length >= 2 ? 'text-[#2f8fff]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> B {calibPoints.length >= 2 ? '✓' : ''}
                  </span>
                </div>
                {calibPoints.length > 0 && (
                  <>
                    <div className="border-l border-white/[0.18] h-5" />
                    <button
                      onClick={handleUndoLastPoint}
                      title="Undo last point (Esc / right-click)"
                      className="flex items-center gap-1 text-white/40 hover:text-white transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> Undo
                    </button>
                  </>
                )}
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
                  <span className={`flex items-center gap-1 ${measurePoints.length >= 1 ? 'text-[#6eb7ff]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> A {measurePoints.length >= 1 ? '✓' : ''}
                  </span>
                  <span className="text-white/15">&rarr;</span>
                  <span className={`flex items-center gap-1 ${measurePoints.length >= 2 ? 'text-[#2f8fff]' : 'text-white/30'}`}>
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
                    <button
                      onClick={handleUndoLastPoint}
                      title="Undo last point (Esc / right-click)"
                      className="flex items-center gap-1 text-white/40 hover:text-white transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> Undo
                    </button>
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

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10">
        <div className="bg-black/70 backdrop-blur-md text-white/50 text-[10px] px-3 py-1.5 rounded-lg border border-white/[0.18] font-mono">
          {mode === 'orbit' && 'Left: Rotate  |  Right: Pan  |  Scroll: Zoom'}
          {mode === 'walkthrough' && 'Click to lock  |  WASD: Move  |  Space/Shift: Up/Down  |  ESC: Unlock'}
          {mode === 'measure' && (measurePhase === 'calibrate'
            ? 'Yellow hover marks the splat center you will place; placed points appear blue — click two references, then enter their real distance in meters'
            : 'Yellow hover marks the next splat center; placed points are blue — click two points for the calibrated distance')}
        </div>
      </div>

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
              <HelpItem icon={<Ruler className="w-3 h-3" />} title="Measure">Yellow hover shows the splat center you are about to place; placed points appear blue in the scene. Step 1: two reference clicks + known distance. Step 2: measure any distance in meters. Esc or right-click undoes the last point.</HelpItem>
              <HelpItem icon={<Camera className="w-3 h-3" />} title="Snapshot">Captures the current view as a PNG image.</HelpItem>
              <HelpItem icon={<SlidersHorizontal className="w-3 h-3" />} title="Display panel">
                Min alpha culls faint splats live. SH 0/1/2 updates the render when the model has spherical harmonics. Download .splat exports the in-memory Babylon splat buffer.
              </HelpItem>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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

function HelpItem({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-white/80 font-medium mb-0.5">{icon}{title}</div>
      <p className="text-white/40 leading-relaxed pl-5">{children}</p>
    </div>
  );
}
