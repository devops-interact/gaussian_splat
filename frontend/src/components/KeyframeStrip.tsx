import { useMemo } from 'react';
import type { KeyframeInfo } from '@/types/job';
import { getApiBaseUrl } from '@/lib/apiBase';
import { Image } from 'lucide-react';

interface KeyframeStripProps {
  keyframes: KeyframeInfo[];
  embedded?: boolean;
}

function resolveUrl(url: string): string {
  if (url.startsWith('http')) return url;
  const base = getApiBaseUrl().replace(/\/$/, '');
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

export default function KeyframeStrip({ keyframes, embedded }: KeyframeStripProps) {
  const sorted = useMemo(
    () => [...keyframes].sort((a, b) => (a.zone_id ?? 0) - (b.zone_id ?? 0) || a.index - b.index),
    [keyframes],
  );

  if (sorted.length === 0) return null;

  const content = (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Image className="w-3.5 h-3.5" />
        <span>Extracted Keyframes ({sorted.length})</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {sorted.map((kf, i) => (
          <div
            key={`${kf.zone_id ?? 0}-${kf.index}-${i}`}
            className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-white/[0.22] bg-neutral-950 relative group"
            title={[
              `Frame ${kf.index}`,
              kf.zone_id != null ? `Zone ${kf.zone_id}` : null,
              kf.yaw_deg != null ? `${kf.yaw_deg.toFixed(0)}°` : null,
            ].filter(Boolean).join(' · ')}
          >
            <img
              src={resolveUrl(kf.url)}
              alt={`Keyframe ${kf.index}`}
              className="w-full h-full object-contain"
              loading="lazy"
            />
            <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-white/80 text-center py-0.5">
              {kf.zone_id != null ? `Z${kf.zone_id}` : ''} #{kf.index}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  if (embedded) return content;
  return <div className="p-4 rounded-lg border border-white/[0.18] bg-neutral-950/50">{content}</div>;
}
