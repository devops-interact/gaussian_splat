import { useEffect, useRef, useState, useCallback } from 'react';
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
    boundingBox: { min: [number, number, number]; max: [number, number, number] };
  };
}

function parseGaussianPLY(buffer: ArrayBuffer): ParseResult {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8');

  // Find "end_header"
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
      while (headerEnd < bytes.length && (bytes[headerEnd] === 0x0a || bytes[headerEnd] === 0x0d)) {
        headerEnd++;
      }
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

  console.log(`PLY: ${vertexCount} vertices, format=${format}, props=[${propNames.slice(0, 15).join(', ')}${propNames.length > 15 ? '...' : ''}]`);

  // Property indices
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

  const hasColors = f_dc_0_idx !== -1 || redIdx !== -1;
  const hasOpacity = opacityIdx !== -1;

  // Pre-allocate arrays (will be trimmed later)
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  let visibleCount = 0;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  if (isBinary) {
    const dataView = new DataView(buffer, headerEnd);

    // Calculate byte offsets
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

    // Verify we have enough data
    const expectedSize = vertexCount * bytesPerVertex;
    const availableSize = buffer.byteLength - headerEnd;
    if (availableSize < expectedSize) {
      console.warn(`PLY data truncated: expected ${expectedSize} bytes, got ${availableSize}`);
    }

    const readFloat = (offset: number, idx: number): number => {
      const type = properties[idx].type;
      switch (type) {
        case 'float': case 'float32': return dataView.getFloat32(offset + propOffsets[idx], isLittleEndian);
        case 'double': case 'float64': return dataView.getFloat64(offset + propOffsets[idx], isLittleEndian);
        default: return dataView.getFloat32(offset + propOffsets[idx], isLittleEndian);
      }
    };

    const readUchar = (offset: number, idx: number): number => {
      return dataView.getUint8(offset + propOffsets[idx]);
    };

    const maxVerts = Math.min(vertexCount, Math.floor(availableSize / bytesPerVertex));

    for (let i = 0; i < maxVerts; i++) {
      const vOff = i * bytesPerVertex;

      const x = readFloat(vOff, xIdx);
      const y = readFloat(vOff, yIdx);
      const z = readFloat(vOff, zIdx);

      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;

      // Opacity filtering (sigmoid activation)
      if (opacityIdx !== -1) {
        const rawOpacity = readFloat(vOff, opacityIdx);
        const alpha = 1 / (1 + Math.exp(-rawOpacity));
        if (alpha < 0.005) continue;
      }

      const idx3 = visibleCount * 3;
      positions[idx3] = x;
      positions[idx3 + 1] = y;
      positions[idx3 + 2] = z;

      // Track bounding box
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;

      // Color extraction
      if (f_dc_0_idx !== -1) {
        const f0 = readFloat(vOff, f_dc_0_idx);
        const f1 = readFloat(vOff, f_dc_1_idx);
        const f2 = readFloat(vOff, f_dc_2_idx);
        colors[idx3] = Math.max(0, Math.min(1, SH_C0 * f0 + 0.5));
        colors[idx3 + 1] = Math.max(0, Math.min(1, SH_C0 * f1 + 0.5));
        colors[idx3 + 2] = Math.max(0, Math.min(1, SH_C0 * f2 + 0.5));
      } else if (redIdx !== -1) {
        const propType = properties[redIdx].type;
        if (propType === 'uchar' || propType === 'uint8') {
          colors[idx3] = readUchar(vOff, redIdx) / 255;
          colors[idx3 + 1] = readUchar(vOff, greenIdx) / 255;
          colors[idx3 + 2] = readUchar(vOff, blueIdx) / 255;
        } else {
          const r = readFloat(vOff, redIdx);
          const g = readFloat(vOff, greenIdx);
          const b = readFloat(vOff, blueIdx);
          colors[idx3] = Math.max(0, Math.min(1, r));
          colors[idx3 + 1] = Math.max(0, Math.min(1, g));
          colors[idx3 + 2] = Math.max(0, Math.min(1, b));
        }
      } else {
        colors[idx3] = 0.7;
        colors[idx3 + 1] = 0.7;
        colors[idx3 + 2] = 0.7;
      }

      visibleCount++;
    }
  } else {
    // ASCII PLY
    const dataText = decoder.decode(bytes.slice(headerEnd));
    const dataLines = dataText.split('\n').filter(l => l.trim());
    const count = Math.min(vertexCount, dataLines.length);

    for (let i = 0; i < count; i++) {
      const parts = dataLines[i].trim().split(/\s+/).map(parseFloat);
      const x = parts[xIdx], y = parts[yIdx], z = parts[zIdx];
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;

      if (opacityIdx !== -1) {
        const alpha = 1 / (1 + Math.exp(-parts[opacityIdx]));
        if (alpha < 0.005) continue;
      }

      const idx3 = visibleCount * 3;
      positions[idx3] = x; positions[idx3 + 1] = y; positions[idx3 + 2] = z;

      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;

      if (f_dc_0_idx !== -1) {
        colors[idx3] = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_0_idx] + 0.5));
        colors[idx3 + 1] = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_1_idx] + 0.5));
        colors[idx3 + 2] = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_2_idx] + 0.5));
      } else if (redIdx !== -1) {
        colors[idx3] = parts[redIdx] / 255;
        colors[idx3 + 1] = parts[greenIdx] / 255;
        colors[idx3 + 2] = parts[blueIdx] / 255;
      } else {
        colors[idx3] = 0.7; colors[idx3 + 1] = 0.7; colors[idx3 + 2] = 0.7;
      }

      visibleCount++;
    }
  }

  console.log(`Parsed ${visibleCount} visible points (from ${vertexCount} total)`);

  return {
    positions: positions.slice(0, visibleCount * 3),
    colors: colors.slice(0, visibleCount * 3),
    vertexCount: visibleCount,
    metadata: {
      totalVertices: vertexCount,
      visibleVertices: visibleCount,
      hasColors,
      hasOpacity,
      properties: propNames,
      format,
      boundingBox: {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
    },
  };
}

