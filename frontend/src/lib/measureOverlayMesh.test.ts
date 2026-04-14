import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildMeasureOverlayFromCenters,
  createMeasureOverlayWireframeMaterial,
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

  it('buildMeasureOverlayFromCenters handles oblique plane via PCA', () => {
    const nx = 1 / Math.sqrt(3);
    const ny = 1 / Math.sqrt(3);
    const nz = 1 / Math.sqrt(3);
    const ax = 0;
    const ay = 1;
    const az = 0;
    let tx = ay * nz - az * ny;
    let ty = az * nx - ax * nz;
    let tz = ax * ny - ay * nx;
    const tlen = Math.hypot(tx, ty, tz) || 1;
    tx /= tlen;
    ty /= tlen;
    tz /= tlen;
    const bx = ny * tz - nz * ty;
    const by = nz * tx - nx * tz;
    const bz = nx * ty - ny * tx;
    const pts: number[] = [];
    for (let i = 0; i < 400; i++) {
      const u = (Math.random() - 0.5) * 6;
      const v = (Math.random() - 0.5) * 6;
      const noise = (Math.random() - 0.5) * 0.02;
      pts.push(
        u * tx + v * bx + noise * nx,
        u * ty + v * by + noise * ny,
        u * tz + v * bz + noise * nz,
      );
    }
    const r = buildMeasureOverlayFromCenters(new Float32Array(pts));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.geometry.index?.count ?? 0) / 3).toBeGreaterThan(20);
    }
  });

  it('buildMeasureOverlayFromCenters falls back for isotropic ball', () => {
    const pts: number[] = [];
    for (let i = 0; i < 250; i++) {
      pts.push(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    }
    const r = buildMeasureOverlayFromCenters(new Float32Array(pts));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.geometry.index?.count ?? 0) > 0).toBe(true);
    }
  });

  it('createMeasureOverlayWireframeMaterial scales polygon offset with scene scale', () => {
    const m1 = createMeasureOverlayWireframeMaterial(1);
    const m4 = createMeasureOverlayWireframeMaterial(4);
    expect(m4.polygonOffsetFactor).toBeCloseTo(m1.polygonOffsetFactor! * 4, 5);
    expect(m4.polygonOffsetUnits).toBeCloseTo(m1.polygonOffsetUnits! * 4, 5);
    m1.dispose();
    m4.dispose();
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
