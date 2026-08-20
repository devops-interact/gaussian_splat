import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
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
import { MEASURE_HOVER_MIN_MS, MEASURE_PREVIEW_MOVE_EPS } from '../constants';
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

  useEffect(() => {
    const ctx = viewerRef.current;
    if (!ctx || loadPhase !== 'ready') return;

    if (!overlayRef.current) {
      overlayRef.current = new MeasureOverlay(ctx.utilityLayer);
    }
    overlayRef.current.setWorldUnit(worldUnitRef.current ?? 0.024);
    overlayRef.current.update(visibleMeasurePoints);

    return () => {
      overlayRef.current?.dispose();
      overlayRef.current = null;
    };
  }, [visibleMeasurePoints, loadPhase, viewerRef, worldUnitRef]);

  useEffect(() => {
    if (mode !== 'measure') {
      onPickHint(MEASURE_PICK_HINT_IDLE);
      return;
    }

    const ctx = viewerRef.current;
    const canvas = canvasRef.current;
    if (loadPhase !== 'ready' || !ctx || !canvas) return;

    const { scene, utilityLayer, rootMesh } = ctx;
    const camera = scene.activeCamera;
    if (!camera || !rootMesh) return;

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

      return pickMeshMeasure(scene, mouseX, mouseY, rootMesh);
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
        if (pick?.isSnapped) onAddPoint(pick.position);
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
      if (!pick?.isSnapped || !previousWorld || visible.length !== 1) return null;
      const raw = Vector3.Distance(previousWorld, pick.position);
      if (pickCtx.measurePhase === 'measure' && pickCtx.calibration) {
        return `A→B: ${(raw * pickCtx.calibration.scaleFactor).toFixed(3)} m`;
      }
      return `A→B: ${raw.toFixed(2)} u`;
    };

    let lastHoverMs = 0;
    const lastPreviewWorld = new Vector3();
    let hasLastPreviewWorld = false;
    let pendingHint: string | null = null;
    let hintDirty = false;

    const flushHint = () => {
      if (pendingHint !== null) {
        onPickHint(pendingHint);
        pendingHint = null;
      }
      hintDirty = false;
    };

    const scheduleHint = (hint: string) => {
      pendingHint = hint;
      hintDirty = true;
    };

    const beforeRender = () => {
      if (hintDirty) flushHint();
    };
    scene.onBeforeRenderObservable.add(beforeRender);

    const onMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastHoverMs < MEASURE_HOVER_MIN_MS) return;
      lastHoverMs = now;
      try {
        const pick = pickWorldFromEvent(e);
        const pickCtx = measurePickCtxRef.current;
        const visible = pickCtx.measurePhase === 'calibrate' ? pickCtx.calibPoints : pickCtx.measurePoints;
        const previousWorld = visible.length > 0 ? visible[visible.length - 1].position : null;
        const segmentText = buildSegmentText(pick, previousWorld);

        if (pick && hasLastPreviewWorld && Vector3.Distance(lastPreviewWorld, pick.position) < MEASURE_PREVIEW_MOVE_EPS) {
          scheduleHint(
            buildMeasurePickHint(pickCtx.measurePhase, pickCtx.calibPoints.length, pickCtx.measurePoints.length, pick, segmentText),
          );
          return;
        }
        if (pick) {
          lastPreviewWorld.copyFrom(pick.position);
          hasLastPreviewWorld = true;
          gizmo.update(pick, camera.position, previousWorld);
        } else {
          hasLastPreviewWorld = false;
          gizmo.hide();
        }
        scheduleHint(
          buildMeasurePickHint(pickCtx.measurePhase, pickCtx.calibPoints.length, pickCtx.measurePoints.length, pick, segmentText),
        );
      } catch {
        gizmo.hide();
        scheduleHint(MEASURE_PICK_HINT_IDLE);
        hasLastPreviewWorld = false;
      }
    };

    const onLeave = () => {
      hasLastPreviewWorld = false;
      gizmo.hide();
      scheduleHint(MEASURE_PICK_HINT_IDLE);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      scene.onBeforeRenderObservable.removeCallback(beforeRender);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKeyDown);
      gizmo.dispose();
    };
  }, [
    mode,
    measurePhase,
    calibration,
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

export function useMeasureActions(
  measurePhase: MeasurePhase,
  calibPoints: MeasurePoint[],
  meterInput: string,
  setCalibPoints: Dispatch<SetStateAction<MeasurePoint[]>>,
  setMeasurePoints: Dispatch<SetStateAction<MeasurePoint[]>>,
  setCalibration: Dispatch<SetStateAction<CalibrationState | null>>,
  setMeasurePhase: Dispatch<SetStateAction<MeasurePhase>>,
  setMeasuredDistance: Dispatch<SetStateAction<number | null>>,
  setMeterInput: Dispatch<SetStateAction<string>>,
) {
  const handleAddMeasurePoint = useCallback(
    (point: Vector3) => {
      if (measurePhase === 'calibrate') {
        setCalibPoints((prev) => {
          if (prev.length >= 2) return [{ position: point.clone() }];
          return [...prev, { position: point.clone() }];
        });
      } else {
        setMeasurePoints((prev) => {
          const next = prev.length >= 2 ? [{ position: point.clone() }] : [...prev, { position: point.clone() }];
          return next;
        });
      }
    },
    [measurePhase, setCalibPoints, setMeasurePoints],
  );

  const handleUndoLastPoint = useCallback(() => {
    if (measurePhase === 'calibrate') {
      setCalibPoints((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
    } else {
      setMeasurePoints((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
      setMeasuredDistance(null);
    }
  }, [measurePhase, setCalibPoints, setMeasurePoints, setMeasuredDistance]);

  const handleConfirmCalibration = useCallback(() => {
    if (calibPoints.length !== 2) return;
    const rawDist = Vector3.Distance(calibPoints[0].position, calibPoints[1].position);
    const meters = parseFloat(meterInput) || 1.0;
    const scale = meters / rawDist;
    setCalibration({ points: calibPoints, rawDistance: rawDist, realMeters: meters, scaleFactor: scale });
    setMeasurePhase('measure');
    setMeasurePoints([]);
    setMeasuredDistance(null);
  }, [calibPoints, meterInput, setCalibration, setMeasurePhase, setMeasurePoints, setMeasuredDistance]);

  const handleResetCalibration = useCallback(() => {
    setCalibration(null);
    setCalibPoints([]);
    setMeasurePhase('calibrate');
    setMeasurePoints([]);
    setMeasuredDistance(null);
    setMeterInput('1.0');
  }, [setCalibration, setCalibPoints, setMeasurePhase, setMeasurePoints, setMeasuredDistance, setMeterInput]);

  const handleClearMeasure = useCallback(() => {
    setMeasurePoints([]);
    setMeasuredDistance(null);
  }, [setMeasurePoints, setMeasuredDistance]);

  return {
    handleAddMeasurePoint,
    handleUndoLastPoint,
    handleConfirmCalibration,
    handleResetCalibration,
    handleClearMeasure,
  };
}
