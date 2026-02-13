import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { DropInViewer, SceneRevealMode } from '@mkkellogg/gaussian-splats-3d';
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

  // Extract positions only (for raycasting + bounding box)
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

      // Skip very low-opacity points
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

  // Center positions at origin (for raycasting alignment with centered splats)
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

// ── Walkthrough Controls ─────────────────────────────────────────────────────

function WalkthroughControls({ active }: { active: boolean }) {
  const { camera, gl } = useThree();
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const keys = useRef<Set<string>>(new Set());
  const isLocked = useRef(false);

  useEffect(() => {
    if (!active) { document.exitPointerLock?.(); isLocked.current = false; return; }

    const onKeyDown = (e: KeyboardEvent) => keys.current.add(e.code);
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onClick = () => { if (active && !isLocked.current) gl.domElement.requestPointerLock(); };
    const onPLC = () => { isLocked.current = document.pointerLockElement === gl.domElement; };
    const onMM = (e: MouseEvent) => {
      if (!isLocked.current) return;
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= e.movementX * 0.002;
      euler.current.x -= e.movementY * 0.002;
      euler.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.current.x));
      camera.quaternion.setFromEuler(euler.current);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    gl.domElement.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onPLC);
    document.addEventListener('mousemove', onMM);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      gl.domElement.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onPLC);
      document.removeEventListener('mousemove', onMM);
      document.exitPointerLock?.(); isLocked.current = false;
    };
  }, [active, camera, gl]);

  useFrame((_, delta) => {
    if (!active || !isLocked.current) return;
    const dir = new THREE.Vector3();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    if (keys.current.has('KeyW') || keys.current.has('ArrowUp')) dir.add(fwd);
    if (keys.current.has('KeyS') || keys.current.has('ArrowDown')) dir.sub(fwd);
    if (keys.current.has('KeyA') || keys.current.has('ArrowLeft')) dir.sub(right);
    if (keys.current.has('KeyD') || keys.current.has('ArrowRight')) dir.add(right);
    if (keys.current.has('Space')) dir.y += 1;
    if (keys.current.has('ShiftLeft')) dir.y -= 1;
    if (dir.lengthSq() > 0) { dir.normalize().multiplyScalar(3 * delta); camera.position.add(dir); }
  });

  return null;
}

// ── Measurement Visuals ──────────────────────────────────────────────────────

function MeasurementVisuals({ points }: { points: MeasurePoint[] }) {
  const sphereGeo = useMemo(() => new THREE.SphereGeometry(0.03, 16, 16), []);
  const greenMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#35c889' }), []);
  const orangeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#a4a4ff' }), []);
  const lineObj = useMemo(() => {
    if (points.length < 2) return null;
    const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => p.position));
    const mat = new THREE.LineBasicMaterial({ color: '#35c889', linewidth: 2 });
    return new THREE.Line(geo, mat);
  }, [points]);

  return (
    <group>
      {points.map((pt, i) => (
        <mesh key={`mpt-${i}`} position={pt.position} geometry={sphereGeo} material={i === 0 ? orangeMat : greenMat} />
      ))}
      {lineObj && <primitive object={lineObj} />}
    </group>
  );
}

// ── MeasureTool ──────────────────────────────────────────────────────────────

function MeasureTool({ active, points, onAddPoint }: { active: boolean; points: MeasurePoint[]; onAddPoint: (pt: THREE.Vector3) => void }) {
  const { camera, scene, gl, raycaster } = useThree();

  useEffect(() => { raycaster.params.Points = { threshold: 0.1 }; }, [raycaster]);

  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(mouse, camera);

      // Raycast against Points objects (including hidden raycasting mesh)
      const pointObjs: THREE.Object3D[] = [];
      const meshObjs: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (o instanceof THREE.Points) pointObjs.push(o);
        else if (o instanceof THREE.Mesh && o.geometry.index) meshObjs.push(o);
      });

      let intersects = raycaster.intersectObjects(pointObjs, false);
      if (intersects.length === 0) intersects = raycaster.intersectObjects(meshObjs, false);
      if (intersects.length > 0) { onAddPoint(intersects[0].point.clone()); return; }

      // Fallback: ground plane
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const target = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, target);
      if (target) onAddPoint(target.clone());
    };
    gl.domElement.addEventListener('click', onClick);
    return () => gl.domElement.removeEventListener('click', onClick);
  }, [active, camera, scene, gl, raycaster, onAddPoint]);

  return <MeasurementVisuals points={points} />;
}

