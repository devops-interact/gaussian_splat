import { MeshBuilder, Vector3 } from '@babylonjs/core';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { LinesMesh } from '@babylonjs/core/Meshes/linesMesh';
import type { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer';
import type { PickResult } from '@/lib/meshPick';
import {
  MEASURE_PREVIEW_CONNECTOR,
  MEASURE_PREVIEW_RED,
  MEASURE_PREVIEW_YELLOW,
  MEASURE_PREVIEW_YELLOW_LINES,
  makeOverlayMaterial,
} from './colors';

const SCRATCH_TO_CAMERA = new Vector3();
const SCRATCH_RIGHT = new Vector3();
const SCRATCH_LOCAL_UP = new Vector3();
const WORLD_UP = Vector3.Up();

/**
 * Persistent hover-preview gizmo on the utility layer — no depth-write hacks.
 */
export class MeasurePreviewGizmo {
  private readonly ring: Mesh;
  private readonly dot: Mesh;
  private readonly ghost: Mesh;
  private readonly hLine: LinesMesh;
  private readonly vLine: LinesMesh;
  private readonly dash: LinesMesh;
  private readonly snappedMat;
  private readonly unsnappedMat;
  private readonly linePts: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private readonly dashPts: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private disposed = false;

  constructor(utilityLayer: UtilityLayerRenderer, worldUnit: number) {
    const scene = utilityLayer.utilityLayerScene;
    this.snappedMat = makeOverlayMaterial(scene, MEASURE_PREVIEW_YELLOW, 1);
    this.unsnappedMat = makeOverlayMaterial(scene, MEASURE_PREVIEW_RED, 1);

    this.ring = MeshBuilder.CreateTorus('measureRing', { diameter: 1, thickness: 0.08, tessellation: 24 }, scene);
    this.dot = MeshBuilder.CreateSphere('measureDot', { diameter: 0.3, segments: 8 }, scene);
    this.ghost = MeshBuilder.CreateSphere('measureGhost', { diameter: 1, segments: 12 }, scene);
    this.ghost.scaling.setAll(worldUnit);
    this.ghost.material = this.snappedMat;
    this.ghost.visibility = 0.4;

    this.hLine = MeshBuilder.CreateLines('measureH', { points: [new Vector3(), new Vector3()], updatable: true }, scene);
    this.vLine = MeshBuilder.CreateLines('measureV', { points: [new Vector3(), new Vector3()], updatable: true }, scene);
    this.dash = MeshBuilder.CreateDashedLines(
      'measureDash',
      { points: [new Vector3(), new Vector3(0, worldUnit, 0)], dashSize: worldUnit * 1.9, gapSize: worldUnit * 1.25, updatable: true },
      scene,
    );
    this.dash.color = MEASURE_PREVIEW_CONNECTOR;
    this.dash.alpha = 0.55;

    for (const mesh of [this.ring, this.dot, this.ghost, this.hLine, this.vLine, this.dash]) {
      mesh.isPickable = false;
      mesh.setEnabled(false);
    }
  }

  update(pick: PickResult, cameraPosition: Vector3, previousWorld: Vector3 | null): void {
    if (this.disposed) return;
    const { position, isSnapped } = pick;
    const mat = isSnapped ? this.snappedMat : this.unsnappedMat;
    const lineColor = isSnapped ? MEASURE_PREVIEW_YELLOW_LINES : MEASURE_PREVIEW_RED;
    const camDist = Vector3.Distance(cameraPosition, position);
    const scaleBase = Math.max(0.01, camDist * 0.012);
    const scale = isSnapped ? scaleBase * 1.2 : scaleBase;

    this.ring.position.copyFrom(position);
    this.ring.scaling.setAll(scale);
    if (Vector3.DistanceSquared(cameraPosition, position) > 1e-8) {
      this.ring.lookAt(cameraPosition);
    }
    this.ring.material = mat;
    this.ring.visibility = isSnapped ? 0.75 : 0.4;
    this.ring.setEnabled(true);

    this.dot.position.copyFrom(position);
    this.dot.scaling.setAll(scale);
    this.dot.material = mat;
    this.dot.visibility = isSnapped ? 0.9 : 0.5;
    this.dot.setEnabled(true);

    const halfLen = scale * 1.2;
    SCRATCH_TO_CAMERA.copyFrom(cameraPosition).subtractInPlace(position);
    if (SCRATCH_TO_CAMERA.lengthSquared() < 1e-10) {
      this.hide();
      return;
    }
    SCRATCH_TO_CAMERA.normalize();

    const upRef = Math.abs(Vector3.Dot(SCRATCH_TO_CAMERA, WORLD_UP)) > 0.99
      ? Vector3.Right()
      : WORLD_UP;
    Vector3.CrossToRef(SCRATCH_TO_CAMERA, upRef, SCRATCH_RIGHT);
    if (SCRATCH_RIGHT.lengthSquared() < 1e-10) {
      this.hide();
      return;
    }
    SCRATCH_RIGHT.normalize();
    Vector3.CrossToRef(SCRATCH_RIGHT, SCRATCH_TO_CAMERA, SCRATCH_LOCAL_UP);
    SCRATCH_LOCAL_UP.normalize();

    this.linePts[0].copyFrom(position).addInPlace(SCRATCH_RIGHT.scale(-halfLen));
    this.linePts[1].copyFrom(position).addInPlace(SCRATCH_RIGHT.scale(halfLen));
    MeshBuilder.CreateLines('measureH', { points: this.linePts, instance: this.hLine });
    this.hLine.color = lineColor;
    this.hLine.setEnabled(true);

    this.linePts[0].copyFrom(position).addInPlace(SCRATCH_LOCAL_UP.scale(-halfLen));
    this.linePts[1].copyFrom(position).addInPlace(SCRATCH_LOCAL_UP.scale(halfLen));
    MeshBuilder.CreateLines('measureV', { points: this.linePts, instance: this.vLine });
    this.vLine.color = lineColor;
    this.vLine.alpha = isSnapped ? 0.6 : 0.3;
    this.vLine.setEnabled(true);

    this.ghost.position.copyFrom(position);
    this.ghost.setEnabled(isSnapped);

    if (isSnapped && previousWorld) {
      this.dashPts[0].copyFrom(previousWorld);
      this.dashPts[1].copyFrom(position);
      MeshBuilder.CreateDashedLines('measureDash', { points: this.dashPts, instance: this.dash });
      this.dash.setEnabled(true);
    } else {
      this.dash.setEnabled(false);
    }
  }

  hide(): void {
    if (this.disposed) return;
    for (const mesh of [this.ring, this.dot, this.ghost, this.hLine, this.vLine, this.dash]) {
      mesh.setEnabled(false);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [this.ring, this.dot, this.ghost, this.hLine, this.vLine, this.dash]) {
      mesh.dispose(false, false);
    }
    this.snappedMat.dispose();
    this.unsnappedMat.dispose();
  }
}
