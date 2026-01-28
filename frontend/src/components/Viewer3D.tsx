import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface Viewer3DProps {
  modelUrl: string | null;
}

// Spherical Harmonics constant for converting to RGB
const SH_C0 = 0.28209479177387814;

function PointCloud({ url, pointSize }: { url: string; pointSize: number }) {
  const meshRef = useRef<THREE.Points | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;

    setLoading(true);
    setError(null);

    // Fetch as binary
    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(buffer => {
        try {
          const result = parseGaussianPLY(buffer);
          if (meshRef.current) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(result.positions, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(result.colors, 3));
            geometry.computeBoundingSphere();

            // Auto-center the model
            geometry.center();

            const material = new THREE.PointsMaterial({
              size: pointSize,
              vertexColors: true,
              sizeAttenuation: true,
            });

            meshRef.current.geometry.dispose();
            if (meshRef.current.material instanceof THREE.Material) {
              meshRef.current.material.dispose();
            }

            meshRef.current.geometry = geometry;
            meshRef.current.material = material;
          }
          setLoading(false);
        } catch (err: any) {
          console.error('PLY parse error:', err);
          setError(err.message || 'Failed to parse PLY');
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('Fetch error:', err);
        setError('Failed to load model: ' + err.message);
        setLoading(false);
      });
  }, [url, pointSize]);

  if (error) {
    return (
      <group>
        <mesh>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color="red" wireframe />
        </mesh>
      </group>
    );
  }

  return (
    <points ref={meshRef}>
      <bufferGeometry />
      <pointsMaterial size={pointSize} vertexColors sizeAttenuation />
    </points>
  );
}

interface ParseResult {
  positions: number[];
  colors: number[];
  vertexCount: number;
}

