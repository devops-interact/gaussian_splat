import { useCallback, useState } from 'react';
import { Vector3 } from '@babylonjs/core';
import type { CalibrationState, MeasurePhase, MeasurePoint } from '../types';
import { MEASURE_PICK_HINT_IDLE } from '../measure/colors';

export interface MeasureControllerState {
  measurePhase: MeasurePhase;
  calibration: CalibrationState | null;
  calibPoints: MeasurePoint[];
  meterInput: string;
  measurePoints: MeasurePoint[];
  measuredDistance: number | null;
  measurePickHint: string;
}

export interface MeasureControllerActions {
  setMeterInput: (v: string) => void;
  setMeasurePickHint: (hint: string) => void;
  handleAddMeasurePoint: (point: Vector3) => void;
  handleUndoLastPoint: () => void;
  handleConfirmCalibration: () => void;
  handleResetCalibration: () => void;
  handleClearMeasure: () => void;
}

export function useMeasureController(): MeasureControllerState & MeasureControllerActions {
  const [measurePhase, setMeasurePhase] = useState<MeasurePhase>('calibrate');
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [calibPoints, setCalibPoints] = useState<MeasurePoint[]>([]);
  const [meterInput, setMeterInput] = useState('1.0');
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [measuredDistance, setMeasuredDistance] = useState<number | null>(null);
  const [measurePickHint, setMeasurePickHint] = useState(MEASURE_PICK_HINT_IDLE);

  const handleAddMeasurePoint = useCallback(
    (point: Vector3) => {
      if (measurePhase === 'calibrate') {
        setCalibPoints((prev) => {
          if (prev.length >= 2) return [{ position: point.clone() }];
          return [...prev, { position: point.clone() }];
        });
        return;
      }

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
    },
    [measurePhase, calibration],
  );

  const handleUndoLastPoint = useCallback(() => {
    if (measurePhase === 'calibrate') {
      setCalibPoints((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
    } else {
      setMeasurePoints((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
      setMeasuredDistance(null);
    }
  }, [measurePhase]);

  const handleConfirmCalibration = useCallback(() => {
    if (calibPoints.length !== 2) return;
    const rawDist = Vector3.Distance(calibPoints[0].position, calibPoints[1].position);
    const meters = parseFloat(meterInput) || 1.0;
    const scale = meters / rawDist;
    setCalibration({ points: calibPoints, rawDistance: rawDist, realMeters: meters, scaleFactor: scale });
    setMeasurePhase('measure');
    setMeasurePoints([]);
    setMeasuredDistance(null);
  }, [calibPoints, meterInput]);

  const handleResetCalibration = useCallback(() => {
    setCalibration(null);
    setCalibPoints([]);
    setMeasurePhase('calibrate');
    setMeasurePoints([]);
    setMeasuredDistance(null);
    setMeterInput('1.0');
  }, []);

  const handleClearMeasure = useCallback(() => {
    setMeasurePoints([]);
    setMeasuredDistance(null);
  }, []);

  return {
    measurePhase,
    calibration,
    calibPoints,
    meterInput,
    measurePoints,
    measuredDistance,
    measurePickHint,
    setMeterInput,
    setMeasurePickHint,
    handleAddMeasurePoint,
    handleUndoLastPoint,
    handleConfirmCalibration,
    handleResetCalibration,
    handleClearMeasure,
  };
}
