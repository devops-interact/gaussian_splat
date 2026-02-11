import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import {
  Camera,
  Ruler,
  RotateCcw,
  ZoomIn,
  ZoomOut,
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
  points: MeasurePoint[];          // 2 reference points
  rawDistance: number;             // 3D distance between them
  realMeters: number;             // user-entered real distance in meters
  scaleFactor: number;            // realMeters / rawDistance
}


// ── Constants ────────────────────────────────────────────────────────────────

const SH_C0 = 0.28209479177387814;

// ── PLY Parser ───────────────────────────────────────────────────────────────

interface ParseResult {
  positions: Float32Array;
  colors: Float32Array;
  vertexCount: number;
  metadata: {
    totalVertices: number;
    visibleVertices: number;
    hasColors: boolean;
    hasOpacity: boolean;
    properties: string[];
    format: string;
    colorSource: 'rgb' | 'sh' | 'none';
    boundingBox: { min: [number, number, number]; max: [number, number, number] };
  };
}

function parseGaussianPLY(buffer: ArrayBuffer): ParseResult {
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

  if (headerEnd === -1) throw new Error('Invalid PLY: no end_header found');

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

  if (vertexCount === 0) throw new Error('No vertices in PLY file');

  const propNames = properties.map(p => p.name);
  const format = isBinary ? (isLittleEndian ? 'binary_little_endian' : 'binary_big_endian') : 'ascii';

  const xIdx = propNames.indexOf('x');
  const yIdx = propNames.indexOf('y');
  const zIdx = propNames.indexOf('z');
  const f_dc_0_idx = propNames.indexOf('f_dc_0');
  const f_dc_1_idx = propNames.indexOf('f_dc_1');
  const f_dc_2_idx = propNames.indexOf('f_dc_2');
  const redIdx = propNames.indexOf('red');
  const greenIdx = propNames.indexOf('green');
  const blueIdx = propNames.indexOf('blue');
  const opacityIdx = propNames.indexOf('opacity');

  const hasRGB = redIdx !== -1 && greenIdx !== -1 && blueIdx !== -1;
  const hasSH = f_dc_0_idx !== -1 && f_dc_1_idx !== -1 && f_dc_2_idx !== -1;
  const hasColors = hasRGB || hasSH;
  const hasOpacity = opacityIdx !== -1;
  const colorSource: 'rgb' | 'sh' | 'none' = hasSH ? 'sh' : hasRGB ? 'rgb' : 'none';

  console.log(`PLY: ${vertexCount} verts, format=${format}, colorSource=${colorSource}, props=[${propNames.slice(0, 15).join(', ')}${propNames.length > 15 ? '...' : ''}]`);

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
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

    const readFloat = (offset: number, idx: number): number => {
      const type = properties[idx].type;
      if (type === 'double' || type === 'float64') return dataView.getFloat64(offset + propOffsets[idx], isLittleEndian);
      return dataView.getFloat32(offset + propOffsets[idx], isLittleEndian);
    };
    const readUchar = (offset: number, idx: number): number => dataView.getUint8(offset + propOffsets[idx]);

    const maxVerts = Math.min(vertexCount, Math.floor(availableSize / bytesPerVertex));

    for (let i = 0; i < maxVerts; i++) {
      const vOff = i * bytesPerVertex;
      const x = readFloat(vOff, xIdx);
      const y = readFloat(vOff, yIdx);
      const z = readFloat(vOff, zIdx);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;

      if (opacityIdx !== -1) {
        const rawOp = readFloat(vOff, opacityIdx);
        if (1 / (1 + Math.exp(-rawOp)) < 0.005) continue;
      }

      const idx3 = visibleCount * 3;
      positions[idx3] = x; positions[idx3 + 1] = y; positions[idx3 + 2] = z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;

      if (hasSH) {
        const f0 = readFloat(vOff, f_dc_0_idx);
        const f1 = readFloat(vOff, f_dc_1_idx);
        const f2 = readFloat(vOff, f_dc_2_idx);
        colors[idx3] = Math.max(0, Math.min(1, SH_C0 * f0 + 0.5));
        colors[idx3 + 1] = Math.max(0, Math.min(1, SH_C0 * f1 + 0.5));
        colors[idx3 + 2] = Math.max(0, Math.min(1, SH_C0 * f2 + 0.5));
      } else if (hasRGB) {
        const rType = properties[redIdx].type;
        if (rType === 'uchar' || rType === 'uint8') {
          colors[idx3] = readUchar(vOff, redIdx) / 255;
          colors[idx3 + 1] = readUchar(vOff, greenIdx) / 255;
          colors[idx3 + 2] = readUchar(vOff, blueIdx) / 255;
        } else {
          colors[idx3] = Math.max(0, Math.min(1, readFloat(vOff, redIdx)));
          colors[idx3 + 1] = Math.max(0, Math.min(1, readFloat(vOff, greenIdx)));
          colors[idx3 + 2] = Math.max(0, Math.min(1, readFloat(vOff, blueIdx)));
        }
      } else {
        colors[idx3] = 0.7; colors[idx3 + 1] = 0.7; colors[idx3 + 2] = 0.7;
      }

      visibleCount++;
    }
  } else {
    const dataText = decoder.decode(bytes.slice(headerEnd));
    const dataLines = dataText.split('\n').filter(l => l.trim());
    const count = Math.min(vertexCount, dataLines.length);

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

      if (hasSH) {
        colors[idx3] = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_0_idx] + 0.5));
        colors[idx3 + 1] = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_1_idx] + 0.5));
        colors[idx3 + 2] = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_2_idx] + 0.5));
      } else if (hasRGB) {
        colors[idx3] = parts[redIdx] / 255;
        colors[idx3 + 1] = parts[greenIdx] / 255;
        colors[idx3 + 2] = parts[blueIdx] / 255;
      } else {
        colors[idx3] = 0.7; colors[idx3 + 1] = 0.7; colors[idx3 + 2] = 0.7;
      }
      visibleCount++;
    }
  }

  console.log(`Parsed ${visibleCount} visible points (from ${vertexCount} total), colorSource=${colorSource}`);

  return {
    positions: positions.slice(0, visibleCount * 3),
    colors: colors.slice(0, visibleCount * 3),
    vertexCount: visibleCount,
    metadata: {
      totalVertices: vertexCount,
      visibleVertices: visibleCount,
      hasColors, hasOpacity,
      properties: propNames, format, colorSource,
      boundingBox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    },
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

      // Try points first, then meshes
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

// ── PointCloud Component ─────────────────────────────────────────────────────

function PointCloud({ url, onMetadata, pointSize }: { url: string; onMetadata: (m: ModelMetadata) => void; pointSize: number }) {
  const meshRef = useRef<THREE.Points | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    setError(null);
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then(buffer => {
        const result = parseGaussianPLY(buffer);
        if (result.vertexCount === 0) throw new Error('No visible points');
        if (!meshRef.current) return;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(result.positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(result.colors, 3));
        geometry.computeBoundingBox();

        const bbox = geometry.boundingBox;
        if (bbox) {
          const center = new THREE.Vector3();
          bbox.getCenter(center);
          geometry.translate(-center.x, -center.y, -center.z);
        }
        geometry.computeBoundingSphere();

        const bsRadius = geometry.boundingSphere?.radius || 1;
        // Tighter, smaller points for denser visual appearance
        const adaptiveSize = Math.max(0.001, Math.min(0.015, bsRadius / Math.sqrt(result.vertexCount) * 1.5));
        console.log(`Adaptive point size: radius=${bsRadius.toFixed(3)}, count=${result.vertexCount}, size=${adaptiveSize.toFixed(4)}`);
        const material = new THREE.PointsMaterial({
          size: pointSize > 0 ? pointSize : adaptiveSize,
          vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.92, depthWrite: true,
        });

        meshRef.current.geometry.dispose();
        if (meshRef.current.material instanceof THREE.Material) meshRef.current.material.dispose();
        meshRef.current.geometry = geometry;
        meshRef.current.material = material;

        onMetadata({
          pointCount: result.vertexCount, fileSize: buffer.byteLength,
          boundingBox: result.metadata.boundingBox, hasColors: result.metadata.hasColors,
          hasOpacity: result.metadata.hasOpacity, properties: result.metadata.properties,
          format: result.metadata.format,
        });
      })
      .catch(err => { console.error('PLY error:', err); setError(err.message); });
  }, [url, onMetadata, pointSize]);

  if (error) return <group><mesh><boxGeometry args={[0.5, 0.5, 0.5]} /><meshStandardMaterial color="#ff3333" wireframe /></mesh></group>;

  return (
    <points ref={meshRef}>
      <bufferGeometry />
      <pointsMaterial size={0.01} vertexColors sizeAttenuation transparent opacity={0.95} />
    </points>
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
  const [pointSize, setPointSize] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── Measurement state ───────────────────────────────────────────────────
  const [measurePhase, setMeasurePhase] = useState<MeasurePhase>('calibrate');
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [calibPoints, setCalibPoints] = useState<MeasurePoint[]>([]);
  const [meterInput, setMeterInput] = useState('1.0');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);

  // All visible points for measurement visuals (both calib and measure)
  const visibleMeasurePoints = measurePhase === 'calibrate' ? calibPoints : measurePoints;

  const handleMetadata = useCallback((meta: ModelMetadata) => { onModelMetadata?.(meta); }, [onModelMetadata]);

  const handleAddMeasurePoint = useCallback((point: THREE.Vector3) => {
    if (measurePhase === 'calibrate') {
      setCalibPoints(prev => {
        if (prev.length >= 2) return [{ position: point }];
        return [...prev, { position: point }];
      });
    } else {
      // Measure mode
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
    setMode('orbit'); setPointSize(0);
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
        ref={canvasRef as any}
      >
        <SceneSetup mode={mode} />

        {mode === 'orbit' && (
          <OrbitControls makeDefault enableDamping dampingFactor={0.05} rotateSpeed={0.8} zoomSpeed={0.8} panSpeed={0.8} target={[0, 0, 0]} />
        )}

        <WalkthroughControls active={mode === 'walkthrough'} />
        <MeasureTool active={mode === 'measure'} points={visibleMeasurePoints} onAddPoint={handleAddMeasurePoint} />

        <PointCloud url={fullPlyUrl} onMetadata={handleMetadata} pointSize={pointSize} />
      </Canvas>

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
            {/* Phase indicator */}
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${measurePhase === 'calibrate' ? 'bg-[#a4a4ff]/15 text-[#a4a4ff]' : 'bg-[#35c889]/15 text-[#35c889]'}`}>
              {measurePhase === 'calibrate' ? 'STEP 1: Calibrate' : 'STEP 2: Measure'}
            </span>
            <div className="border-l border-white/[0.06] h-5" />

            {measurePhase === 'calibrate' ? (
              <>
                {/* Calibration: pick 2 reference points, then enter real distance */}
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
                {/* Measure mode: pick points, show calibrated distance */}
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

      {/* ── Bottom-Left: Point Size Controls ──────────────────────────────── */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
        <div className="bg-black/70 backdrop-blur-md rounded-lg border border-white/[0.06] flex items-center px-2 py-1 gap-1">
          <span className="text-[10px] text-white/40 font-mono mr-1">Size</span>
          <button onClick={() => setPointSize(p => Math.max(0.001, (p || 0.01) / 1.5))} className="text-white/50 hover:text-[#35c889] p-0.5 transition-colors"><ZoomOut className="w-3 h-3" /></button>
          <span className="text-[10px] text-[#35c889]/60 font-mono w-10 text-center">{pointSize > 0 ? pointSize.toFixed(3) : 'Auto'}</span>
          <button onClick={() => setPointSize(p => Math.min(0.1, (p || 0.01) * 1.5))} className="text-white/50 hover:text-[#35c889] p-0.5 transition-colors"><ZoomIn className="w-3 h-3" /></button>
          <button onClick={() => setPointSize(0)} className="text-white/30 hover:text-[#35c889] p-0.5 ml-1 transition-colors text-[9px] font-mono">Auto</button>
        </div>
      </div>

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

function ToolbarButton({ icon, label, active, onClick, accent }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; accent?: 'green' | 'lavender';
}) {
  const color = accent === 'lavender'
    ? (active ? 'bg-[#a4a4ff]/15 text-[#a4a4ff] border-[#a4a4ff]/20' : 'bg-black/70 text-white/50 border-white/[0.06] hover:text-white hover:bg-[#081717]')
    : (active ? 'bg-[#35c889]/15 text-[#35c889] border-[#35c889]/20' : 'bg-black/70 text-white/50 border-white/[0.06] hover:text-white hover:bg-[#081717]');
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