function parseGaussianPLY(buffer: ArrayBuffer): ParseResult {
  const decoder = new TextDecoder('utf-8');
  const bytes = new Uint8Array(buffer);
  
  // Find header end
  let headerEnd = -1;
  for (let i = 0; i < Math.min(bytes.length, 10000); i++) {
    if (bytes[i] === 0x65 && bytes[i+1] === 0x6e && bytes[i+2] === 0x64 && 
        bytes[i+3] === 0x5f && bytes[i+4] === 0x68 && bytes[i+5] === 0x65 &&
        bytes[i+6] === 0x61 && bytes[i+7] === 0x64 && bytes[i+8] === 0x65 &&
        bytes[i+9] === 0x72) { // "end_header"
      headerEnd = i + 10;
      // Skip newline
      while (headerEnd < bytes.length && (bytes[headerEnd] === 0x0a || bytes[headerEnd] === 0x0d)) {
        headerEnd++;
      }
      break;
    }
  }

  if (headerEnd === -1) {
    throw new Error('Invalid PLY: no end_header found');
  }

  const headerText = decoder.decode(bytes.slice(0, headerEnd));
  const headerLines = headerText.split('\n').map(l => l.trim());
  
  // Parse header
  let vertexCount = 0;
  let isBinary = false;
  let isLittleEndian = true;
  const properties: string[] = [];

  for (const line of headerLines) {
    if (line.startsWith('format binary_little_endian')) {
      isBinary = true;
      isLittleEndian = true;
    } else if (line.startsWith('format binary_big_endian')) {
      isBinary = true;
      isLittleEndian = false;
    } else if (line.startsWith('format ascii')) {
      isBinary = false;
    } else if (line.startsWith('element vertex')) {
      vertexCount = parseInt(line.split(/\s+/)[2]);
    } else if (line.startsWith('property')) {
      const parts = line.split(/\s+/);
      properties.push(parts[parts.length - 1]);
    }
  }

  if (vertexCount === 0) {
    throw new Error('No vertices in PLY file');
  }

  console.log(`PLY: ${vertexCount} vertices, binary=${isBinary}, properties:`, properties.slice(0, 10));

  const positions: number[] = [];
  const colors: number[] = [];

  if (isBinary) {
    // Binary PLY parsing for Gaussian Splatting format
    const dataView = new DataView(buffer, headerEnd);
    
    // Find property indices
    const xIdx = properties.indexOf('x');
    const yIdx = properties.indexOf('y');
    const zIdx = properties.indexOf('z');
    const f_dc_0_idx = properties.indexOf('f_dc_0');
    const f_dc_1_idx = properties.indexOf('f_dc_1');
    const f_dc_2_idx = properties.indexOf('f_dc_2');
    const redIdx = properties.indexOf('red');
    const greenIdx = properties.indexOf('green');
    const blueIdx = properties.indexOf('blue');
    
    // Calculate bytes per vertex (all floats in GS format)
    const bytesPerVertex = properties.length * 4;
    
    for (let i = 0; i < vertexCount; i++) {
      const offset = i * bytesPerVertex;
      
      // Position
      const x = dataView.getFloat32(offset + xIdx * 4, isLittleEndian);
      const y = dataView.getFloat32(offset + yIdx * 4, isLittleEndian);
      const z = dataView.getFloat32(offset + zIdx * 4, isLittleEndian);
      positions.push(x, y, z);
      
      // Color from spherical harmonics (f_dc_0, f_dc_1, f_dc_2)
      if (f_dc_0_idx !== -1) {
        const f_dc_0 = dataView.getFloat32(offset + f_dc_0_idx * 4, isLittleEndian);
        const f_dc_1 = dataView.getFloat32(offset + f_dc_1_idx * 4, isLittleEndian);
        const f_dc_2 = dataView.getFloat32(offset + f_dc_2_idx * 4, isLittleEndian);
        
        // Convert SH to RGB: color = SH_C0 * f_dc + 0.5
        const r = Math.max(0, Math.min(1, SH_C0 * f_dc_0 + 0.5));
        const g = Math.max(0, Math.min(1, SH_C0 * f_dc_1 + 0.5));
        const b = Math.max(0, Math.min(1, SH_C0 * f_dc_2 + 0.5));
        colors.push(r, g, b);
      } else if (redIdx !== -1) {
        // Standard RGB colors (0-255)
        const r = dataView.getUint8(offset + redIdx) / 255;
        const g = dataView.getUint8(offset + greenIdx) / 255;
        const b = dataView.getUint8(offset + blueIdx) / 255;
        colors.push(r, g, b);
      } else {
        colors.push(0.5, 0.5, 0.5);
      }
    }
  } else {
    // ASCII PLY parsing
    const dataText = decoder.decode(bytes.slice(headerEnd));
    const dataLines = dataText.split('\n').filter(l => l.trim());
    
    const xIdx = properties.indexOf('x');
    const yIdx = properties.indexOf('y');
    const zIdx = properties.indexOf('z');
    const f_dc_0_idx = properties.indexOf('f_dc_0');
    const f_dc_1_idx = properties.indexOf('f_dc_1');
    const f_dc_2_idx = properties.indexOf('f_dc_2');
    const redIdx = properties.indexOf('red');
    
    for (let i = 0; i < Math.min(vertexCount, dataLines.length); i++) {
      const parts = dataLines[i].trim().split(/\s+/).map(parseFloat);
      
      positions.push(parts[xIdx], parts[yIdx], parts[zIdx]);
      
      if (f_dc_0_idx !== -1) {
        const r = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_0_idx] + 0.5));
        const g = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_1_idx] + 0.5));
        const b = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_2_idx] + 0.5));
        colors.push(r, g, b);
      } else if (redIdx !== -1) {
        colors.push(parts[redIdx] / 255, parts[redIdx + 1] / 255, parts[redIdx + 2] / 255);
      } else {
        colors.push(0.5, 0.5, 0.5);
      }
    }
  }

  console.log(`Parsed ${positions.length / 3} points`);
  return { positions, colors, vertexCount };
}

export default function Viewer3D({ modelUrl }: Viewer3DProps) {
  const [pointSize, setPointSize] = useState(0.02);

  if (!modelUrl) {
    return (
      <div className="viewer-section">
        <h2>3D Preview</h2>
        <div className="viewer-container">
          <div className="viewer-placeholder">
            Upload and process a video to see the 3D reconstruction
          </div>
        </div>
      </div>
    );
  }

  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
  const fullUrl = modelUrl.startsWith('http') ? modelUrl : `${apiBase}${modelUrl}`;

  return (
    <div className="viewer-section">
      <h2>3D Preview</h2>
      <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <label style={{ fontSize: '0.85rem', color: '#888' }}>
          Point Size: 
          <input
            type="range"
            min="0.001"
            max="0.1"
            step="0.001"
            value={pointSize}
            onChange={(e) => setPointSize(parseFloat(e.target.value))}
            style={{ marginLeft: '0.5rem', width: '100px' }}
          />
          {pointSize.toFixed(3)}
        </label>
      </div>
      <div className="viewer-container">
        <Canvas camera={{ position: [2, 2, 2], fov: 60 }}>
          <ambientLight intensity={0.8} />
          <pointLight position={[10, 10, 10]} intensity={0.5} />
          <PointCloud url={fullUrl} pointSize={pointSize} />
          <OrbitControls 
            enableDamping 
            dampingFactor={0.05} 
            rotateSpeed={0.5}
            zoomSpeed={0.8}
          />
          <gridHelper args={[10, 10, '#444444', '#333333']} />
          <axesHelper args={[2]} />
        </Canvas>
      </div>
    </div>
  );
}
