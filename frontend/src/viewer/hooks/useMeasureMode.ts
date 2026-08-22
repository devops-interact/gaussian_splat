import { useEffect, useRef, type RefObject } from 'react';
import { Vector3 } from '@babylonjs/core';
import { pickMeshMeasure } from '@/lib/meshPick';
import type { PickResult } from '@/lib/meshPick';
import type {
  BabylonViewerCtx,
  CalibrationState,
  LoadPhase,
  MeasurePhase,
  MeasurePoint,
  ModelMetadata,
  ViewerMode,
} from '../types';
import { MeasurePreviewGizmo } from '../measure/MeasurePreviewGizmo';
import { MeasureOverlay } from '../measure/MeasureOverlay';
import { buildMeasurePickHint } from '../measure/measureHint';
import { MEASURE_PICK_HINT_IDLE } from '../measure/colors';

export interface UseMeasureModeOptions {
  viewerRef: RefObject<BabylonViewerCtx | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  mode: ViewerMode;
  loadPhase: LoadPhase;
  measurePhase: MeasurePhase;
  calibPoints: MeasurePoint[];
  measurePoints: MeasurePoint[];
  calibration: CalibrationState | null;
  visibleMeasurePoints: MeasurePoint[];
  metadataRef: RefObject<ModelMetadata | null>;
  sceneScaleRef: RefObject<number>;
  worldUnitRef: RefObject<number>;
  pickDebugEnabled: boolean;
  onPickHint: (hint: string) => void;
  onAddPoint: (point: Vector3) => void;
  onUndoPoint: () => void;
}

