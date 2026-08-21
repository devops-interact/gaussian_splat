import { CircleDot, RotateCcw, Trash2 } from 'lucide-react';
import type { CalibrationState, MeasurePhase, MeasurePoint } from '../types';

export interface MeasurePanelProps {
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
}

export function MeasurePanel(props: MeasurePanelProps) {
  const {
    measurePhase, calibPoints, measurePoints, measuredDistance, meterInput, setMeterInput,
    calibration, measurePickHint, onUndo, onConfirmCalibration, onClearMeasure, onResetCalibration,
  } = props;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-[min(100vw-1.5rem,42rem)]">
      <div className="glass-panel px-4 py-2.5 flex flex-col gap-1.5 text-xs">
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