// ── Hidden raycasting mesh (positions only, invisible) ───────────────────────

function RaycastPoints({ positions }: { positions: Float32Array }) {
  const ref = useRef<THREE.Points>(null);

  useEffect(() => {
    if (!ref.current || !positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    ref.current.geometry.dispose();
    ref.current.geometry = geometry;
  }, [positions]);

  return (
    <points ref={ref} visible={false}>
      <bufferGeometry />
      <pointsMaterial size={0.01} />
    </points>
  );
}

// ── Gaussian Splat Cloud (true splatting via @mkkellogg/gaussian-splats-3d) ──

// #region agent log - debug helper
const _dbg = (msg: string, data?: Record<string, unknown>) => {
  const payload = { location: 'Viewer3D.tsx', message: msg, data, timestamp: Date.now() };
  console.log(`[GS3D] ${msg}`, data || '');
  fetch('http://127.0.0.1:7242/ingest/b2b8460e-d7ee-4616-88da-4d108adb3922',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});
};
// #endregion

function GaussianSplatCloud({
  url,
  onMetadata,
  onError,
}: {
  url: string;
  onMetadata: (m: ModelMetadata) => void;
  onError?: (msg: string) => void;
}) {
  const [viewer, setViewer] = useState<DropInViewer | null>(null);
  const [raycastPos, setRaycastPos] = useState<Float32Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!url) return;
    let disposed = false;
    let blobUrl: string | null = null;
    let viewerInst: DropInViewer | null = null;

    setLoading(true);
    setError(null);

    // #region agent log
    _dbg('STEP_0_START', { url, hypothesisId: 'A' });
    // #endregion

    (async () => {
      try {
        // 1. Fetch the PLY file
        // #region agent log
        _dbg('STEP_1_FETCH_START', { url, hypothesisId: 'A' });
        // #endregion
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (disposed) return;
        // #region agent log
        _dbg('STEP_1_FETCH_OK', { bytes: buffer.byteLength, hypothesisId: 'A' });
        // #endregion

        // 2. Parse for metadata + centered positions (raycasting)
        // #region agent log
        _dbg('STEP_2_PARSE_START', { bufferSize: buffer.byteLength, hypothesisId: 'B' });
        // #endregion
        const meta = parsePLYForMeta(buffer);
        if (meta.vertexCount === 0) throw new Error('No visible points in PLY');
        // #region agent log
        _dbg('STEP_2_PARSE_OK', {
          vertexCount: meta.vertexCount, totalVertices: meta.totalVertices,
          center: meta.center, props: meta.properties.slice(0, 15),
          hypothesisId: 'B',
        });
        // #endregion

        setRaycastPos(meta.positions);

        // Report metadata
        onMetadata({
          pointCount: meta.vertexCount,
          fileSize: buffer.byteLength,
          boundingBox: meta.boundingBox,
          hasColors: meta.hasColors,
          hasOpacity: meta.hasOpacity,
          properties: meta.properties,
          format: 'gaussian_splat',
        });

        // 3. Create blob URL for the viewer (avoids double-download)
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        blobUrl = URL.createObjectURL(blob);
        // #region agent log
        _dbg('STEP_3_BLOB_URL', { blobUrl, hypothesisId: 'C' });
        // #endregion

        // 4. Create DropInViewer for true Gaussian splatting
        // #region agent log
        _dbg('STEP_4_CREATE_VIEWER', { hypothesisId: 'C' });
        // #endregion
        viewerInst = new DropInViewer({
          gpuAcceleratedSort: true,
          sharedMemoryForWorkers: false,
          sceneRevealMode: SceneRevealMode.Instant,
          freeIntermediateSplatData: true,
          antialiased: false,
        });
        // #region agent log
        _dbg('STEP_4_VIEWER_CREATED', { hypothesisId: 'C' });
        // #endregion

        // #region agent log
        _dbg('STEP_5_ADD_SCENE_START', { center: meta.center, hypothesisId: 'D' });
        // #endregion
        await viewerInst.addSplatScene(blobUrl, {
          splatAlphaRemovalThreshold: 5,
          showLoadingUI: false,
          position: [-meta.center[0], -meta.center[1], -meta.center[2]],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        });

        if (disposed) return;

        const splatCount = viewerInst.getSplatCount();
        // #region agent log
        _dbg('STEP_5_ADD_SCENE_OK', { splatCount, hypothesisId: 'D' });
        // #endregion
        console.log(`Gaussian splat scene loaded: ${splatCount} splats`);
        setViewer(viewerInst);
        setLoading(false);
      } catch (err: unknown) {
        if (!disposed) {
          const msg = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : '';
          // #region agent log
          _dbg('ERROR', { msg, stack, hypothesisId: 'E' });
          // #endregion
          console.error('Gaussian splat load error:', msg, stack);
          setError(msg);
          onError?.(msg);
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      if (viewerInst) {
        try { viewerInst.dispose(); } catch { /* ignore dispose errors */ }
      }
    };
  }, [url, onMetadata]);

  if (error) {
    return (
      <group>
        {/* Show error visually in the 3D scene */}
        <mesh>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color="#ff3333" wireframe />
        </mesh>
      </group>
    );
  }

  return (
    <group>
      {/* True Gaussian splat rendering */}
      {viewer && <primitive object={viewer} />}

      {/* Loading indicator */}
      {loading && (
        <mesh>
          <sphereGeometry args={[0.2, 16, 16]} />
          <meshBasicMaterial color="#35c889" wireframe transparent opacity={0.5} />
        </mesh>
      )}

      {/* Hidden points mesh for measurement raycasting */}
      {raycastPos && <RaycastPoints positions={raycastPos} />}
    </group>
  );
}

