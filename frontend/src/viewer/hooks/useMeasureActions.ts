import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { Vector3 } from '@babylonjs/core';
import type { CalibrationState, MeasurePhase, MeasurePoint } from '../types';

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
