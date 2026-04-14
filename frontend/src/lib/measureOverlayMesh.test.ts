import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildMeasureOverlayFromCenters,
  pickMeshSurface,
  voxelDownsampleCenters,
  MEASURE_OVERLAY_VOXEL_TARGET,
} from './measureOverlayMesh';

describe('measureOverlayMesh', () => {
  it('voxelDownsampleCenters reduces dense grid', () => {
    const pts: number[] = [];
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        for (let z = 0; z < 20; z++) {
          pts.push(x * 0.1, y * 0.1, z * 0.1);
        }
      }
    }
    const buf = new Float32Array(pts);
    const down = voxelDownsampleCenters(buf, MEASURE_OVERLAY_VOXEL_TARGET);
    expect(down.length / 3).toBeLessThan(buf.length / 3);
    expect(down.length / 3).toBeGreaterThan(10);
  });

  it('buildMeasureOverlayFromCenters returns triangles for scattered cloud', () => {
    const pts: number[] = [];
    for (let i = 0; i < 80; i++) {
      pts.push(
        Math.sin(i * 0.7) * 2 + 0.01 * i,
        Math.cos(i * 0.5) * 2,
        (i % 7) * 0.15,
      );
    }
    const c = new Float32Array(pts);
    const r = buildMeasureOverlayFromCenters(c);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.geometry.index).toBeTruthy();
      expect((r.geometry.index!.count ?? 0) > 0).toBe(true);
    }
  });

  it('pickMeshSurface hits front-facing triangle', () => {
    const geom = new THREE.BufferGeometry();
    const z = 0;
    const positions = new Float32Array([
      -1, -1, z,
      1, -1, z,
      0, 1, z,
    ]);
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const renderDims = new THREE.Vector2(256, 256);
    const mousePos = new THREE.Vector2(128, 128);
    const hit = pickMeshSurface({ camera, mousePos, renderDims, mesh });
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeCloseTo(z, 2);
  });
});
