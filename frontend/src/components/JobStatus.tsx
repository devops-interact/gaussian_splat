import { useEffect, useState } from 'react';
import { JobStatus as JobStatusEnum, JobStatusResponse } from '../types/job';
import { getJobStatus } from '../api/jobs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, CheckCircle, AlertOctagon, Clock, Settings } from 'lucide-react';

interface JobStatusProps {
  jobId: string;
  onComplete: (modelUrl: string, objUrl?: string) => void;
  embedded?: boolean;
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
  balanced: 'Balanced (~12 min est.)',
  quality: 'Quality (~30 min est.)',
};

export default function JobStatus({ jobId, onComplete, embedded }: JobStatusProps) {
  const [status, setStatus] = useState<JobStatusEnum>(JobStatusEnum.UPLOADED);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
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

  // Poll job status (initial fetch + interval)
  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const fetchStatus = async (): Promise<boolean> => {
      try {
        const response: JobStatusResponse = await getJobStatus(jobId);
        if (cancelled) return true;
        setStatus(response.status);
        setProgress(response.progress);
        setError(response.error_message || null);
        if (response.quality_preset) setQualityPreset(response.quality_preset);
        if (response.estimated_minutes) setEstimatedMinutes(response.estimated_minutes);
        if (response.status === JobStatusEnum.COMPLETED && response.model_url) {
          onComplete(response.model_url, response.model_url_obj ?? undefined);
          return true;
        }
      } catch (err) {
        if (!cancelled) console.error('Error fetching job status:', err);
      }
      return false;
    };
    fetchStatus().then((done) => {
      if (!done && !cancelled) {
        intervalId = setInterval(() => {
          fetchStatus().then((completed) => {
            if (completed && intervalId) clearInterval(intervalId);
          });
        }, 2000);
      }
    });
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [jobId, onComplete]);

  const isComplete = status === JobStatusEnum.COMPLETED;
  const isError = status === JobStatusEnum.ERROR;
  const isActive = !isComplete && !isError;

  const content = (
    <>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center">
            {isActive && <Loader2 className="w-5 h-5 mr-2 animate-spin text-[#efe752]" />}
            {isComplete && <CheckCircle className="w-5 h-5 mr-2 text-[#efe752]" />}
            {isError && <AlertOctagon className="w-5 h-5 mr-2 text-red-400" />}
            Processing Status
          </CardTitle>
          {isActive && (
            <div className="font-mono text-xs text-[#efe752] bg-[#efe752]/[0.08] px-2 py-1 rounded border border-[#efe752]/[0.15]">
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
            <div className="p-3 rounded-lg bg-[#08080f] border border-white/[0.06]">
              <span className="text-gray-500 block text-xs mb-1">Status</span>
              <span className="font-medium text-white flex items-center">
                {STATUS_LABELS[status]}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#08080f] border border-white/[0.06]">
              <span className="text-gray-500 block text-xs mb-1">Time Elapsed</span>
              <span className="font-mono text-white flex items-center">
                <Clock className="w-3 h-3 mr-2 text-[#efe752]/40" />
                {elapsedTime}
              </span>
            </div>

            {qualityPreset && (
              <div className="p-3 rounded-lg bg-[#08080f] border border-white/[0.06]">
                <span className="text-gray-500 block text-xs mb-1">Quality</span>
                <span className="font-medium text-white flex items-center">
                  <Settings className="w-2.5 h-2.5 mr-2 text-[#efe752]/40" />
                  {PRESET_LABELS[qualityPreset] || qualityPreset}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Progress Bar */}
        {isActive && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Progress</span>
              <span className="text-[#efe752]/70">{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-2 w-full bg-[#08080f] rounded-full overflow-hidden border border-white/[0.04]">
              <div
                className="h-full bg-gradient-to-r from-[#efe752]/60 to-[#efe752] transition-all duration-500 ease-out rounded-full"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            {estimatedMinutes && (
              <p className="text-xs text-center text-gray-600 mt-2">
                Estimated total time: ~{estimatedMinutes} minutes
              </p>
            )}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-4 rounded-lg bg-red-500/[0.06] border border-red-500/[0.12] text-red-400 text-sm flex items-start">
            <AlertOctagon className="w-5 h-5 mr-3 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Process Failed</p>
              <p className="opacity-90">{error}</p>
            </div>
          </div>
        )}
      </CardContent>
    </>
  );

  if (embedded) return content;

  return <Card className="w-full h-full">{content}</Card>;
}
