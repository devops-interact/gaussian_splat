import type { PickResult } from '@/lib/meshPick';
import type { MeasurePhase } from '../types';
import { MEASURE_PICK_HINT_IDLE } from './colors';

export function buildMeasurePickHint(
  measurePhase: MeasurePhase,
  calibLen: number,
  measureLen: number,
  pick: PickResult | null,
  segmentText?: string | null,
): string {
  if (!pick) return 'Aim at the mesh surface to place a point.';
  const seg = segmentText ? ` · ${segmentText}` : '';

  if (!pick.isSnapped) {
    if (measurePhase === 'calibrate') {
      if (calibLen === 0) return `Surface detected — click to place calibration A${seg}`;
      if (calibLen === 1) return `Surface detected — click to place calibration B${seg}`;
      return `Surface detected — click replaces calibration (new A)${seg}`;
    }
    if (measureLen === 0) return `Surface detected — click to place measure A${seg}`;
    if (measureLen === 1) return `Surface detected — click to place measure B${seg}`;
    return `Surface detected — click starts a new pair (new A)${seg}`;
  }

  if (measurePhase === 'calibrate') {
    if (calibLen === 0) return `Preview: calibration A (vertex)${seg} · click to place`;
    if (calibLen === 1) return `Preview: calibration B (vertex)${seg} · click to place`;
    return `Preview: click replaces calibration (new A)${seg}`;
  }
  if (measureLen === 0) return `Preview: measure A (vertex)${seg} · click to place`;
  if (measureLen === 1) return `Preview: measure B (vertex)${seg} · click to place`;
  return `Preview: click starts a new pair (new A)${seg}`;
}

export { MEASURE_PICK_HINT_IDLE };