// ── Walkthrough Controls (First-Person) ──────────────────────────────────────

function WalkthroughControls({ active }: { active: boolean }) {
  const { camera, gl } = useThree();
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const keys = useRef<Set<string>>(new Set());
  const isLocked = useRef(false);
  const MOVE_SPEED = 3;
  const LOOK_SPEED = 0.002;

  useEffect(() => {
    if (!active) {
      document.exitPointerLock?.();
      isLocked.current = false;
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => keys.current.add(e.code);
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onClick = () => {
      if (active && !isLocked.current) {
        gl.domElement.requestPointerLock();
      }
    };
    const onPointerLockChange = () => {
      isLocked.current = document.pointerLockElement === gl.domElement;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isLocked.current) return;
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= e.movementX * LOOK_SPEED;
      euler.current.x -= e.movementY * LOOK_SPEED;
      euler.current.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.current.x));
      camera.quaternion.setFromEuler(euler.current);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    gl.domElement.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      gl.domElement.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.exitPointerLock?.();
      isLocked.current = false;
    };
  }, [active, camera, gl]);

  useFrame((_, delta) => {
    if (!active || !isLocked.current) return;

    const direction = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

    if (keys.current.has('KeyW') || keys.current.has('ArrowUp')) direction.add(forward);
    if (keys.current.has('KeyS') || keys.current.has('ArrowDown')) direction.sub(forward);
    if (keys.current.has('KeyA') || keys.current.has('ArrowLeft')) direction.sub(right);
    if (keys.current.has('KeyD') || keys.current.has('ArrowRight')) direction.add(right);
    if (keys.current.has('Space')) direction.y += 1;
    if (keys.current.has('ShiftLeft')) direction.y -= 1;

    if (direction.lengthSq() > 0) {
      direction.normalize().multiplyScalar(MOVE_SPEED * delta);
      camera.position.add(direction);
    }
  });

  return null;
}

// ── Measurement Line ─────────────────────────────────────────────────────────

