import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Viewer, SceneRevealMode } from '@mkkellogg/gaussian-splats-3d';
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
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Viewer3DProps {
  modelUrl: string | null;
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

/** Scene-scale max ray distance for accepting a splat hit (PLY axis-aligned bbox diagonal). */
function maxSplatPickDistance(bbox: ModelMetadata['boundingBox']): number {
  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const dz = bbox.max[2] - bbox.min[2];
  const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Math.max(diagonal * 4, 3);
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

// ── Main Viewer Component (standalone Viewer — no R3F) ──────────────────────

export default function Viewer3D({ modelUrl, onModelMetadata }: Viewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);

  const walkthroughRef = useRef<{ active: boolean; keys: Set<string>; isLocked: boolean; euler: THREE.Euler; rafId: number | null }>({
    active: false, keys: new Set(), isLocked: false, euler: new THREE.Euler(0, 0, 0, 'YXZ'), rafId: null,
  });

  const metadataRef = useRef<ModelMetadata | null>(null);

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

  const visibleMeasurePoints = measurePhase === 'calibrate' ? calibPoints : measurePoints;

  // ── Initialize Viewer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !modelUrl) return;
    let disposed = false;
    let blobUrl: string | null = null;

    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
    const fullUrl = modelUrl.startsWith('http') ? modelUrl : `${apiBase}${modelUrl}`;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        // 1. Fetch PLY
        console.log('[GS3D] Fetching PLY:', fullUrl);
        const response = await fetch(fullUrl);
        if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (disposed) return;
        console.log('[GS3D] PLY fetched:', buffer.byteLength, 'bytes');

        // 2. Parse metadata + positions
        const meta = parsePLYForMeta(buffer);
        if (meta.vertexCount === 0) throw new Error('No visible points in PLY');
        console.log(`[GS3D] PLY parsed: ${meta.vertexCount}/${meta.totalVertices} verts, center=[${meta.center.map(v => v.toFixed(2))}]`);



        const modelMeta: ModelMetadata = {
          pointCount: meta.vertexCount,
          fileSize: buffer.byteLength,
          boundingBox: meta.boundingBox,
          hasColors: meta.hasColors,
          hasOpacity: meta.hasOpacity,
          properties: meta.properties,
          format: 'gaussian_splat',
        };
        metadataRef.current = modelMeta;
        onModelMetadata?.(modelMeta);

        // 3. Create blob URL
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        blobUrl = URL.createObjectURL(blob);

        // 4. Build a Three.js scene with grid + origin axes
        const threeScene = new THREE.Scene();
        const grid = new THREE.GridHelper(30, 30, 0x1a1425, 0x0d0b1a);
        grid.position.y = -0.01;
        threeScene.add(grid);

        // Add AxesHelper for (0,0,0) reference
        const axesHelper = new THREE.AxesHelper(1.5);
        // Standardize axes colors slightly
        // @ts-ignore (material.color is valid but type definitions might complain)
        axesHelper.material.transparent = true;
        // @ts-ignore
        axesHelper.material.opacity = 0.6;
        threeScene.add(axesHelper);



        // 5. Create standalone Viewer (manages its own canvas + render loop)
        // Auto-position camera based on bounding box diagonal
        const bbMin = meta.boundingBox.min;
        const bbMax = meta.boundingBox.max;
        const diagonal = Math.sqrt(
          (bbMax[0] - bbMin[0]) ** 2 +
          (bbMax[1] - bbMin[1]) ** 2 +
          (bbMax[2] - bbMin[2]) ** 2,
        );
        const camDist = Math.max(diagonal * 1.2, 3); // at least 3 units away
        console.log(`[GS3D] BBox diagonal=${diagonal.toFixed(2)}, camDist=${camDist.toFixed(2)}`);

        console.log('[GS3D] Creating standalone Viewer...');
        const viewer = new Viewer({
          cameraUp: [0, 1, 0],
          initialCameraPosition: [0, camDist * 0.3, camDist * 0.8],
          initialCameraLookAt: [0, 0, 0],
          rootElement: containerRef.current!,
          threeScene: threeScene,
          selfDrivenMode: true,
          useBuiltInControls: true,
          gpuAcceleratedSort: true,
          sharedMemoryForWorkers: false,
          sceneRevealMode: SceneRevealMode.Instant,
          antialiased: false,
          freeIntermediateSplatData: true,
          logLevel: 0,
          sphericalHarmonicsDegree: 1,
        } as Record<string, unknown>);

        // 6. Add the splat scene
        console.log('[GS3D] Adding splat scene...');
        await viewer.addSplatScene(blobUrl, {
          splatAlphaRemovalThreshold: 8,
          showLoadingUI: false,
          format: 2, // SceneFormat.Ply (0=Splat, 1=KSplat, 2=Ply, 3=Spz)
          position: [-meta.center[0], -meta.center[1], -meta.center[2]],
          // APPLY Y-UP CORRECTION: Rotate 180° around X-axis (quaternion [1, 0, 0, 0])
          rotation: [1, 0, 0, 0],
          scale: [1, 1, 1],
        });

        if (disposed) return;

        // 7. Start rendering
        viewer.start();
        viewer.raycaster.raycastAgainstTrueSplatEllipsoid = true;
        viewerRef.current = viewer;
        console.log('[GS3D] Viewer started successfully');
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
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (viewerRef.current) {
        try { viewerRef.current.dispose(); } catch { /* ignore */ }
        viewerRef.current = null;
      }
      // Clear the container (Viewer creates a canvas inside it)
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [modelUrl, onModelMetadata]);

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
      // Re-enable viewer's orbit controls
      try { const v = viewer as unknown as Record<string, CallableFunction>; v.setOrbitControlsEnabled?.(true); } catch { /* ignore */ }
      return;
    }

    // Disable viewer's orbit controls
    try { const v = viewer as unknown as Record<string, CallableFunction>; v.setOrbitControlsEnabled?.(false); } catch { /* ignore */ }

    const camera = (viewer as unknown as { camera?: THREE.PerspectiveCamera }).camera;
    if (!camera) return;

    const onKeyDown = (e: KeyboardEvent) => wt.keys.add(e.code);
    const onKeyUp = (e: KeyboardEvent) => wt.keys.delete(e.code);
    const onClick = () => { if (wt.active && !wt.isLocked) canvas.requestPointerLock(); };
    const onPLC = () => { wt.isLocked = document.pointerLockElement === canvas; };
    const onMM = (e: MouseEvent) => {
      if (!wt.isLocked) return;
      wt.euler.setFromQuaternion(camera.quaternion);
      wt.euler.y -= e.movementX * 0.002;
      wt.euler.x -= e.movementY * 0.002;
      wt.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, wt.euler.x));
      camera.quaternion.setFromEuler(wt.euler);
    };

    let lastTime = performance.now();
    const animate = () => {
      if (!wt.active) return;
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
  }, [mode]);

  // ── Measurement Click Handler ──────────────────────────────────────────
  const lastClickTimeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = containerRef.current?.querySelector('canvas');
    if (canvas) {
      if (mode === 'measure') {
        canvas.style.cursor = 'crosshair';
      } else if (mode === 'walkthrough') {
        canvas.style.cursor = 'none';
      } else {
        canvas.style.cursor = 'grab';
      }
    }

    if (mode !== 'measure') return;
    const viewer = viewerRef.current;
    if (!viewer || !canvas) return;

    // Access the library's built-in raycaster and splatMesh
    // These operate in the correct coordinate space matching the rendered scene
    const viewerAny = viewer as unknown as {
      camera?: THREE.PerspectiveCamera;
      raycaster?: {
        setFromCameraAndScreenPosition: (camera: THREE.Camera, screenPos: THREE.Vector2, screenDims: THREE.Vector2) => void;
        intersectSplatMesh: (splatMesh: THREE.Object3D, outHits?: { origin: THREE.Vector3; distance: number; splatIndex: number }[]) => { origin: THREE.Vector3; distance: number; splatIndex: number }[];
      };
      splatMesh?: THREE.Object3D;
      getRenderDimensions?: (out: THREE.Vector2) => void;
    };

    const camera = viewerAny.camera;
    const gsRaycaster = viewerAny.raycaster;
    const splatMesh = viewerAny.splatMesh;
    if (!camera || !gsRaycaster || !splatMesh) return;

    const onClick = (e: MouseEvent) => {
      // Debounce clicks to prevent crashes from rapid raycasting
      const now = performance.now();
      if (now - lastClickTimeRef.current < 300) return;
      lastClickTimeRef.current = now;

      // Ensure splat scene is ready
      if (!splatMesh || splatMesh.visible === false) return;
      if (typeof (viewerAny as any).isLoading === 'function' && (viewerAny as any).isLoading()) return;

      // Map pointer into the same pixel space as getRenderDimensions (root offset size), so NDC
      // matches the viewer even when canvas CSS box ≠ root layout (see GS3D getRenderDimensions).
      const renderDims = new THREE.Vector2();
      if (viewerAny.getRenderDimensions) {
        viewerAny.getRenderDimensions(renderDims);
      } else {
        renderDims.set(canvas.clientWidth, canvas.clientHeight);
      }

      const rect = canvas.getBoundingClientRect();
      const mousePos = new THREE.Vector2();
      if (rect.width > 0 && rect.height > 0) {
        mousePos.x = ((e.clientX - rect.left) / rect.width) * renderDims.x;
        mousePos.y = ((e.clientY - rect.top) / rect.height) * renderDims.y;
      } else {
        mousePos.set(e.offsetX, e.offsetY);
      }
      mousePos.x = THREE.MathUtils.clamp(mousePos.x, 0, renderDims.x);
      mousePos.y = THREE.MathUtils.clamp(mousePos.y, 0, renderDims.y);

      try {
        gsRaycaster.setFromCameraAndScreenPosition(camera, mousePos, renderDims);

        const hits: { origin: THREE.Vector3; distance: number; splatIndex: number }[] = [];
        gsRaycaster.intersectSplatMesh(splatMesh, hits);

        // @mkkellogg/gaussian-splats-3d sorts hits by ascending distance; take closest within scale-aware max.
        const maxDist = metadataRef.current
          ? maxSplatPickDistance(metadataRef.current.boundingBox)
          : 100;
        const validHit = hits.find(h => isFinite(h.distance) && h.distance <= maxDist);
        if (validHit) {
          handleAddMeasurePoint(validHit.origin.clone());
        }
      } catch (err) {
        // Splat sorting in the worker can occasionally cause index out of bounds during intersect
        console.warn('[GS3D] Raycaster intersection failed (likely during mid-sort):', err);
      }
    };

    canvas.addEventListener('click', onClick);
    return () => canvas.removeEventListener('click', onClick);
  }, [mode, measurePhase, calibration]);

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
    const purpleMat = new THREE.MeshBasicMaterial({ color: '#7c3aed' });
    const lavenderMat = new THREE.MeshBasicMaterial({ color: '#a78bfa' });

    visibleMeasurePoints.forEach((pt, i) => {
      const mesh = new THREE.Mesh(sphereGeo, i === 0 ? lavenderMat : purpleMat);
      mesh.position.copy(pt.position);
      mesh.userData.__measure = true;
      scene.add(mesh);
    });

    if (visibleMeasurePoints.length === 2) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(visibleMeasurePoints.map(p => p.position));
      const lineMat = new THREE.LineBasicMaterial({ color: '#7c3aed', linewidth: 2 });
      const line = new THREE.Line(lineGeo, lineMat);
      line.userData.__measure = true;
      scene.add(line);
    }

    return () => {
      const removalList: THREE.Object3D[] = [];
      scene.traverse((o) => { if (o.userData.__measure) removalList.push(o); });
      removalList.forEach(o => scene.remove(o));
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
      ctx.strokeStyle = 'rgba(53, 200, 137, 0.25)';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.stroke();

      // 5. Draw title
      let textY = panelY + padY + titleFontSize;
      ctx.font = `bold ${titleFontSize}px monospace`;
      ctx.fillStyle = '#7c3aed';
      ctx.fillText(title, panelX + padX, textY);

      // 6. Draw info lines
      textY += Math.round(6 * dpr);
      ctx.font = `${baseFontSize}px monospace`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';

      for (const line of lines) {
        textY += lineHeight;
        // Highlight measurement value in accent color
        if (line.startsWith('Measurement:')) {
          ctx.fillStyle = '#7c3aed';
          ctx.fillText(line, panelX + padX, textY);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        } else if (line.startsWith('Scale:')) {
          ctx.fillStyle = '#a78bfa';
          ctx.fillText(line, panelX + padX, textY);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        } else {
          ctx.fillText(line, panelX + padX, textY);
        }
      }

      // 7. Small branding in top-right corner
      const brand = '3D Scanner';
      ctx.font = `bold ${Math.max(10, Math.round(10 * dpr))}px monospace`;
      ctx.fillStyle = 'rgba(124, 58, 237, 0.4)';
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

  useEffect(() => { if (mode !== 'measure') { handleResetCalibration(); } }, [mode, handleResetCalibration]);

  if (!modelUrl) return null;

  return (
    <div className="w-full h-full relative group bg-[#08080f] rounded-xl overflow-hidden">
      {/* Viewer container — the Viewer class creates its own <canvas> inside */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Loading overlay */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-[#08080f]/80">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[#7c3aed]/30 border-t-[#7c3aed] rounded-full animate-spin" />
            <span className="text-[#a78bfa]/70 font-mono text-xs">Loading Gaussian Splats...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute top-12 left-3 right-3 z-30 bg-red-900/80 backdrop-blur-md text-white text-xs p-3 rounded-lg border border-red-500/40 font-mono break-all">
          <span className="text-red-300 font-bold">Viewer Error: </span>{error}
        </div>
      )}

      {/* ── Top-Left: Mode Indicator ─────────────────────────────────────── */}
      <div className="absolute top-3 left-3 z-10">
        <div className="bg-black/70 backdrop-blur-md text-white/80 text-xs px-3 py-1.5 rounded-lg border border-white/[0.06] font-mono flex items-center gap-2">
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

        <div className="border-t border-white/[0.06] my-1" />

        <ToolbarButton icon={<Camera className="w-3.5 h-3.5" />} label="Snapshot" onClick={handleSnapshot} />
        <ToolbarButton icon={<RotateCcw className="w-3.5 h-3.5" />} label="Reset" onClick={handleReset} />
        <ToolbarButton icon={<Info className="w-3.5 h-3.5" />} label="Help" active={showHelp} onClick={() => setShowHelp(!showHelp)} />
      </div>

      {/* ── Measure Sub-Controls ──────────────────────────────────────────── */}
      {mode === 'measure' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
          <div className="bg-black/80 backdrop-blur-md border border-white/[0.06] rounded-xl px-4 py-2.5 flex items-center gap-3 font-mono text-xs">
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${measurePhase === 'calibrate' ? 'bg-[#a78bfa]/15 text-[#a78bfa]' : 'bg-[#7c3aed]/15 text-[#7c3aed]'}`}>
              {measurePhase === 'calibrate' ? 'STEP 1: Calibrate' : 'STEP 2: Measure'}
            </span>
            <div className="border-l border-white/[0.06] h-5" />

            {measurePhase === 'calibrate' ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={`flex items-center gap-1 ${calibPoints.length >= 1 ? 'text-[#a78bfa]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> A {calibPoints.length >= 1 ? '✓' : ''}
                  </span>
                  <span className="text-white/15">&rarr;</span>
                  <span className={`flex items-center gap-1 ${calibPoints.length >= 2 ? 'text-[#7c3aed]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> B {calibPoints.length >= 2 ? '✓' : ''}
                  </span>
                </div>
                {calibPoints.length === 2 && (
                  <>
                    <div className="border-l border-white/[0.06] h-5" />
                    <div className="flex items-center gap-1.5">
                      <span className="text-white/40">=</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={meterInput}
                        onChange={e => setMeterInput(e.target.value)}
                        className="w-16 bg-[#0d0b1a] border border-white/[0.08] rounded px-1.5 py-0.5 text-white text-xs font-mono text-center focus:border-[#7c3aed]/40 focus:outline-none"
                      />
                      <span className="text-white/40">m</span>
                    </div>
                    <button
                      onClick={handleConfirmCalibration}
                      className="px-2 py-0.5 rounded bg-[#7c3aed]/15 text-[#7c3aed] border border-[#7c3aed]/20 hover:bg-[#7c3aed]/25 transition-colors"
                    >
                      Confirm
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className={`flex items-center gap-1 ${measurePoints.length >= 1 ? 'text-[#a78bfa]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> A {measurePoints.length >= 1 ? '✓' : ''}
                  </span>
                  <span className="text-white/15">&rarr;</span>
                  <span className={`flex items-center gap-1 ${measurePoints.length >= 2 ? 'text-[#7c3aed]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> B {measurePoints.length >= 2 ? '✓' : ''}
                  </span>
                </div>
                {measuredDistance !== null && (
                  <>
                    <div className="border-l border-white/[0.06] h-5" />
                    <div className="flex items-center gap-2">
                      <Ruler className="w-3.5 h-3.5 text-[#7c3aed]" />
                      <span className="text-[#7c3aed] text-sm font-semibold">{measuredDistance.toFixed(3)}</span>
                      <span className="text-white/30">m</span>
                    </div>
                  </>
                )}
                {measurePoints.length > 0 && (
                  <>
                    <div className="border-l border-white/[0.06] h-5" />
                    <button onClick={handleClearMeasure} className="flex items-center gap-1 text-white/40 hover:text-white transition-colors">
                      <Trash2 className="w-3 h-3" /> Clear
                    </button>
                  </>
                )}
                <div className="border-l border-white/[0.06] h-5" />
                <button onClick={handleResetCalibration} className="flex items-center gap-1 text-[#a78bfa]/60 hover:text-[#a78bfa] transition-colors text-[10px]">
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
        </div>
      )}

      {/* ── Bottom-Center: Context Help ───────────────────────────────────── */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10">
        <div className="bg-black/70 backdrop-blur-md text-white/50 text-[10px] px-3 py-1.5 rounded-lg border border-white/[0.06] font-mono">
          {mode === 'orbit' && 'Left: Rotate  |  Right: Pan  |  Scroll: Zoom'}
          {mode === 'walkthrough' && 'Click to lock  |  WASD: Move  |  Space/Shift: Up/Down  |  ESC: Unlock'}
          {mode === 'measure' && (measurePhase === 'calibrate' ? 'Click two reference points, then enter their real distance in meters' : 'Click two points to measure the calibrated distance')}
        </div>
      </div>

      {/* ── Help Panel ────────────────────────────────────────────────────── */}
      {showHelp && (
        <div className="absolute top-14 right-3 z-20 w-64">
          <div className="bg-[#08080f]/95 backdrop-blur-md border border-white/[0.06] rounded-xl p-4 text-xs text-white/70 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white text-sm">Viewer Controls</span>
              <button onClick={() => setShowHelp(false)} className="text-white/40 hover:text-white"><X className="w-3 h-3" /></button>
            </div>
            <div className="space-y-2">
              <HelpItem icon={<MousePointer className="w-3 h-3" />} title="Orbit Mode">Left-click drag to rotate. Right-click drag to pan. Scroll to zoom.</HelpItem>
              <HelpItem icon={<Footprints className="w-3 h-3" />} title="Walk-Through">Click to lock cursor. WASD to move. Mouse to look. Space/Shift for up/down.</HelpItem>
              <HelpItem icon={<Ruler className="w-3 h-3" />} title="Measure">Step 1: Click two reference points and enter their known distance. Step 2: Measure any distance in meters.</HelpItem>
              <HelpItem icon={<Camera className="w-3 h-3" />} title="Snapshot">Captures the current view as a PNG image.</HelpItem>
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
    ? 'bg-[#7c3aed]/15 text-[#7c3aed] border-[#7c3aed]/20'
    : 'bg-black/70 text-white/50 border-white/[0.06] hover:text-white hover:bg-[#0d0b1a]';
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