// ── Scene Setup ──────────────────────────────────────────────────────────────

function SceneSetup({ mode }: { mode: ViewerMode }) {
  return (
    <>
      <color attach="background" args={['#060606']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.3} />
      <gridHelper args={[30, 30, 0x0c1f1f, 0x081717]} position={[0, -0.01, 0]} />
      {mode === 'orbit' && (
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport axisColors={['#ff4444', '#44ff44', '#4444ff']} labelColor="white" />
        </GizmoHelper>
      )}
    </>
  );
}

// ── Main Viewer Component ────────────────────────────────────────────────────

export default function Viewer3D({ modelUrl, onModelMetadata }: Viewer3DProps) {
  const [mode, setMode] = useState<ViewerMode>('orbit');
  const [showHelp, setShowHelp] = useState(false);
  const [splatError, setSplatError] = useState<string | null>(null);

  // ── Measurement state ───────────────────────────────────────────────────
  const [measurePhase, setMeasurePhase] = useState<MeasurePhase>('calibrate');
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [calibPoints, setCalibPoints] = useState<MeasurePoint[]>([]);
  const [meterInput, setMeterInput] = useState('1.0');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);

  const visibleMeasurePoints = measurePhase === 'calibrate' ? calibPoints : measurePoints;

  const handleMetadata = useCallback((meta: ModelMetadata) => { onModelMetadata?.(meta); }, [onModelMetadata]);

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
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    requestAnimationFrame(() => {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `gaussian-splat-snapshot-${Date.now()}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
  }, []);

  const handleReset = useCallback(() => {
    setMode('orbit');
    handleResetCalibration();
  }, [handleResetCalibration]);

  useEffect(() => { if (mode !== 'measure') { handleResetCalibration(); } }, [mode]);

  if (!modelUrl) return null;

  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
  const fullPlyUrl = modelUrl.startsWith('http') ? modelUrl : `${apiBase}${modelUrl}`;

  return (
    <div className="w-full h-full relative group bg-[#060606] rounded-xl overflow-hidden">
      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 2, 5], fov: 60, near: 0.01, far: 1000 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <SceneSetup mode={mode} />

        {mode === 'orbit' && (
          <OrbitControls makeDefault enableDamping dampingFactor={0.05} rotateSpeed={0.8} zoomSpeed={0.8} panSpeed={0.8} target={[0, 0, 0]} />
        )}

        <WalkthroughControls active={mode === 'walkthrough'} />
        <MeasureTool active={mode === 'measure'} points={visibleMeasurePoints} onAddPoint={handleAddMeasurePoint} />

        <GaussianSplatCloud url={fullPlyUrl} onMetadata={handleMetadata} onError={setSplatError} />
      </Canvas>

      {/* ── Error Overlay (debug) ──────────────────────────────────────────── */}
      {splatError && (
        <div className="absolute top-12 left-3 right-3 z-30 bg-red-900/80 backdrop-blur-md text-white text-xs p-3 rounded-lg border border-red-500/40 font-mono break-all">
          <span className="text-red-300 font-bold">Viewer Error:</span> {splatError}
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
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${measurePhase === 'calibrate' ? 'bg-[#a4a4ff]/15 text-[#a4a4ff]' : 'bg-[#35c889]/15 text-[#35c889]'}`}>
              {measurePhase === 'calibrate' ? 'STEP 1: Calibrate' : 'STEP 2: Measure'}
            </span>
            <div className="border-l border-white/[0.06] h-5" />

            {measurePhase === 'calibrate' ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={`flex items-center gap-1 ${calibPoints.length >= 1 ? 'text-[#a4a4ff]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> A {calibPoints.length >= 1 ? '✓' : ''}
                  </span>
                  <span className="text-white/15">&rarr;</span>
                  <span className={`flex items-center gap-1 ${calibPoints.length >= 2 ? 'text-[#35c889]' : 'text-white/30'}`}>
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
                        className="w-16 bg-[#081717] border border-white/[0.08] rounded px-1.5 py-0.5 text-white text-xs font-mono text-center focus:border-[#35c889]/40 focus:outline-none"
                      />
                      <span className="text-white/40">m</span>
                    </div>
                    <button
                      onClick={handleConfirmCalibration}
                      className="px-2 py-0.5 rounded bg-[#35c889]/15 text-[#35c889] border border-[#35c889]/20 hover:bg-[#35c889]/25 transition-colors"
                    >
                      Confirm
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className={`flex items-center gap-1 ${measurePoints.length >= 1 ? 'text-[#a4a4ff]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> A {measurePoints.length >= 1 ? '✓' : ''}
                  </span>
                  <span className="text-white/15">&rarr;</span>
                  <span className={`flex items-center gap-1 ${measurePoints.length >= 2 ? 'text-[#35c889]' : 'text-white/30'}`}>
                    <CircleDot className="w-3 h-3" /> B {measurePoints.length >= 2 ? '✓' : ''}
                  </span>
                </div>
                {measuredDistance !== null && (
                  <>
                    <div className="border-l border-white/[0.06] h-5" />
                    <div className="flex items-center gap-2">
                      <Ruler className="w-3.5 h-3.5 text-[#35c889]" />
                      <span className="text-[#35c889] text-sm font-semibold">{measuredDistance.toFixed(3)}</span>
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
                <button onClick={handleResetCalibration} className="flex items-center gap-1 text-[#a4a4ff]/60 hover:text-[#a4a4ff] transition-colors text-[10px]">
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
          <div className="bg-[#060606]/95 backdrop-blur-md border border-white/[0.06] rounded-xl p-4 text-xs text-white/70 space-y-3">
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
    ? 'bg-[#35c889]/15 text-[#35c889] border-[#35c889]/20'
    : 'bg-black/70 text-white/50 border-white/[0.06] hover:text-white hover:bg-[#081717]';
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