export function useMeasureMode(opts: UseMeasureModeOptions): void {
  const {
    viewerRef,
    canvasRef,
    mode,
    loadPhase,
    measurePhase,
    calibPoints,
    measurePoints,
    calibration,
    visibleMeasurePoints,
    metadataRef,
    sceneScaleRef,
    worldUnitRef,
    pickDebugEnabled,
    onPickHint,
    onAddPoint,
    onUndoPoint,
  } = opts;

  const measurePickCtxRef = useRef({ measurePhase, calibPoints, measurePoints, calibration });
  measurePickCtxRef.current = { measurePhase, calibPoints, measurePoints, calibration };

  const overlayRef = useRef<MeasureOverlay | null>(null);
  const overlaySceneRef = useRef<unknown>(null);

  // Create overlay once per utility layer scene; dispose only when scene tears down.
  useEffect(() => {
    const ctx = viewerRef.current;
    if (!ctx || loadPhase !== 'ready') return;

    const utilityScene = ctx.utilityLayer.utilityLayerScene;
    if (overlaySceneRef.current !== utilityScene) {
      overlayRef.current?.dispose();
      overlayRef.current = new MeasureOverlay(ctx.utilityLayer);
      overlaySceneRef.current = utilityScene;
    }

    return () => {
      overlayRef.current?.dispose();
      overlayRef.current = null;
      overlaySceneRef.current = null;
    };
  }, [loadPhase, viewerRef]);

  useEffect(() => {
    if (!overlayRef.current || loadPhase !== 'ready') return;
    overlayRef.current.setWorldUnit(worldUnitRef.current ?? 0.024);
    overlayRef.current.update(visibleMeasurePoints);
  }, [visibleMeasurePoints, worldUnitRef, loadPhase]);

  useEffect(() => {
    if (mode !== 'measure') {
      onPickHint(MEASURE_PICK_HINT_IDLE);
      return;
    }

    const ctx = viewerRef.current;
    const canvas = canvasRef.current;
    if (loadPhase !== 'ready' || !ctx || !canvas) return;

    const { scene, utilityLayer } = ctx;
    const camera = scene.activeCamera;
    if (!camera) return;

    const pickWorldFromEvent = (e: MouseEvent): PickResult | null => {
      const pickW = canvas.width;
      const pickH = canvas.height;
      const rect = canvas.getBoundingClientRect();
      let mouseX: number;
      let mouseY: number;
      if (rect.width > 0 && rect.height > 0) {
        mouseX = ((e.clientX - rect.left) / rect.width) * pickW;
        mouseY = ((e.clientY - rect.top) / rect.height) * pickH;
      } else {
        const cw = Math.max(1, canvas.clientWidth);
        const ch = Math.max(1, canvas.clientHeight);
        mouseX = (e.offsetX / cw) * pickW;
        mouseY = (e.offsetY / ch) * pickH;
      }
      mouseX = Math.max(0, Math.min(pickW, mouseX));
      mouseY = Math.max(0, Math.min(pickH, mouseY));

      return pickMeshMeasure(scene, mouseX, mouseY);
    };

    const gizmo = new MeasurePreviewGizmo(utilityLayer, worldUnitRef.current ?? 0.024);
    const CLICK_DRAG_MAX_PX_SQ = 5 * 5;
    const downPos = { x: 0, y: 0 };
    const onPointerDown = (e: PointerEvent) => {
      downPos.x = e.clientX;
      downPos.y = e.clientY;
    };
    const draggedSincePointerDown = (e: MouseEvent): boolean => {
      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      return dx * dx + dy * dy > CLICK_DRAG_MAX_PX_SQ;
    };

    const onClick = (e: MouseEvent) => {
      if (draggedSincePointerDown(e)) return;
      try {
        const pick = pickWorldFromEvent(e);
        if (pick) onAddPoint(pick.position);
      } catch (err) {
        console.warn('[Babylon] Measure pick failed:', err);
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (draggedSincePointerDown(e)) return;
      onUndoPoint();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onUndoPoint();
    };

    const buildSegmentText = (pick: PickResult | null, previousWorld: Vector3 | null): string | null => {
      const pickCtx = measurePickCtxRef.current;
      const visible = pickCtx.measurePhase === 'calibrate' ? pickCtx.calibPoints : pickCtx.measurePoints;
      if (!pick || !previousWorld || visible.length !== 1) return null;
      const raw = Vector3.Distance(previousWorld, pick.position);
      if (pickCtx.measurePhase === 'measure' && pickCtx.calibration) {
        return `A→B: ${(raw * pickCtx.calibration.scaleFactor).toFixed(3)} m`;
      }
      return `A→B: ${raw.toFixed(2)} u`;
    };

    let pendingMouse: MouseEvent | null = null;
    let rafId = 0;
    let pointerInside = true;

    const processHover = (e: MouseEvent) => {
      try {
        const pick = pickWorldFromEvent(e);
        const pickCtx = measurePickCtxRef.current;
        const visible = pickCtx.measurePhase === 'calibrate' ? pickCtx.calibPoints : pickCtx.measurePoints;
        const previousWorld = visible.length > 0 ? visible[visible.length - 1].position : null;
        const segmentText = buildSegmentText(pick, previousWorld);

        if (pick) {
          gizmo.update(pick, camera.position, previousWorld);
        } else {
          gizmo.hide();
        }
        onPickHint(
          buildMeasurePickHint(pickCtx.measurePhase, pickCtx.calibPoints.length, pickCtx.measurePoints.length, pick, segmentText),
        );
      } catch {
        gizmo.hide();
        onPickHint(MEASURE_PICK_HINT_IDLE);
      }
    };

    const hoverLoop = () => {
      rafId = 0;
      if (pendingMouse && pointerInside) {
        processHover(pendingMouse);
      }
    };

    const onMove = (e: MouseEvent) => {
      pendingMouse = e;
      if (!rafId) {
        rafId = requestAnimationFrame(hoverLoop);
      }
    };

    const onLeave = () => {
      pointerInside = false;
      pendingMouse = null;
      gizmo.hide();
      onPickHint(MEASURE_PICK_HINT_IDLE);
    };

    const onEnter = () => {
      pointerInside = true;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointerenter', onEnter);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerenter', onEnter);
      window.removeEventListener('keydown', onKeyDown);
      gizmo.dispose();
    };
  }, [
    mode,
    loadPhase,
    pickDebugEnabled,
    viewerRef,
    canvasRef,
    metadataRef,
    sceneScaleRef,
    worldUnitRef,
    onPickHint,
    onAddPoint,
    onUndoPoint,
  ]);
}
