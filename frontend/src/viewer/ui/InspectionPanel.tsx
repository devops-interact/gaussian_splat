import { SlidersHorizontal } from 'lucide-react';
import type { InspectionState } from '../inspection/inspectionControls';
import type { ZoneMeshHandle } from '../load/loadMeshScene';

export interface InspectionPanelProps {
  state: InspectionState;
  onChange: (next: InspectionState) => void;
  open: boolean;
  onToggle: () => void;
  zoneMeshes?: ZoneMeshHandle[];
  visibleZones?: Set<number>;
  onZoneToggle?: (zoneId: number) => void;
  compositionLabel?: string;
}

export function InspectionPanel({
  state,
  onChange,
  open,
  onToggle,
  zoneMeshes = [],
  visibleZones,
  onZoneToggle,
  compositionLabel,
}: InspectionPanelProps) {
  const patch = (partial: Partial<InspectionState>) => onChange({ ...state, ...partial });
  const patchLighting = (partial: Partial<InspectionState['lighting']>) =>
    onChange({ ...state, lighting: { ...state.lighting, ...partial } });

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-all duration-150 border backdrop-blur-md ${
          open
            ? 'bg-white/15 text-white border-white/40'
            : 'bg-neutral-950/70 text-white/50 border-white/[0.22] hover:text-white hover:bg-white/[0.06]'
        }`}
        title="Inspection & lighting"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span>Inspect</span>
      </button>

      {open && (
        <div className="absolute top-14 right-3 z-30 w-56 max-h-[70vh] overflow-y-auto glass-panel p-3 space-y-3 text-xs">
          {compositionLabel && (
            <p className="text-[10px] text-emerald-400/90 font-medium uppercase tracking-wide">{compositionLabel}</p>
          )}

          <Section title="Display">
            <Toggle label="Wireframe" checked={state.wireframe} onChange={(v) => patch({ wireframe: v })} />
            <Toggle label="Textures" checked={state.textures} onChange={(v) => patch({ textures: v })} />
            <Toggle label="PBR materials" checked={state.pbr} onChange={(v) => patch({ pbr: v })} />
            <Toggle label="Floor grid" checked={state.showGrid} onChange={(v) => patch({ showGrid: v })} />
            <Toggle label="Axes" checked={state.showAxes} onChange={(v) => patch({ showAxes: v })} />
            <Toggle label="Room shell" checked={state.showShell} onChange={(v) => patch({ showShell: v })} />
            {zoneMeshes.length > 0 && (
              <Toggle
                label="Furniture detail"
                checked={state.showZoneDetail}
                onChange={(v) => patch({ showZoneDetail: v })}
              />
            )}
          </Section>

          <Section title="Lighting">
            <Slider label="Ambient" value={state.lighting.hemiIntensity} min={0} max={2} step={0.05}
              onChange={(v) => patchLighting({ hemiIntensity: v })} />
            <Slider label="Directional" value={state.lighting.dirIntensity} min={0} max={2} step={0.05}
              onChange={(v) => patchLighting({ dirIntensity: v })} />
            <Slider label="Environment" value={state.lighting.envIntensity} min={0} max={2} step={0.05}
              onChange={(v) => patchLighting({ envIntensity: v })} />
            <Slider label="Exposure" value={state.exposure} min={0.2} max={2.5} step={0.05}
              onChange={(v) => patch({ exposure: v })} />
          </Section>

          {zoneMeshes.length > 1 && visibleZones && onZoneToggle && (
            <Section title="Zones">
              {zoneMeshes.map(({ zoneId }) => (
                <Toggle
                  key={zoneId}
                  label={`Zone ${zoneId}`}
                  checked={visibleZones.has(zoneId)}
                  onChange={() => onZoneToggle(zoneId)}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-white/70 font-medium">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between text-white/60 cursor-pointer">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-white" />
    </label>
  );
}

function Slider({
  label, value, min, max, step, onChange,
}: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-white/60">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-white/40">{value.toFixed(2)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full accent-white" />
    </label>
  );
}
