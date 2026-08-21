import { useCallback, useEffect, useRef, useState } from 'react';
import { Tools, Vector3 } from '@babylonjs/core';
import {
  Camera,
  Ruler,
  RotateCcw,
  Footprints,
  MousePointer,
  X,
  Info,
  Trash2,
  CircleDot,
  Download,
  Glasses,
} from 'lucide-react';
import type { Viewer3DProps, ModelMetadata, ViewerMode, MeasurePhase, CalibrationState, MeasurePoint } from './types';
import { useMeshViewer } from './hooks/useMeshViewer';
import { useCameraMode, useResetView } from './hooks/useCameraMode';
import { useWalkthroughMode } from './hooks/useWalkthroughMode';
import { useMeasureMode, useMeasureActions } from './hooks/useMeasureMode';
import { MEASURE_PICK_HINT_IDLE } from './measure/colors';
import { isWebXRAvailable, tryCreateWebXRExperience, type WebXRHandle } from './xr/webXRExperience';
import { getApiBaseUrl } from '@/lib/apiBase';

export type { ModelMetadata };

export default function Viewer3D({
  modelUrl,
  jobId = null,
  prefetchedJobModelMetadata = null,
  onModelMetadata,
}: Viewer3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<ViewerMode>('orbit');
  const [showHelp, setShowHelp] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [webXrAvailable, setWebXrAvailable] = useState(false);
  const [webXrBusy, setWebXrBusy] = useState(false);
  const xrRef = useRef<WebXRHandle | null>(null);

  const [measurePhase, setMeasurePhase] = useState<MeasurePhase>('calibrate');
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [calibPoints, setCalibPoints] = useState<MeasurePoint[]>([]);
  const [meterInput, setMeterInput] = useState('1.0');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);
  const [measurePickHint, setMeasurePickHint] = useState(MEASURE_PICK_HINT_IDLE);
  const [downloadBusy, setDownloadBusy] = useState(false);

  const visibleMeasurePoints = measurePhase === 'calibrate' ? calibPoints : measurePoints;

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
  } = useMeshViewer({
    canvasRef,
    modelUrl,
    jobId,
    prefetchedJobModelMetadata,
    onModelMetadata,
  });

  const isLoading = loadPhase !== 'ready' && loadPhase !== 'error' && loadPhase !== 'idle';

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
      else if (mode === 'walkthrough') canvas.style.cursor = 'grab';
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
    if (!modelUrl) return;
    setDownloadBusy(true);
    try {
      const apiBase = getApiBaseUrl();
      const url = modelUrl.startsWith('http') ? modelUrl : `${apiBase}${modelUrl}`;
      const resp = await fetch(url);
      const blob = await resp.blob();
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

  if (!modelUrl) return null;

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
          <div className="absolute bottom-4 right-3 z-20">
            <button
              type="button"
              disabled={downloadBusy}
              onClick={() => void handleDownloadGlb()}
              className="p-2 rounded-lg border text-xs flex items-center gap-2 shadow-lg bg-neutral-950/75 border-white/[0.18] text-white/60 hover:text-white"
            >
              <Download className="w-4 h-4" /> {downloadBusy ? '…' : 'GLB'}
            </button>
          </div>

          <div className="absolute top-3 left-3 z-10">
            <div className="bg-neutral-950/70 backdrop-blur-md text-white/80 text-xs px-3 py-1.5 rounded-lg border border-white/[0.18] flex items-center gap-2">
              {mode === 'orbit' && <><MousePointer className="w-3 h-3" /> Orbit</>}
              {mode === 'walkthrough' && <><Footprints className="w-3 h-3" /> Walk-Through</>}
              {mode === 'measure' && <><Ruler className="w-3 h-3" /> Measure</>}
            </div>
          </div>

          <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
            <ToolbarButton icon={<MousePointer className="w-3.5 h-3.5" />} label="Orbit" active={mode === 'orbit'} onClick={() => setMode('orbit')} />
            <ToolbarButton icon={<Footprints className="w-3.5 h-3.5" />} label="Walk" active={mode === 'walkthrough'} onClick={() => setMode('walkthrough')} />
            <ToolbarButton icon={<Ruler className="w-3.5 h-3.5" />} label="Measure" active={mode === 'measure'} onClick={() => setMode('measure')} />
            <div className="border-t border-white/[0.18] my-1" />
            <ToolbarButton icon={<Camera className="w-3.5 h-3.5" />} label="Snapshot" onClick={handleSnapshot} />
            <ToolbarButton icon={<RotateCcw className="w-3.5 h-3.5" />} label="Reset" onClick={handleReset} />
            <ToolbarButton
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              label={autoRotate ? 'Auto ✓' : 'Auto'}
              active={autoRotate}
              onClick={() => setAutoRotate((v) => !v)}
            />
            {webXrAvailable && (
              <ToolbarButton
                icon={<Glasses className="w-3.5 h-3.5" />}
                label={webXrBusy ? 'VR…' : 'Enter VR'}
                onClick={() => void handleEnterVR()}
              />
            )}
            <ToolbarButton icon={<Info className="w-3.5 h-3.5" />} label="Help" active={showHelp} onClick={() => setShowHelp(!showHelp)} />
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

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10">
            <div className="bg-neutral-950/70 backdrop-blur-md text-white/50 text-[10px] px-3 py-1.5 rounded-lg border border-white/[0.18]">
              {mode === 'orbit' && 'Left: Orbit  |  Shift+Drag / Right: Pan  |  Scroll: Zoom'}
              {mode === 'walkthrough' && 'WASD: Move  |  Mouse: Look  |  Space/Shift: Up/Down'}
              {mode === 'measure' && 'Click mesh surface · Esc/right-click undo'}
            </div>
          </div>

          {showHelp && (
            <div className="absolute top-14 right-3 z-20 w-64">
              <div className="bg-neutral-950/95 backdrop-blur-md border border-white/[0.18] rounded-xl p-4 text-xs text-white/70 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white text-sm">Viewer Controls</span>
                  <button type="button" onClick={() => setShowHelp(false)} className="text-white/40 hover:text-white"><X className="w-3 h-3" /></button>
                </div>
                <HelpItem icon={<MousePointer className="w-3 h-3" />} title="Orbit">Left-drag rotate. Shift/right-drag pan. Scroll zoom.</HelpItem>
                <HelpItem icon={<Footprints className="w-3 h-3" />} title="Walk-Through">WASD move with collision proxy. Mouse look.</HelpItem>
                <HelpItem icon={<Ruler className="w-3 h-3" />} title="Measure">Calibrate with two known points, then measure on mesh surfaces.</HelpItem>
                <HelpItem icon={<Glasses className="w-3 h-3" />} title="WebXR">Enter VR when a headset is available.</HelpItem>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MeasurePanel(props: {
  measurePhase: MeasurePhase;
  calibPoints: MeasurePoint[];
  measurePoints: MeasurePoint[];
  measuredDistance: number | null;
  meterInput: string;
  setMeterInput: (v: string) => void;
  calibration: CalibrationState | null;
  measurePickHint: string;
  onUndo: () => void;
  onConfirmCalibration: () => void;
  onClearMeasure: () => void;
  onResetCalibration: () => void;
}) {
  const {
    measurePhase, calibPoints, measurePoints, measuredDistance, meterInput, setMeterInput,
    calibration, measurePickHint, onUndo, onConfirmCalibration, onClearMeasure, onResetCalibration,
  } = props;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-[min(100vw-1.5rem,42rem)]">
      <div className="bg-neutral-950/80 backdrop-blur-md border border-white/[0.18] rounded-xl px-4 py-2.5 flex flex-col gap-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${measurePhase === 'calibrate' ? 'bg-neutral-300/15 text-neutral-300' : 'bg-white/15 text-white'}`}>
            {measurePhase === 'calibrate' ? 'STEP 1: Calibrate' : 'STEP 2: Measure'}
          </span>
          <div className="border-l border-white/[0.18] h-5" />
          {measurePhase === 'calibrate' ? (
            <>
              <div className="flex items-center gap-2">
                <span className={`flex items-center gap-1 ${calibPoints.length >= 1 ? 'text-[#6eb7ff]' : 'text-white/30'}`}>
                  <CircleDot className="w-3 h-3" /> A {calibPoints.length >= 1 ? '✓' : ''}
                </span>
                <span className="text-white/15">&rarr;</span>
                <span className={`flex items-center gap-1 ${calibPoints.length >= 2 ? 'text-[#2f8fff]' : 'text-white/30'}`}>
                  <CircleDot className="w-3 h-3" /> B {calibPoints.length >= 2 ? '✓' : ''}
                </span>
              </div>
              {calibPoints.length > 0 && (
                <>
                  <div className="border-l border-white/[0.18] h-5" />
                  <button type="button" onClick={onUndo} className="flex items-center gap-1 text-white/40 hover:text-white"><RotateCcw className="w-3 h-3" /> Undo</button>
                </>
              )}
              {calibPoints.length === 2 && (
                <>
                  <div className="border-l border-white/[0.18] h-5" />
                  <input type="number" step="0.01" min="0.01" value={meterInput} onChange={(e) => setMeterInput(e.target.value)} className="w-16 bg-neutral-950 border border-white/[0.22] rounded px-1.5 py-0.5 text-white text-xs text-center" />
                  <span className="text-white/40">m</span>
                  <button type="button" onClick={onConfirmCalibration} className="px-2 py-0.5 rounded bg-white/15 text-white border border-white/40">Confirm</button>
                </>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className={`flex items-center gap-1 ${measurePoints.length >= 1 ? 'text-[#6eb7ff]' : 'text-white/30'}`}>
                  <CircleDot className="w-3 h-3" /> A {measurePoints.length >= 1 ? '✓' : ''}
                </span>
                <span className="text-white/15">&rarr;</span>
                <span className={`flex items-center gap-1 ${measurePoints.length >= 2 ? 'text-[#2f8fff]' : 'text-white/30'}`}>
                  <CircleDot className="w-3 h-3" /> B {measurePoints.length >= 2 ? '✓' : ''}
                </span>
              </div>
              {measuredDistance !== null && (
                <>
                  <div className="border-l border-white/[0.18] h-5" />
                  <span className="text-white text-sm font-semibold">{measuredDistance.toFixed(3)} m</span>
                </>
              )}
              {measurePoints.length > 0 && (
                <>
                  <div className="border-l border-white/[0.18] h-5" />
                  <button type="button" onClick={onUndo} className="text-white/40 hover:text-white"><RotateCcw className="w-3 h-3" /></button>
                  <button type="button" onClick={onClearMeasure} className="text-white/40 hover:text-white"><Trash2 className="w-3 h-3" /></button>
                </>
              )}
              <button type="button" onClick={onResetCalibration} className="text-neutral-300/60 text-[10px]">Recalibrate</button>
              {calibration && <span className="text-white/20 text-[9px]">(1u = {calibration.scaleFactor.toFixed(3)}m)</span>}
            </>
          )}
        </div>
        <p className="text-[10px] text-white/45 leading-snug">{measurePickHint}</p>
      </div>
    </div>
  );
}

function ToolbarButton({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void;
}) {
  const color = active
    ? 'bg-white/15 text-white border-white/40'
    : 'bg-neutral-950/70 text-white/50 border-white/[0.22] hover:text-white hover:bg-white/[0.06]';
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-all duration-150 border ${color} backdrop-blur-md`} title={label}>
      {icon}<span>{label}</span>
    </button>
  );
}

function HelpItem({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-white/80 font-medium mb-0.5">{icon}{title}</div>
      <p className="text-white/40 leading-relaxed pl-5">{children}</p>
    </div>
  );
}
