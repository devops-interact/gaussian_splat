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

const OVERLAY_RENDER_GROUP = 2;
const SCRATCH_TO_CAMERA = new Vector3();
const SCRATCH_RIGHT = new Vector3();
const SCRATCH_LOCAL_UP = new Vector3();
const SCRATCH_OFFSET = new Vector3();
const SCRATCH_DISPLAY = new Vector3();
const WORLD_UP = Vector3.Up();

export interface MeasurePreviewGizmoOptions {
  worldUnit: number;
  effectiveDiagonal: number;
}

/**
 * Persistent hover-preview gizmo on the utility layer.
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
  private readonly worldUnit: number;
  private readonly effectiveDiagonal: number;
  private readonly linePts: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private readonly dashPts: [Vector3, Vector3] = [new Vector3(), new Vector3()];
  private disposed = false;

  constructor(utilityLayer: UtilityLayerRenderer, opts: MeasurePreviewGizmoOptions) {
    const { worldUnit, effectiveDiagonal } = opts;
    this.worldUnit = worldUnit;
    this.effectiveDiagonal = effectiveDiagonal;

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
      mesh.renderingGroupId = OVERLAY_RENDER_GROUP;
      mesh.setEnabled(false);
    }
  }

  private computeScale(camDist: number, isSnapped: boolean): number {
    const scaleBase = Math.max(
      this.worldUnit * 2,
      this.effectiveDiagonal * 0.004,
      camDist * 0.012,
      0.01,
    );
    return isSnapped ? scaleBase * 1.2 : scaleBase;
  }

  private displayPosition(pick: PickResult): Vector3 {
    SCRATCH_DISPLAY.copyFrom(pick.position);
    if (pick.normal) {
      const offset = Math.max(this.worldUnit * 0.35, this.effectiveDiagonal * 0.0008);
      SCRATCH_DISPLAY.addInPlace(pick.normal.scale(offset));
    }
    return SCRATCH_DISPLAY;
  }

  update(pick: PickResult, cameraPosition: Vector3, previousWorld: Vector3 | null): void {
    if (this.disposed) return;
    const { isSnapped } = pick;
    const position = this.displayPosition(pick);
    const mat = isSnapped ? this.snappedMat : this.unsnappedMat;
    const lineColor = isSnapped ? MEASURE_PREVIEW_YELLOW_LINES : MEASURE_PREVIEW_RED;
    const camDist = Vector3.Distance(cameraPosition, position);
    const scale = this.computeScale(camDist, isSnapped);

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

    SCRATCH_RIGHT.scaleToRef(-halfLen, SCRATCH_OFFSET);
    this.linePts[0].copyFrom(position).addInPlace(SCRATCH_OFFSET);
    SCRATCH_RIGHT.scaleToRef(halfLen, SCRATCH_OFFSET);
    this.linePts[1].copyFrom(position).addInPlace(SCRATCH_OFFSET);
    MeshBuilder.CreateLines('measureH', { points: this.linePts, instance: this.hLine });
    this.hLine.color = lineColor;
    this.hLine.setEnabled(true);

    SCRATCH_LOCAL_UP.scaleToRef(-halfLen, SCRATCH_OFFSET);
    this.linePts[0].copyFrom(position).addInPlace(SCRATCH_OFFSET);
    SCRATCH_LOCAL_UP.scaleToRef(halfLen, SCRATCH_OFFSET);
    this.linePts[1].copyFrom(position).addInPlace(SCRATCH_OFFSET);
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
