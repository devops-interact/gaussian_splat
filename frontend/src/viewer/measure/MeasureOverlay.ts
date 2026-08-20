import { MeshBuilder, Vector3 } from '@babylonjs/core';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer';
import type { MeasurePoint } from '../types';
import { MEASURE_PLACED_A, MEASURE_PLACED_B, MEASURE_PLACED_LINE, makeOverlayMaterial } from './colors';

/** Pooled placed-point markers on the utility layer. */
export class MeasureOverlay {
  private readonly utilityLayer: UtilityLayerRenderer;
  private readonly spheres: Mesh[] = [];
  private readonly mats: ReturnType<typeof makeOverlayMaterial>[] = [];
  private line: LinesMesh | null = null;
  private worldUnit = 0.024;

  constructor(utilityLayer: UtilityLayerRenderer) {
    this.utilityLayer = utilityLayer;
  }

  setWorldUnit(u: number): void {
    this.worldUnit = u;
  }

  update(points: MeasurePoint[]): void {
    const scene = this.utilityLayer.utilityLayerScene;
    while (this.spheres.length < points.length) {
      const i = this.spheres.length;
      const color = i === 0 ? MEASURE_PLACED_A : MEASURE_PLACED_B;
      const mat = makeOverlayMaterial(scene, color, 1);
      const sphere = MeshBuilder.CreateSphere(`measurePt${i}`, { diameter: 1, segments: 12 }, scene);
      sphere.material = mat;
      sphere.isPickable = false;
      this.spheres.push(sphere);
      this.mats.push(mat);
    }
    for (let i = 0; i < this.spheres.length; i++) {
      const sphere = this.spheres[i];
      if (i < points.length) {
        sphere.scaling.setAll(this.worldUnit);
        sphere.position.copyFrom(points[i].position);
        sphere.setEnabled(true);
      } else {
        sphere.setEnabled(false);
      }
    }

    if (points.length === 2) {
      const pts = points.map((p) => p.position);
      if (!this.line) {
        this.line = MeshBuilder.CreateLines('measureLine', { points: pts, updatable: true }, scene);
        this.line.color = MEASURE_PLACED_LINE;
        this.line.isPickable = false;
      } else {
        MeshBuilder.CreateLines('measureLine', { points: pts, instance: this.line });
        this.line.setEnabled(true);
      }
    } else if (this.line) {
      this.line.setEnabled(false);
    }
  }

  dispose(): void {
    for (const s of this.spheres) s.dispose(false, false);
    this.line?.dispose(false, false);
    for (const m of this.mats) m.dispose();
    this.spheres.length = 0;
    this.mats.length = 0;
    this.line = null;
  }
}

export { Vector3 };
