import { useMemo } from 'react';
import type { ModelMetadata } from './Viewer3D';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  HardDrive,
  Clock,
  Layers,
  Camera,
  Grid3X3,
  Target,
  CheckCircle,
  Palette,
  Loader2,
} from 'lucide-react';

interface TechnicalDetailsProps {
  metadata: ModelMetadata | null;
  jobInfo?: {
    qualityPreset?: string;
    elapsedTime?: string;
    isProcessing?: boolean;
  };
  embedded?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export default function TechnicalDetails({ metadata, jobInfo, embedded }: TechnicalDetailsProps) {
  const details = useMemo(() => {
    if (!metadata) return null;

    const bbox = metadata.boundingBox;
    const sizeX = (bbox.max[0] - bbox.min[0]).toFixed(2);
    const sizeY = (bbox.max[1] - bbox.min[1]).toFixed(2);
    const sizeZ = (bbox.max[2] - bbox.min[2]).toFixed(2);
    const resolution = `${sizeX} x ${sizeY} x ${sizeZ}`;
    return {
      fileSize: formatFileSize(metadata.fileSize),
      vertexCount: formatNumber(metadata.vertexCount || metadata.pointCount),
      faceCount: formatNumber(metadata.faceCount || 0),
      resolution,
      hasColors: metadata.hasColors,
      hasPbr: metadata.hasPbr,
      format: metadata.format,
    };
  }, [metadata]);

  const isProcessing = jobInfo?.isProcessing ?? false;

  const content = (
    <>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-white" />
            Metadata
          </CardTitle>
          {/* Status indicator */}
          {metadata ? (
            <span className="flex items-center gap-1.5 text-[10px] text-white bg-white/[0.08] px-2 py-0.5 rounded border border-white/[0.38]">
              <CheckCircle className="w-3 h-3" />
              Ready
            </span>
          ) : isProcessing ? (
            <span className="flex items-center gap-1.5 text-[10px] text-neutral-300 bg-neutral-300/[0.08] px-2 py-0.5 rounded border border-neutral-300/[0.19]">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] text-gray-500 bg-white/[0.03] px-2 py-0.5 rounded border border-white/[0.18]">
              Idle
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-0 pb-4">
        {details ? (
          <div className="divide-y divide-white/[0.05]">
            <DetailRow icon={<HardDrive className="w-3.5 h-3.5" />} label="File Size" value={details.fileSize} />
            <DetailRow icon={<Clock className="w-3.5 h-3.5" />} label="Processing Time" value={jobInfo?.elapsedTime || '--'} />
            <DetailRow icon={<Layers className="w-3.5 h-3.5" />} label="Vertices" value={details.vertexCount} />
            <DetailRow icon={<Grid3X3 className="w-3.5 h-3.5" />} label="Faces" value={details.faceCount} />
            <DetailRow icon={<Camera className="w-3.5 h-3.5" />} label="Quality Preset" value={jobInfo?.qualityPreset || '--'} capitalize />
            <DetailRow icon={<Target className="w-3.5 h-3.5" />} label="Bounding Box" value={details.resolution} />
            <DetailRow
              icon={<Palette className="w-3.5 h-3.5" />}
              label="PBR Materials"
              value={
                details.hasPbr ? (
                  <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-white" /> Yes</span>
                ) : (
                  <span className="text-gray-500">No</span>
                )
              }
            />
            <DetailRow icon={<HardDrive className="w-3.5 h-3.5" />} label="Format" value={details.format} />
          </div>
        ) : (
          <div className="text-center text-gray-600 text-sm py-6">
            Load a model to see metadata
          </div>
        )}
      </CardContent>
    </>
  );

  if (embedded) return content;

  return <Card className="w-full">{content}</Card>;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function DetailRow({
  icon,
  label,
  value,
  capitalize,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  capitalize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 px-1">
      <span className="text-gray-500 text-xs flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span className={`text-white text-xs font-medium ${capitalize ? 'capitalize' : ''}`}>
        {value}
      </span>
    </div>
  );
}
