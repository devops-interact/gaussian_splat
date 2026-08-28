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
  if (!pick) return 'Aim at visible mesh geometry to select a vertex.';
  const seg = segmentText ? ` · ${segmentText}` : '';

  if (!pick.isSnapped) {
    if (measurePhase === 'calibrate') {
      if (calibLen === 0) return `Move closer to a vertex — click to place calibration A${seg}`;
      if (calibLen === 1) return `Drag to orbit the model, then click a vertex for calibration B${seg}`;
      return `Move closer to a vertex — click replaces calibration (new A)${seg}`;
    }
    if (measureLen === 0) return `Move closer to a vertex — click to place measure A${seg}`;
    if (measureLen === 1) return `Move closer to a vertex — click to place measure B${seg}`;
    return `Move closer to a vertex — click starts a new pair (new A)${seg}`;
  }

  if (measurePhase === 'calibrate') {
    if (calibLen === 0) return `Vertex selected — click to place calibration A${seg}`;
    if (calibLen === 1) return `Vertex selected — drag to orbit, then click to place calibration B${seg}`;
    return `Vertex selected — click replaces calibration (new A)${seg}`;
  }
  if (measureLen === 0) return `Vertex selected — click to place measure A${seg}`;
  if (measureLen === 1) return `Vertex selected — click to place measure B${seg}`;
  return `Vertex selected — click starts a new pair (new A)${seg}`;
}

export { MEASURE_PICK_HINT_IDLE };