function MeasurementLine({
  points,
}: {
  points: MeasurePoint[];
}) {
  if (points.length < 2) return null;

  const linePoints = points.map(p => p.position);

  const lineGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
  const lineMat = new THREE.LineBasicMaterial({ color: '#00ff88', linewidth: 2 });
  const lineObj = new THREE.Line(lineGeo, lineMat);

  return (
    <group>
      <primitive object={lineObj} />
      {/* Start point */}
      <mesh position={linePoints[0]}>
        <sphereGeometry args={[0.02, 16, 16]} />
        <meshBasicMaterial color="#00ff88" />
      </mesh>
      {/* End point */}
      <mesh position={linePoints[1]}>
        <sphereGeometry args={[0.02, 16, 16]} />
        <meshBasicMaterial color="#00ff88" />
      </mesh>
    </group>
  );
}

// ── MeasureTool ──────────────────────────────────────────────────────────────

function MeasureTool({
  active,
  onMeasure,
}: {
  active: boolean;
  onMeasure: (distance: number | null) => void;
}) {
  const { camera, raycaster, scene, gl } = useThree();
  const points = useRef<MeasurePoint[]>([]);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);

  useEffect(() => {
    if (!active) {
      points.current = [];
      setMeasurePoints([]);
      onMeasure(null);
      return;
    }

    const onClick = (e: MouseEvent) => {
      if (!active) return;
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      raycaster.setFromCamera(mouse, camera);

      // Find intersection with point cloud
      const intersects = raycaster.intersectObjects(scene.children, true);
      if (intersects.length > 0) {
        const point = intersects[0].point.clone();

        if (points.current.length >= 2) {
          points.current = [];
        }

        points.current.push({ position: point });
        setMeasurePoints([...points.current]);

        if (points.current.length === 2) {
          const dist = points.current[0].position.distanceTo(points.current[1].position);
          onMeasure(dist);
        } else {
          onMeasure(null);
        }
      }
    };

    gl.domElement.addEventListener('click', onClick);
    return () => gl.domElement.removeEventListener('click', onClick);
  }, [active, camera, raycaster, scene, gl, onMeasure]);

  return <MeasurementLine points={measurePoints} />;
}

// ── PointCloud Component ─────────────────────────────────────────────────────

