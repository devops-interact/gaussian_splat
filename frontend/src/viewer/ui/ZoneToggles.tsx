import type { ZoneMeshHandle } from '../load/loadMeshScene';

export interface ZoneTogglesProps {
  zoneMeshes: ZoneMeshHandle[];
  visibleZones: Set<number>;
  onToggle: (zoneId: number) => void;
}

export function ZoneToggles({ zoneMeshes, visibleZones, onToggle }: ZoneTogglesProps) {
  if (zoneMeshes.length <= 1) return null;

  return (
    <div className="absolute top-14 left-3 z-10 glass-panel px-3 py-2 text-xs space-y-1.5">
      <p className="text-white/60 font-medium">Zones</p>
      {zoneMeshes.map(({ zoneId }) => (
        <label key={zoneId} className="flex items-center gap-2 text-white/70 cursor-pointer">
          <input
            type="checkbox"
            checked={visibleZones.has(zoneId)}
            onChange={() => onToggle(zoneId)}
            className="accent-white"
          />
          Zone {zoneId}
        </label>
      ))}
    </div>
  );
}
