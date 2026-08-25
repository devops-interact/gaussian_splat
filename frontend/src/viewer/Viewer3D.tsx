import { useCallback, useEffect, useRef, useState } from 'react';
import { Tools } from '@babylonjs/core';
import { Download } from 'lucide-react';
import type { Viewer3DProps, ModelMetadata } from './types';
import { useMeshViewer } from './hooks/useMeshViewer';
import { useViewerController } from './controller/useViewerController';
import { isWebXRAvailable, tryCreateWebXRExperience, type WebXRHandle } from './xr/webXRExperience';
import { downloadModel } from '@/api/jobs';
import { MeasurePanel } from './ui/MeasurePanel';
import { ViewerToolbar, ViewerModeHint } from './ui/ViewerToolbar';
import { InspectionPanel } from './ui/InspectionPanel';

export type { ModelMetadata };

export default function Viewer3D({
  modelUrl,
  jobId = null,
  prefetchedJobModelMetadata = null,
  sceneManifest = null,
  onModelMetadata,
  onZoneLoadWarning,
}: Viewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showInspection, setShowInspection] = useState(false);
  const [webXrAvailable, setWebXrAvailable] = useState(false);
  const [webXrBusy, setWebXrBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const xrRef = useRef<WebXRHandle | null>(null);

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

  const controller = useViewerController({
    viewerRef,
    canvasRef,
    initialPoseRef,
    loadPhase,
    zoneMeshes,
    sceneManifest,
    sceneScaleRef,
    worldUnitRef,
  });

  const isLoading = loadPhase !== 'ready' && loadPhase !== 'error' && loadPhase !== 'idle';

  useEffect(() => {
    void isWebXRAvailable().then(setWebXrAvailable);
  }, []);

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
      if (controller.measure.measuredDistance !== null) {
        lines.push(`Measurement: ${controller.measure.measuredDistance.toFixed(3)} m`);
      }
      const a = document.createElement('a');
      a.href = offscreen.toDataURL('image/png');
      a.download = `room-mesh-snapshot-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.warn('Snapshot failed:', err);
    }
  }, [controller.measure.measuredDistance, metadataRef, viewerRef]);

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
            mode={controller.mode}
            autoRotate={controller.autoRotate}
            showHelp={showHelp}
            webXrAvailable={webXrAvailable}
            webXrBusy={webXrBusy}
            hasWalkPath={controller.hasWalkPath}
            onModeChange={controller.setMode}
            onSnapshot={handleSnapshot}
            onReset={controller.handleReset}
            onToggleAutoRotate={() => controller.setAutoRotate((v) => !v)}
            onEnterVR={() => void handleEnterVR()}
            onToggleHelp={() => setShowHelp((v) => !v)}
            onWalkPathStart={controller.handleWalkPathStart}
            compositionLabel={compositionLabel}
            inspectionSlot={
              <InspectionPanel
                state={controller.inspection}
                onChange={controller.handleInspectionChange}
                open={showInspection}
                onToggle={() => setShowInspection((v) => !v)}
                zoneMeshes={zoneMeshes}
                visibleZones={controller.visibleZones}
                onZoneToggle={controller.handleZoneToggle}
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

          {controller.mode === 'measure' && (
            <MeasurePanel
              measurePhase={controller.measure.measurePhase}
              calibPoints={controller.measure.calibPoints}
              measurePoints={controller.measure.measurePoints}
              measuredDistance={controller.measure.measuredDistance}
              meterInput={controller.measure.meterInput}
              setMeterInput={controller.measure.setMeterInput}
              calibration={controller.measure.calibration}
              measurePickHint={controller.measure.measurePickHint}
              onUndo={controller.measure.handleUndoLastPoint}
              onConfirmCalibration={controller.measure.handleConfirmCalibration}
              onClearMeasure={controller.measure.handleClearMeasure}
              onResetCalibration={controller.measure.handleResetCalibration}
            />
          )}

          <ViewerModeHint mode={controller.mode} hasWalkPath={controller.hasWalkPath} />
        </>
      )}
    </div>
  );
}
