import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { SceneManifestResponse } from '@/types/job';
import { refreshPickableMeshes } from '@/lib/meshPick';
import { loadViewerSettings, saveViewerSettings } from '@/lib/viewerSettings';
import type { ZoneMeshHandle } from '../load/loadMeshScene';
import { applySceneState, resolveEffectiveVisibleZones, shouldAutoShowShell } from './applySceneState';
import { useMeasureController } from './useMeasureController';
import { useCameraMode, useResetView } from '../hooks/useCameraMode';
import { useWalkthroughMode } from '../hooks/useWalkthroughMode';
import { useMeasureMode } from '../hooks/useMeasureMode';
import { DEFAULT_INSPECTION, type InspectionState } from '../inspection/inspectionControls';
import { MEASURE_PICK_HINT_IDLE } from '../measure/colors';
import type { BabylonViewerCtx, LoadPhase, StoredCameraPose, ViewerMode } from '../types';

function buildInitialInspection(): InspectionState {
  const saved = loadViewerSettings();
  return {
    ...DEFAULT_INSPECTION,
    lighting: saved.lighting,
    exposure: saved.exposure,
  };
}

export interface UseViewerControllerOptions {
  viewerRef: RefObject<BabylonViewerCtx | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  initialPoseRef: RefObject<StoredCameraPose | null>;
  loadPhase: LoadPhase;
  zoneMeshes: ZoneMeshHandle[];
  sceneManifest: SceneManifestResponse | null;
  sceneScaleRef: RefObject<number>;
  worldUnitRef: RefObject<number>;
}

export function useViewerController(opts: UseViewerControllerOptions) {
  const {
    viewerRef,
    canvasRef,
    initialPoseRef,
    loadPhase,
    zoneMeshes,
    sceneManifest,
    sceneScaleRef,
    worldUnitRef,
  } = opts;

  const [mode, setMode] = useState<ViewerMode>('orbit');
  const [autoRotate, setAutoRotate] = useState(false);
  const [inspection, setInspection] = useState<InspectionState>(buildInitialInspection);
  const [visibleZones, setVisibleZones] = useState<Set<number>>(() => new Set());
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspectionBeforeMeasureRef = useRef<InspectionState | null>(null);

  const measure = useMeasureController();
  const visibleMeasurePoints =
    measure.measurePhase === 'calibrate' ? measure.calibPoints : measure.measurePoints;

  const hasWalkPath = (sceneManifest?.walk_path?.length ?? 0) > 0;

  const zonesForScene = useMemo(
    () => resolveEffectiveVisibleZones(visibleZones, zoneMeshes),
    [visibleZones, zoneMeshes],
  );

  useEffect(() => {
    if (zoneMeshes.length > 0 && visibleZones.size === 0) {
      setVisibleZones(new Set(zoneMeshes.map((z) => z.zoneId)));
    }
  }, [zoneMeshes, visibleZones.size]);

  useEffect(() => {
    const ctx = viewerRef.current;
    const hasZones = (sceneManifest?.zones?.length ?? 0) > 0;
    if (sceneManifest?.shell_url) {
      setInspection((prev) => ({
        ...prev,
        showShell: ctx && shouldAutoShowShell(ctx) ? true : !hasZones,
        showZoneDetail: true,
      }));
    } else if (ctx && shouldAutoShowShell(ctx)) {
      setInspection((prev) => ({ ...prev, showShell: true }));
    }
  }, [sceneManifest?.shell_url, sceneManifest?.zones?.length, loadPhase, viewerRef]);

  useEffect(() => {
    if (mode === 'measure') {
      setInspection((prev) => {
        if (!inspectionBeforeMeasureRef.current) {
          inspectionBeforeMeasureRef.current = prev;
        }
        return {
          ...prev,
          wireframe: true,
          textures: false,
          pbr: false,
        };
      });
    } else if (inspectionBeforeMeasureRef.current) {
      const restored = inspectionBeforeMeasureRef.current;
      inspectionBeforeMeasureRef.current = null;
      setInspection(restored);
    }
  }, [mode]);

  useEffect(() => {
    const ctx = viewerRef.current;
    if (ctx && loadPhase === 'ready') {
      applySceneState(ctx, { inspection, visibleZones: zonesForScene });
      if (mode === 'measure') {
        refreshPickableMeshes([...ctx.geometryMeshes, ...ctx.shellMeshes]);
      }
    }
  }, [inspection, zonesForScene, loadPhase, viewerRef, mode]);

  const handleInspectionChange = useCallback((next: InspectionState) => {
    setInspection(next);
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const saved = loadViewerSettings();
      saveViewerSettings({ ...saved, lighting: next.lighting, exposure: next.exposure });
    }, 400);
  }, []);

  const handleZoneToggle = useCallback((zoneId: number) => {
    setVisibleZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  }, []);

  useCameraMode(viewerRef, canvasRef, mode, loadPhase, autoRotate);
  useWalkthroughMode(viewerRef, canvasRef, mode, loadPhase, sceneManifest, sceneScaleRef);

  const resetView = useResetView(viewerRef, canvasRef, initialPoseRef);

  useMeasureMode({
    viewerRef,
    canvasRef,
    mode,
    loadPhase,
    measurePhase: measure.measurePhase,
    calibPoints: measure.calibPoints,
    measurePoints: measure.measurePoints,
    calibration: measure.calibration,
    visibleMeasurePoints,
    worldUnitRef,
    onPickHint: measure.setMeasurePickHint,
    onAddPoint: measure.handleAddMeasurePoint,
    onUndoPoint: measure.handleUndoLastPoint,
  });

  useEffect(() => {
    if (mode !== 'measure') measure.setMeasurePickHint(MEASURE_PICK_HINT_IDLE);
  }, [mode, measure.setMeasurePickHint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.style.cursor = mode === 'measure' ? 'crosshair' : 'grab';
    } catch { /* ignore */ }
  }, [mode, loadPhase, canvasRef]);

  const handleReset = useCallback(() => {
    setMode('orbit');
    measure.handleResetCalibration();
    resetView();
  }, [measure.handleResetCalibration, resetView]);

  const handleWalkPathStart = useCallback(() => {
    setMode('walkthrough');
  }, []);

  return {
    mode,
    setMode,
    autoRotate,
    setAutoRotate,
    inspection,
    visibleZones,
    handleInspectionChange,
    handleZoneToggle,
    handleReset,
    handleWalkPathStart,
    hasWalkPath,
    measure,
    visibleMeasurePoints,
  };
}
