import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface Viewer3DProps {
  modelUrl: string | null;
}

// Spherical Harmonics constant for converting to RGB
const SH_C0 = 0.28209479177387814;

// Default point size for dense point clouds
const DEFAULT_POINT_SIZE = 0.005;

function PointCloud({ url }: { url: string }) {
  const meshRef = useRef<THREE.Points | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;

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
            
            // Compute bounding box to get center
            geometry.computeBoundingBox();
            const boundingBox = geometry.boundingBox;
            
            if (boundingBox) {
              // Calculate center
              const center = new THREE.Vector3();
              boundingBox.getCenter(center);
              
              // Translate geometry so center is at origin (0,0,0)
              geometry.translate(-center.x, -center.y, -center.z);
              
              // Move model up so bottom is at Y=0
              const minY = boundingBox.min.y - center.y;
              geometry.translate(0, -minY, 0);
            }
            
            geometry.computeBoundingSphere();

            const material = new THREE.PointsMaterial({
              size: DEFAULT_POINT_SIZE,
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
        } catch (err: any) {
          console.error('PLY parse error:', err);
          setError(err.message || 'Failed to parse PLY');
        }
      })
      .catch(err => {
        console.error('Fetch error:', err);
        setError('Failed to load model: ' + err.message);
      });
  }, [url]);

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
    <>
      <points ref={meshRef}>
        <bufferGeometry />
        <pointsMaterial size={DEFAULT_POINT_SIZE} vertexColors sizeAttenuation />
      </points>
    </>
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
  const properties: { name: string; type: string }[] = [];

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
      // property <type> <name>
      properties.push({ type: parts[1], name: parts[2] });
    }
  }

  if (vertexCount === 0) {
    throw new Error('No vertices in PLY file');
  }

  const propNames = properties.map(p => p.name);
  console.log(`PLY: ${vertexCount} vertices, binary=${isBinary}, properties:`, propNames.slice(0, 15));

  const positions: number[] = [];
  const colors: number[] = [];

  // Find property indices
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

  if (isBinary) {
    // Binary PLY parsing for Gaussian Splatting format
    const dataView = new DataView(buffer, headerEnd);
    
    // Calculate byte offset for each property (assuming all floats for GS format)
    const propOffsets: number[] = [];
    let currentOffset = 0;
    for (const prop of properties) {
      propOffsets.push(currentOffset);
      // GS format uses floats for everything
      if (prop.type === 'float' || prop.type === 'float32') {
        currentOffset += 4;
      } else if (prop.type === 'double' || prop.type === 'float64') {
        currentOffset += 8;
      } else if (prop.type === 'uchar' || prop.type === 'uint8') {
        currentOffset += 1;
      } else if (prop.type === 'int' || prop.type === 'int32') {
        currentOffset += 4;
      } else {
        currentOffset += 4; // Default to float
      }
    }
    const bytesPerVertex = currentOffset;
    
    console.log(`Bytes per vertex: ${bytesPerVertex}, property offsets:`, propOffsets.slice(0, 10));
    
    for (let i = 0; i < vertexCount; i++) {
      const vertexOffset = i * bytesPerVertex;
      
      // Position
      const x = dataView.getFloat32(vertexOffset + propOffsets[xIdx], isLittleEndian);
      const y = dataView.getFloat32(vertexOffset + propOffsets[yIdx], isLittleEndian);
      const z = dataView.getFloat32(vertexOffset + propOffsets[zIdx], isLittleEndian);
      
      // Skip invalid positions
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      
      // Check opacity if available (skip very transparent points)
      if (opacityIdx !== -1) {
        const opacity = dataView.getFloat32(vertexOffset + propOffsets[opacityIdx], isLittleEndian);
        // Sigmoid activation for opacity
        const alpha = 1 / (1 + Math.exp(-opacity));
        if (alpha < 0.1) continue; // Skip nearly invisible points
      }
      
      positions.push(x, y, z);
      
      // Color from spherical harmonics (f_dc_0, f_dc_1, f_dc_2)
      if (f_dc_0_idx !== -1) {
        const f_dc_0 = dataView.getFloat32(vertexOffset + propOffsets[f_dc_0_idx], isLittleEndian);
        const f_dc_1 = dataView.getFloat32(vertexOffset + propOffsets[f_dc_1_idx], isLittleEndian);
        const f_dc_2 = dataView.getFloat32(vertexOffset + propOffsets[f_dc_2_idx], isLittleEndian);
        
        // Convert SH DC to RGB: color = SH_C0 * f_dc + 0.5
        const r = Math.max(0, Math.min(1, SH_C0 * f_dc_0 + 0.5));
        const g = Math.max(0, Math.min(1, SH_C0 * f_dc_1 + 0.5));
        const b = Math.max(0, Math.min(1, SH_C0 * f_dc_2 + 0.5));
        colors.push(r, g, b);
      } else if (redIdx !== -1) {
        // Standard RGB colors
        const propType = properties[redIdx].type;
        if (propType === 'uchar' || propType === 'uint8') {
          const r = dataView.getUint8(vertexOffset + propOffsets[redIdx]) / 255;
          const g = dataView.getUint8(vertexOffset + propOffsets[greenIdx]) / 255;
          const b = dataView.getUint8(vertexOffset + propOffsets[blueIdx]) / 255;
          colors.push(r, g, b);
        } else {
          const r = dataView.getFloat32(vertexOffset + propOffsets[redIdx], isLittleEndian);
          const g = dataView.getFloat32(vertexOffset + propOffsets[greenIdx], isLittleEndian);
          const b = dataView.getFloat32(vertexOffset + propOffsets[blueIdx], isLittleEndian);
          colors.push(Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b)));
        }
      } else {
        // Default gray
        colors.push(0.6, 0.6, 0.6);
      }
    }
  } else {
    // ASCII PLY parsing
    const dataText = decoder.decode(bytes.slice(headerEnd));
    const dataLines = dataText.split('\n').filter(l => l.trim());
    
    for (let i = 0; i < Math.min(vertexCount, dataLines.length); i++) {
      const parts = dataLines[i].trim().split(/\s+/).map(parseFloat);
      
      const x = parts[xIdx];
      const y = parts[yIdx];
      const z = parts[zIdx];
      
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      
      positions.push(x, y, z);
      
      if (f_dc_0_idx !== -1) {
        const r = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_0_idx] + 0.5));
        const g = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_1_idx] + 0.5));
        const b = Math.max(0, Math.min(1, SH_C0 * parts[f_dc_2_idx] + 0.5));
        colors.push(r, g, b);
      } else if (redIdx !== -1) {
        colors.push(parts[redIdx] / 255, parts[greenIdx] / 255, parts[blueIdx] / 255);
      } else {
        colors.push(0.6, 0.6, 0.6);
      }
    }
  }

  console.log(`Parsed ${positions.length / 3} visible points (filtered from ${vertexCount})`);
  return { positions, colors, vertexCount: positions.length / 3 };
}

export default function Viewer3D({ modelUrl }: Viewer3DProps) {
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
      <div className="viewer-container">
        <Canvas camera={{ position: [3, 3, 3], fov: 50 }}>
          <ambientLight intensity={1.0} />
          <PointCloud url={fullUrl} />
          <OrbitControls 
            enableDamping 
            dampingFactor={0.05} 
            rotateSpeed={0.5}
            zoomSpeed={0.8}
            target={[0, 0, 0]}
          />
          <gridHelper args={[10, 10, '#444444', '#333333']} position={[0, 0, 0]} />
          <axesHelper args={[1]} />
        </Canvas>
      </div>
    </div>
  );
}
