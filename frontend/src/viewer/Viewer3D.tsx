import { useCallback, useEffect, useRef, useState } from 'react';
import { Tools, Vector3 } from '@babylonjs/core';
import { Download } from 'lucide-react';
import type { Viewer3DProps, ModelMetadata, ViewerMode, MeasurePhase, CalibrationState, MeasurePoint } from './types';
import { useMeshViewer } from './hooks/useMeshViewer';
import { useCameraMode, useResetView } from './hooks/useCameraMode';
import { useWalkthroughMode } from './hooks/useWalkthroughMode';
import { useMeasureMode } from './hooks/useMeasureMode';
import { useMeasureActions } from './hooks/useMeasureActions';
import { MEASURE_PICK_HINT_IDLE } from './measure/colors';
import { isWebXRAvailable, tryCreateWebXRExperience, type WebXRHandle } from './xr/webXRExperience';
import { downloadModel } from '@/api/jobs';
import { MeasurePanel } from './ui/MeasurePanel';
import { ViewerToolbar, ViewerModeHint } from './ui/ViewerToolbar';
import { InspectionPanel } from './ui/InspectionPanel';
import { applyInspectionState, DEFAULT_INSPECTION, type InspectionState } from './inspection/inspectionControls';
import { loadViewerSettings, saveViewerSettings } from '@/lib/viewerSettings';

export type { ModelMetadata };

function buildInitialInspection(): InspectionState {
  const saved = loadViewerSettings();
  return {
    ...DEFAULT_INSPECTION,
    lighting: saved.lighting,
    exposure: saved.exposure,
  };
}

