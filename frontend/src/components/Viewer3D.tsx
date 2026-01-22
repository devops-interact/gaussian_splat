import { useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface Viewer3DProps {
  modelUrl: string | null;
}

function PLYLoader({ url }: { url: string }) {
  const meshRef = useRef<THREE.Points | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;

    const loader = new THREE.FileLoader();
    loader.load(
      url,
      (data) => {
        try {
          const points = parsePLY(data as string);
          if (meshRef.current) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.positions, 3));
            if (points.colors) {
              geometry.setAttribute('color', new THREE.Float32BufferAttribute(points.colors, 3));
            }
            geometry.computeBoundingSphere();

            const material = new THREE.PointsMaterial({
              size: 0.01,
              vertexColors: points.colors ? true : false,
              color: points.colors ? 0xffffff : 0x00ff00,
            });

            if (meshRef.current) {
              meshRef.current.geometry.dispose();
              if (meshRef.current.material instanceof THREE.Material) {
                meshRef.current.material.dispose();
              }
            }

            meshRef.current.geometry = geometry;
            meshRef.current.material = material;
            setLoaded(true);
          }
        } catch (err: any) {
          setError(err.message || 'Failed to parse PLY file');
        }
      },
      undefined,
      (err) => {
        setError('Failed to load model: ' + err);
      }
    );
  }, [url]);

  if (error) {
    return (
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="red" />
      </mesh>
    );
  }

  return (
    <points ref={meshRef}>
      <boxGeometry args={[0.1, 0.1, 0.1]} />
      <pointsMaterial size={0.01} color={0x00ff00} />
    </points>
  );
}

function parsePLY(data: string): { positions: number[]; colors?: number[] } {
  const lines = data.split('\n');
  let headerEnd = -1;
  let vertexCount = 0;
  let hasColors = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('element vertex')) {
      vertexCount = parseInt(line.split(/\s+/)[2]);
    }
    if (line.includes('red') || line.includes('green') || line.includes('blue')) {
      hasColors = true;
    }
    if (line === 'end_header') {
      headerEnd = i;
      break;
    }
  }

  if (headerEnd === -1 || vertexCount === 0) {
    throw new Error('Invalid PLY file format');
  }

  const positions: number[] = [];
  const colors: number[] = [];

  for (let i = headerEnd + 1; i < lines.length && positions.length < vertexCount * 3; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      positions.push(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
      
      if (hasColors && parts.length >= 6) {
        const r = parseInt(parts[3]) / 255;
        const g = parseInt(parts[4]) / 255;
        const b = parseInt(parts[5]) / 255;
        colors.push(r, g, b);
      }
    }
  }

  return { positions, colors: hasColors ? colors : undefined };
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
        <Canvas camera={{ position: [0, 0, 5], fov: 75 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} />
          <PLYLoader url={fullUrl} />
          <OrbitControls enableDamping dampingFactor={0.05} />
          <gridHelper args={[10, 10]} />
        </Canvas>
      </div>
    </div>
  );
}
