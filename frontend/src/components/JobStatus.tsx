import { useEffect, useState } from 'react';
import { JobStatus as JobStatusEnum, JobStatusResponse } from '../types/job';
import { getJobStatus, downloadModel } from '../api/jobs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, AlertOctagon, Download, FileBox, Clock, Settings } from 'lucide-react';

interface JobStatusProps {
  jobId: string;
  onComplete: (modelUrl: string) => void;
}

const STATUS_LABELS: Record<JobStatusEnum, string> = {
  [JobStatusEnum.UPLOADED]: 'Video uploaded',
  [JobStatusEnum.VALIDATING]: 'Validating video format',
  [JobStatusEnum.EXTRACTING_FRAMES]: 'Extracting frames from video',
  [JobStatusEnum.TRAINING]: 'Training 3D Splats (this takes time)',
  [JobStatusEnum.EXPORTING]: 'Exporting PLY model',
  [JobStatusEnum.COMPRESSING]: 'Compressing output file',
  [JobStatusEnum.COMPLETED]: 'Reconstruction Completed',
  [JobStatusEnum.ERROR]: 'Processing Error',
};

const PRESET_LABELS: Record<string, string> = {
  fast: 'Fast (~3-5 min)',
  balanced: 'Balanced (~8-12 min)',
  quality: 'Quality (~20-30 min)',
};

export default function JobStatus({ jobId, onComplete }: JobStatusProps) {
  const [status, setStatus] = useState<JobStatusEnum>(JobStatusEnum.UPLOADED);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [qualityPreset, setQualityPreset] = useState<string | null>(null);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [startTime] = useState<Date>(new Date());
  const [elapsedTime, setElapsedTime] = useState<string>('0:00');

  // Update elapsed time every second
  useEffect(() => {
    if (status === JobStatusEnum.COMPLETED || status === JobStatusEnum.ERROR) {
      return;
    }

    const timer = setInterval(() => {
      const elapsed = Math.floor((new Date().getTime() - startTime.getTime()) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      setElapsedTime(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(timer);
  }, [startTime, status]);

  // Poll job status
  useEffect(() => {
    if (status === JobStatusEnum.COMPLETED || status === JobStatusEnum.ERROR) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const response: JobStatusResponse = await getJobStatus(jobId);
        setStatus(response.status);
        setProgress(response.progress);
        setError(response.error_message || null);

        if (response.quality_preset) {
          setQualityPreset(response.quality_preset);
        }
        if (response.estimated_minutes) {
          setEstimatedMinutes(response.estimated_minutes);
        }

        if (response.status === JobStatusEnum.COMPLETED && response.model_url) {
          onComplete(response.model_url);
          clearInterval(interval);
        }
      } catch (err) {
        console.error('Error fetching job status:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [jobId, status, onComplete]);

  const handleDownload = async (compressed: boolean = false) => {
    setDownloading(true);
    try {
      const blob = await downloadModel(jobId, compressed);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = compressed ? `model_${jobId}.ply.gz` : `model_${jobId}.ply`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert('Download failed: ' + (err.response?.data?.detail || err.message));
    } finally {
      setDownloading(false);
    }
  };

  const isComplete = status === JobStatusEnum.COMPLETED;
  const isError = status === JobStatusEnum.ERROR;
  const isActive = !isComplete && !isError;

  return (
    <Card className="w-full border-app-primary bg-app-card/30 h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center">
            {isActive && <Loader2 className="w-5 h-5 mr-2 animate-spin text-blue-400" />}
            {isComplete && <CheckCircle className="w-5 h-5 mr-2 text-green-400" />}
            {isError && <AlertOctagon className="w-5 h-5 mr-2 text-red-500" />}
            Processing Status
          </CardTitle>
          {isActive && (
            <div className="font-mono text-xs text-blue-300 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20">
              Running
            </div>
          )}
        </div>
        <CardDescription>
          Job ID: <span className="font-mono text-xs opacity-70">{jobId}</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Info Grid */}
        {(qualityPreset || isActive) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 rounded-lg bg-app-elevated border border-app-secondary">
              <span className="text-gray-400 block text-xs mb-1">Status</span>
              <span className="font-medium text-white flex items-center">
                {STATUS_LABELS[status]}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-app-elevated border border-app-secondary">
              <span className="text-gray-400 block text-xs mb-1">Time Elapsed</span>
              <span className="font-mono text-white flex items-center">
                <Clock className="w-3 h-3 mr-2 opacity-50" />
                {elapsedTime}
              </span>
            </div>

            {qualityPreset && (
              <div className="p-3 rounded-lg bg-app-elevated border border-app-secondary">
                <span className="text-gray-400 block text-xs mb-1">Quality</span>
                <span className="font-medium text-white flex items-center">
                  <Settings className="w-3 h-3 mr-2 opacity-50" />
                  {PRESET_LABELS[qualityPreset] || qualityPreset}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Progress Bar */}
        {isActive && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Progress</span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-2 w-full bg-app-elevated rounded-full overflow-hidden border border-app-secondary">
              <div
                className="h-full bg-blue-500 transition-all duration-500 ease-out"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            {estimatedMinutes && (
              <p className="text-xs text-center text-gray-500 mt-2">
                Estimated total time: ~{estimatedMinutes} minutes
              </p>
            )}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start">
            <AlertOctagon className="w-5 h-5 mr-3 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Process Failed</p>
              <p className="opacity-90">{error}</p>
            </div>
          </div>
        )}

        {/* Download Actions */}
        {isComplete && (
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button
              className="flex-1"
              onClick={() => handleDownload(false)}
              disabled={downloading}
            >
              <FileBox className="w-4 h-4 mr-2" />
              Download Model (.ply)
            </Button>

            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleDownload(true)}
              disabled={downloading}
            >
              <Download className="w-4 h-4 mr-2" />
              Download (.ply.gz)
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