function PointCloud({
  url,
  onMetadata,
  pointSize,
}: {
  url: string;
  onMetadata: (meta: ModelMetadata) => void;
  pointSize: number;
}) {
  const meshRef = useRef<THREE.Points | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    setError(null);

    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        return response.arrayBuffer();
      })
      .then(buffer => {
        try {
          const result = parseGaussianPLY(buffer);

          if (result.vertexCount === 0) {
            throw new Error('No visible points in model after filtering');
          }

          if (meshRef.current) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(result.positions, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(result.colors, 3));
            geometry.computeBoundingBox();

            const bbox = geometry.boundingBox;
            if (bbox) {
              const center = new THREE.Vector3();
              bbox.getCenter(center);
              geometry.translate(-center.x, -center.y, -center.z);
              const minY = bbox.min.y - center.y;
              geometry.translate(0, -minY, 0);
            }

            geometry.computeBoundingSphere();

            // Adaptive point size based on bounding sphere
            const bsRadius = geometry.boundingSphere?.radius || 1;
            const adaptiveSize = Math.max(0.002, Math.min(0.05, bsRadius / Math.sqrt(result.vertexCount) * 2));

            const material = new THREE.PointsMaterial({
              size: pointSize > 0 ? pointSize : adaptiveSize,
              vertexColors: true,
              sizeAttenuation: true,
              transparent: true,
              opacity: 0.95,
              depthWrite: true,
            });

            // Dispose old
            meshRef.current.geometry.dispose();
            if (meshRef.current.material instanceof THREE.Material) {
              meshRef.current.material.dispose();
            }

            meshRef.current.geometry = geometry;
            meshRef.current.material = material;

            // Emit metadata
            onMetadata({
              pointCount: result.vertexCount,
              fileSize: buffer.byteLength,
              boundingBox: result.metadata.boundingBox,
              hasColors: result.metadata.hasColors,
              hasOpacity: result.metadata.hasOpacity,
              properties: result.metadata.properties,
              format: result.metadata.format,
            });
          }
        } catch (err: any) {
          console.error('PLY parse error:', err);
          setError(err.message || 'Failed to parse PLY');
        }
      })
      .catch(err => {
        console.error('Fetch error:', err);
        setError('Failed to load model: ' + err.message);
      });
  }, [url, onMetadata, pointSize]);

  if (error) {
    return (
      <group>
        <mesh>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color="#ff3333" wireframe />
        </mesh>
      </group>
    );
  }

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
      <color attach="background" args={['#0a0a0a']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.3} />
      <gridHelper args={[30, 30, 0x222222, 0x111111]} position={[0, -0.01, 0]} />
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
  const [pointSize, setPointSize] = useState(0); // 0 = auto
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleMetadata = useCallback((meta: ModelMetadata) => {
    onModelMetadata?.(meta);
  }, [onModelMetadata]);

  const handleMeasure = useCallback((distance: number | null) => {
    setMeasuredDistance(distance);
  }, []);

  // Snapshot
  const handleSnapshot = useCallback(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    // Need to render a frame before capturing
    requestAnimationFrame(() => {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `gaussian-splat-snapshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }, []);

  // Reset view
  const handleReset = useCallback(() => {
    setMode('orbit');
    setMeasuredDistance(null);
    setPointSize(0);
  }, []);

  if (!modelUrl) return null;

  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
  const fullUrl = modelUrl.startsWith('http') ? modelUrl : `${apiBase}${modelUrl}`;

  return (
    <div className="w-full h-full relative group bg-[#0a0a0a] rounded-xl overflow-hidden">
      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 2, 5], fov: 60, near: 0.01, far: 1000 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        ref={canvasRef as any}
      >
        <SceneSetup mode={mode} />

        {mode === 'orbit' && (
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.05}
            rotateSpeed={0.8}
            zoomSpeed={0.8}
            panSpeed={0.8}
            target={[0, 1, 0]}
          />
        )}

        <WalkthroughControls active={mode === 'walkthrough'} />
        <MeasureTool active={mode === 'measure'} onMeasure={handleMeasure} />
        <PointCloud url={fullUrl} onMetadata={handleMetadata} pointSize={pointSize} />
      </Canvas>

      {/* ── Top-Left: Mode Indicator ───────────────────────────────────────── */}
      <div className="absolute top-3 left-3 z-10">
        <div className="bg-black/70 backdrop-blur-md text-white/90 text-xs px-3 py-1.5 rounded-lg border border-white/10 font-mono flex items-center gap-2">
          {mode === 'orbit' && <><MousePointer className="w-3 h-3" /> Orbit Mode</>}
          {mode === 'walkthrough' && <><Footprints className="w-3 h-3" /> Walk-Through Mode</>}
          {mode === 'measure' && <><Ruler className="w-3 h-3" /> Measure Mode</>}
        </div>
      </div>

      {/* ── Top-Right: Toolbar ─────────────────────────────────────────────── */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        {/* Mode Buttons */}
        <ToolbarButton
          icon={<MousePointer className="w-3.5 h-3.5" />}
          label="Orbit"
          active={mode === 'orbit'}
          onClick={() => setMode('orbit')}
        />
        <ToolbarButton
          icon={<Footprints className="w-3.5 h-3.5" />}
          label="Walk"
          active={mode === 'walkthrough'}
          onClick={() => setMode('walkthrough')}
        />
        <ToolbarButton
          icon={<Ruler className="w-3.5 h-3.5" />}
          label="Measure"
          active={mode === 'measure'}
          onClick={() => setMode('measure')}
        />

        <div className="border-t border-white/10 my-1" />

        {/* Actions */}
        <ToolbarButton
          icon={<Camera className="w-3.5 h-3.5" />}
          label="Snapshot"
          onClick={handleSnapshot}
        />
        <ToolbarButton
          icon={<RotateCcw className="w-3.5 h-3.5" />}
          label="Reset"
          onClick={handleReset}
        />
        <ToolbarButton
          icon={<Info className="w-3.5 h-3.5" />}
          label="Help"
          active={showHelp}
          onClick={() => setShowHelp(!showHelp)}
        />
      </div>

      {/* ── Bottom-Left: Point Size Controls ───────────────────────────────── */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
        <div className="bg-black/70 backdrop-blur-md rounded-lg border border-white/10 flex items-center px-2 py-1 gap-1">
          <span className="text-[10px] text-white/50 font-mono mr-1">Size</span>
          <button
            onClick={() => setPointSize(prev => Math.max(0.001, (prev || 0.01) / 1.5))}
            className="text-white/60 hover:text-white p-0.5 transition-colors"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-[10px] text-white/70 font-mono w-10 text-center">
            {pointSize > 0 ? pointSize.toFixed(3) : 'Auto'}
          </span>
          <button
            onClick={() => setPointSize(prev => Math.min(0.1, (prev || 0.01) * 1.5))}
            className="text-white/60 hover:text-white p-0.5 transition-colors"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
          <button
            onClick={() => setPointSize(0)}
            className="text-white/40 hover:text-white p-0.5 ml-1 transition-colors text-[9px] font-mono"
          >
            Auto
          </button>
        </div>
      </div>

      {/* ── Bottom-Center: Context Help ────────────────────────────────────── */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10">
        <div className="bg-black/70 backdrop-blur-md text-white/70 text-[10px] px-3 py-1.5 rounded-lg border border-white/10 font-mono">
          {mode === 'orbit' && 'Left: Rotate  |  Right: Pan  |  Scroll: Zoom'}
          {mode === 'walkthrough' && 'Click to lock  |  WASD: Move  |  Space/Shift: Up/Down  |  ESC: Unlock'}
          {mode === 'measure' && 'Click two points to measure distance'}
        </div>
      </div>

      {/* ── Measurement Result ─────────────────────────────────────────────── */}
      {measuredDistance !== null && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10">
          <div className="bg-emerald-500/20 backdrop-blur-md text-emerald-300 text-sm px-4 py-2 rounded-lg border border-emerald-500/30 font-mono flex items-center gap-2">
            <Ruler className="w-4 h-4" />
            Distance: {measuredDistance.toFixed(4)} units
            <button
              onClick={() => { setMeasuredDistance(null); }}
              className="ml-2 text-emerald-400/60 hover:text-emerald-300 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* ── Help Panel ─────────────────────────────────────────────────────── */}
      {showHelp && (
        <div className="absolute top-14 right-3 z-20 w-64">
          <div className="bg-black/90 backdrop-blur-md border border-white/10 rounded-xl p-4 text-xs text-white/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white text-sm">Viewer Controls</span>
              <button onClick={() => setShowHelp(false)} className="text-white/40 hover:text-white">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="space-y-2">
              <HelpItem icon={<MousePointer className="w-3 h-3" />} title="Orbit Mode">
                Left-click drag to rotate. Right-click drag to pan. Scroll to zoom.
              </HelpItem>
              <HelpItem icon={<Footprints className="w-3 h-3" />} title="Walk-Through">
                Click to lock cursor. WASD to move. Mouse to look. Space/Shift for up/down. ESC to unlock.
              </HelpItem>
              <HelpItem icon={<Ruler className="w-3 h-3" />} title="Measure">
                Click on two points in the model to measure distance between them.
              </HelpItem>
              <HelpItem icon={<Camera className="w-3 h-3" />} title="Snapshot">
                Captures the current view as a PNG image and downloads it.
              </HelpItem>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Toolbar Button ───────────────────────────────────────────────────────────

function ToolbarButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono transition-all duration-150 border ${
        active
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
          : 'bg-black/70 text-white/60 border-white/10 hover:text-white hover:bg-black/90'
      } backdrop-blur-md`}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ── Help Item ────────────────────────────────────────────────────────────────

function HelpItem({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-white/90 font-medium mb-0.5">
        {icon}
        {title}
      </div>
      <p className="text-white/50 leading-relaxed pl-5">{children}</p>
    </div>
  );
}
