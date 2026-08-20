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
  if (!pick) return MEASURE_PICK_HINT_IDLE;
  if (!pick.isSnapped) {
    return 'No surface under cursor — move over the mesh.';
  }
  const seg = segmentText ? ` · ${segmentText}` : '';
  if (measurePhase === 'calibrate') {
    if (calibLen === 0) return `Preview: calibration A${seg} · click to place`;
    if (calibLen === 1) return `Preview: calibration B${seg} · click to place`;
    return `Preview: click replaces calibration (new A)`;
  }
  if (measureLen === 0) return `Preview: measure A${seg} · click to place`;
  if (measureLen === 1) return `Preview: measure B${seg} · click to place`;
  return `Preview: click starts a new pair (new A)`;
}