export default function Viewer3D({
  modelUrl,
  jobId = null,
  prefetchedJobModelMetadata = null,
  sceneManifest = null,
  onModelMetadata,
  onZoneLoadWarning,
}: Viewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<ViewerMode>('orbit');
  const [showHelp, setShowHelp] = useState(false);
  const [showInspection, setShowInspection] = useState(false);
  const [inspection, setInspection] = useState<InspectionState>(buildInitialInspection);
  const [visibleZones, setVisibleZones] = useState<Set<number>>(() => new Set());
  const [autoRotate, setAutoRotate] = useState(false);
  const [webXrAvailable, setWebXrAvailable] = useState(false);
  const [webXrBusy, setWebXrBusy] = useState(false);
  const xrRef = useRef<WebXRHandle | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [measurePhase, setMeasurePhase] = useState<MeasurePhase>('calibrate');
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [calibPoints, setCalibPoints] = useState<MeasurePoint[]>([]);
  const [meterInput, setMeterInput] = useState('1.0');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);
  const [measurePickHint, setMeasurePickHint] = useState(MEASURE_PICK_HINT_IDLE);
  const [downloadBusy, setDownloadBusy] = useState(false);

  const visibleMeasurePoints = measurePhase === 'calibrate' ? calibPoints : measurePoints;

  const isRoom = sceneManifest?.composition_mode === 'zone_mesh'
    || sceneManifest?.composition_mode === 'room_shell'
    || !!sceneManifest?.shell_url;
  const zoneCount = sceneManifest?.zones?.length ?? 0;
  const hasShell = !!sceneManifest?.shell_url;
  const compositionLabel = hasShell
    ? `Room shell${zoneCount > 0 ? ` · ${zoneCount} detail mesh${zoneCount === 1 ? '' : 'es'}` : ''}`
    : isRoom
      ? `Room · ${zoneCount} zones`
      : 'Single object';

  const {
    viewerRef,
    initialPoseRef,
    loadPhase,
    loadProgress,
    loadLabel,
    error,
    metadataRef,
    sceneScaleRef,
    worldUnitRef,
    zoneMeshes,
  } = useMeshViewer({
    canvasRef,
    modelUrl,
    jobId,
    prefetchedJobModelMetadata,
    sceneManifest,
    onModelMetadata,
    onZoneLoadWarning,
  });

  const isLoading = loadPhase !== 'ready' && loadPhase !== 'error' && loadPhase !== 'idle';

  useEffect(() => {
    if (zoneMeshes.length > 0) {
      setVisibleZones(new Set(zoneMeshes.map((z) => z.zoneId)));
    }
  }, [zoneMeshes]);

  useEffect(() => {
    if (sceneManifest?.shell_url || sceneManifest?.primary_geometry === 'shell') {
      setInspection((prev) => ({ ...prev, showShell: true }));
    }
  }, [sceneManifest?.shell_url, sceneManifest?.primary_geometry]);

  useEffect(() => {
    const ctx = viewerRef.current;
    if (ctx && loadPhase === 'ready') {
      applyInspectionState(ctx, inspection);
    }
  }, [inspection, loadPhase, viewerRef]);

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
      const ctx = viewerRef.current;
      if (ctx) {
        const zm = ctx.zoneMeshes.find((z) => z.zoneId === zoneId);
        if (zm) {
          const visible = next.has(zoneId);
          zm.rootMesh.setEnabled(visible);
          for (const gm of zm.geometryMeshes) gm.setEnabled(visible);
        }
      }
      return next;
    });
  }, [viewerRef]);

  useCameraMode(viewerRef, canvasRef, mode, loadPhase, autoRotate);
  useWalkthroughMode(viewerRef, canvasRef, mode, loadPhase);

  const resetView = useResetView(viewerRef, canvasRef, initialPoseRef);

  const {
    handleAddMeasurePoint: addPointRaw,
    handleUndoLastPoint,
    handleConfirmCalibration,
    handleResetCalibration,
    handleClearMeasure,
  } = useMeasureActions(
    measurePhase,
    calibPoints,
    meterInput,
    setCalibPoints,
    setMeasurePoints,
    setCalibration,
    setMeasurePhase,
    setMeasuredDistance,
    setMeterInput,
  );

  const handleAddMeasurePoint = useCallback(
    (point: Vector3) => {
      if (measurePhase === 'measure') {
        setMeasurePoints((prev) => {
          const next = prev.length >= 2 ? [{ position: point.clone() }] : [...prev, { position: point.clone() }];
          if (next.length === 2 && calibration) {
            const rawDist = Vector3.Distance(next[0].position, next[1].position);
            setMeasuredDistance(rawDist * calibration.scaleFactor);
          } else {
            setMeasuredDistance(null);
          }
          return next;
        });
      } else {
        addPointRaw(point);
      }
    },
    [measurePhase, calibration, addPointRaw],
  );

  useMeasureMode({
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
    pickDebugEnabled: false,
    onPickHint: setMeasurePickHint,
    onAddPoint: handleAddMeasurePoint,
    onUndoPoint: handleUndoLastPoint,
  });

  useEffect(() => {
    void isWebXRAvailable().then(setWebXrAvailable);
  }, []);

  useEffect(() => {
    if (mode !== 'measure') setMeasurePickHint(MEASURE_PICK_HINT_IDLE);
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      if (mode === 'measure') canvas.style.cursor = 'crosshair';
      else canvas.style.cursor = 'grab';
    } catch { /* ignore */ }
  }, [mode, loadPhase]);

  useEffect(() => {
    if (mode !== 'measure') handleResetCalibration();
  }, [mode, handleResetCalibration]);

  const handleReset = useCallback(() => {
    setMode('orbit');
    handleResetCalibration();
    resetView();
  }, [handleResetCalibration, resetView]);

  const handleSnapshot = useCallback(() => {
    const glCanvas = canvasRef.current;
    if (!glCanvas) return;
    try {
      viewerRef.current?.scene.render();
    } catch { /* ignore */ }
    try {
      const w = glCanvas.width;
      const h = glCanvas.height;
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(glCanvas, 0, 0);
      const meta = metadataRef.current;
      const lines: string[] = [];
      if (meta) {
        lines.push(`Vertices: ${meta.vertexCount.toLocaleString()}`);
        lines.push(`Faces: ${meta.faceCount.toLocaleString()}`);
        lines.push(`Size: ${(meta.fileSize / 1e6).toFixed(1)} MB`);
      }
      if (measuredDistance !== null) lines.push(`Measurement: ${measuredDistance.toFixed(3)} m`);
      const a = document.createElement('a');
      a.href = offscreen.toDataURL('image/png');
      a.download = `room-mesh-snapshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.warn('Snapshot failed:', err);
    }
  }, [measuredDistance, metadataRef, viewerRef]);

  const handleDownloadGlb = useCallback(async () => {
    if (!jobId && !modelUrl) return;
    setDownloadBusy(true);
    try {
      const blob = jobId
        ? await downloadModel(jobId)
        : await fetch(modelUrl!).then((r) => r.blob());
      Tools.Download(blob, `model-${jobId ?? Date.now()}.glb`);
    } catch (e) {
      console.warn('GLB download failed:', e);
    } finally {
      setDownloadBusy(false);
    }
  }, [modelUrl, jobId]);

  const handleEnterVR = useCallback(async () => {
    const scene = viewerRef.current?.scene;
    if (!scene || webXrBusy) return;
    setWebXrBusy(true);
    try {
      xrRef.current?.dispose();
      xrRef.current = await tryCreateWebXRExperience(scene);
    } catch (e) {
      console.warn('[Babylon] WebXR failed:', e);
    } finally {
      setWebXrBusy(false);
    }
  }, [viewerRef, webXrBusy]);

  if (!modelUrl && !(sceneManifest?.zones?.length)) return null;

  return (
    <div className="w-full h-full relative group bg-neutral-950 rounded-xl overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block touch-none" />

      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-neutral-950/80">
          <div className="flex flex-col items-center gap-3 w-48">
            <div className="w-8 h-8 border-2 border-white/35 border-t-white rounded-full animate-spin" />
            <span className="text-neutral-300/70 text-xs text-center">{loadLabel}</span>
            {loadPhase === 'fetching' && (
              <div className="w-full h-1 bg-white/10 rounded overflow-hidden">
                <div className="h-full bg-white/70 transition-all" style={{ width: `${loadProgress}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="absolute top-12 left-3 right-3 z-30 bg-red-900/80 backdrop-blur-md text-white text-xs p-3 rounded-lg border border-red-500/38 break-all">
          <span className="text-red-300 font-bold">Viewer Error: </span>{error}
        </div>
      )}

      {loadPhase === 'ready' && !error && (
        <>
          <ViewerToolbar
            mode={mode}
            autoRotate={autoRotate}
            showHelp={showHelp}
            webXrAvailable={webXrAvailable}
            webXrBusy={webXrBusy}
            onModeChange={setMode}
            onSnapshot={handleSnapshot}
            onReset={handleReset}
            onToggleAutoRotate={() => setAutoRotate((v) => !v)}
            onEnterVR={() => void handleEnterVR()}
            onToggleHelp={() => setShowHelp((v) => !v)}
            compositionLabel={compositionLabel}
            inspectionSlot={
              <InspectionPanel
                state={inspection}
                onChange={handleInspectionChange}
                open={showInspection}
                onToggle={() => setShowInspection((v) => !v)}
                zoneMeshes={zoneMeshes}
                visibleZones={visibleZones}
                onZoneToggle={handleZoneToggle}
                compositionLabel={compositionLabel}
              />
            }
          />

          <div className="absolute bottom-4 right-3 z-20">
            <button
              type="button"
              disabled={downloadBusy}
              onClick={() => void handleDownloadGlb()}
              className="p-2 rounded-lg border text-xs flex items-center gap-2 shadow-lg glass-panel text-white/60 hover:text-white"
            >
              <Download className="w-4 h-4" /> {downloadBusy ? '…' : 'GLB'}
            </button>
          </div>

          {mode === 'measure' && (
            <MeasurePanel
              measurePhase={measurePhase}
              calibPoints={calibPoints}
              measurePoints={measurePoints}
              measuredDistance={measuredDistance}
              meterInput={meterInput}
              setMeterInput={setMeterInput}
              calibration={calibration}
              measurePickHint={measurePickHint}
              onUndo={handleUndoLastPoint}
              onConfirmCalibration={handleConfirmCalibration}
              onClearMeasure={handleClearMeasure}
              onResetCalibration={handleResetCalibration}
            />
          )}

          <ViewerModeHint mode={mode} />
        </>
      )}
    </div>
  );
}
