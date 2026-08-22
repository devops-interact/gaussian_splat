import { Sun } from 'lucide-react';
import type { LightingState } from '../lighting/sceneLighting';

export interface LightingPanelProps {
  lighting: LightingState;
  onChange: (next: LightingState) => void;
  open: boolean;
  onToggle: () => void;
}

export function LightingPanel({ lighting, onChange, open, onToggle }: LightingPanelProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={`absolute bottom-4 left-3 z-20 p-2 rounded-lg border text-xs flex items-center gap-2 shadow-lg glass-panel transition-colors ${
          open ? 'text-white border-white/40' : 'text-white/60 hover:text-white'
        }`}
        title="Scene lighting"
      >
        <Sun className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute bottom-14 left-3 z-20 w-52 glass-panel p-3 space-y-3 text-xs">
          <p className="text-white/80 font-medium">Lighting</p>
          <SliderRow
            label="Ambient"
            value={lighting.hemiIntensity}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => onChange({ ...lighting, hemiIntensity: v })}
          />
          <SliderRow
            label="Directional"
            value={lighting.dirIntensity}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => onChange({ ...lighting, dirIntensity: v })}
          />
          <SliderRow
            label="Environment"
            value={lighting.envIntensity}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => onChange({ ...lighting, envIntensity: v })}
          />
        </div>
      )}
    </>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-white/60">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-white/40">{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-white"
      />
    </label>
  );
}
