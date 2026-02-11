import { useMemo } from 'react';
import type { ModelMetadata } from './Viewer3D';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  HardDrive,
  Clock,
  Layers,
  Camera,
  Grid3X3,
  Monitor,
  Target,
  AlertTriangle,
  CheckCircle,
  Palette,
  Eye,
} from 'lucide-react';

interface TechnicalDetailsProps {
  metadata: ModelMetadata | null;
  jobInfo?: {
    qualityPreset?: string;
    elapsedTime?: string;
    status?: string;
    projectName?: string;
    location?: string;
    updatedAt?: string;
  };
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

export default function TechnicalDetails({ metadata, jobInfo }: TechnicalDetailsProps) {
  const details = useMemo(() => {
    if (!metadata) return null;

    const bbox = metadata.boundingBox;
    const sizeX = (bbox.max[0] - bbox.min[0]).toFixed(2);
    const sizeY = (bbox.max[1] - bbox.min[1]).toFixed(2);
    const sizeZ = (bbox.max[2] - bbox.min[2]).toFixed(2);
    const resolution = `${sizeX} x ${sizeY} x ${sizeZ}`;

    // Calculate coverage (ratio of visible to total points if available)
    const featureCount = metadata.properties.length;

    return {
      fileSize: formatFileSize(metadata.fileSize),
      pointCount: formatNumber(metadata.pointCount),
      resolution,
      featureCount: `${featureCount}`,
      hasColors: metadata.hasColors,
      hasOpacity: metadata.hasOpacity,
      format: metadata.format,
      properties: metadata.properties,
    };
  }, [metadata]);

  return (
    <Card className="w-full border-app-primary bg-app-card/30">
      {/* Scan Information Section */}
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-mono flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-green-400" />
          Scan Information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        <InfoRow
          label="Project"
          value={jobInfo?.projectName || 'Reconstruction Project'}
        />
        <InfoRow label="Location" value={jobInfo?.location || '--'} />
        <InfoRow
          label="Updated"
          value={jobInfo?.updatedAt || new Date().toLocaleDateString('en-GB')}
        />
        <InfoRow
          label="Status"
          value={
            <span className="flex items-center gap-1.5">
              {metadata ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                  Completed
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block animate-pulse" />
                  Processing
                </>
              )}
            </span>
          }
        />
      </CardContent>

      {/* Technical Details Section */}
      <CardHeader className="pt-0 pb-3 border-t border-app-primary">
        <CardTitle className="text-base font-mono flex items-center gap-2">
          <Monitor className="w-4 h-4 text-blue-400" />
          Technical Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 pb-4">
        {details ? (
          <div className="divide-y divide-white/5">
            <DetailRow
              icon={<HardDrive className="w-3.5 h-3.5" />}
              label="File Size"
              value={details.fileSize}
            />
            <DetailRow
              icon={<Clock className="w-3.5 h-3.5" />}
              label="Processing Time"
              value={jobInfo?.elapsedTime || '--'}
            />
            <DetailRow
              icon={<Layers className="w-3.5 h-3.5" />}
              label="Point Count"
              value={details.pointCount}
            />
            <DetailRow
              icon={<Camera className="w-3.5 h-3.5" />}
              label="Quality Preset"
              value={jobInfo?.qualityPreset || '--'}
              capitalize
            />
            <DetailRow
              icon={<Grid3X3 className="w-3.5 h-3.5" />}
              label="Feature Count"
              value={details.featureCount}
            />
            <DetailRow
              icon={<Target className="w-3.5 h-3.5" />}
              label="Bounding Box"
              value={details.resolution}
            />
            <DetailRow
              icon={<Palette className="w-3.5 h-3.5" />}
              label="Color Data"
              value={
                details.hasColors ? (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-green-400" />
                    Available
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-yellow-400" />
                    Missing
                  </span>
                )
              }
            />
            <DetailRow
              icon={<Eye className="w-3.5 h-3.5" />}
              label="Opacity Data"
              value={
                details.hasOpacity ? (
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-green-400" />
                    Available
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-yellow-400" />
                    Missing
                  </span>
                )
              }
            />
            <DetailRow
              icon={<HardDrive className="w-3.5 h-3.5" />}
              label="Format"
              value={details.format}
            />
          </div>
        ) : (
          <div className="text-center text-gray-500 text-sm py-6 font-mono">
            Load a model to see technical details
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] text-gray-500 uppercase tracking-wider font-mono block mb-0.5">
        {label}
      </span>
      <span className="text-white text-sm font-medium">{value}</span>
    </div>
  );
}

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
      <span className="text-gray-400 text-xs font-mono flex items-center gap-2">
        {icon}
        {label}
      </span>
      <span
        className={`text-white text-xs font-mono font-medium ${capitalize ? 'capitalize' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
