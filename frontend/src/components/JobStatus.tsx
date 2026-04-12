import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { JobStatus as JobStatusEnum, JobStatusResponse, type ModelMetadataResponse } from '../types/job';
import { getJobStatus } from '../api/jobs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, CheckCircle, AlertOctagon } from 'lucide-react';

interface JobStatusProps {
  jobId: string;
  onComplete: (modelUrl: string, objUrl?: string, modelMetadata?: ModelMetadataResponse) => void;
  embedded?: boolean;
}

const STATUS_LABELS: Record<JobStatusEnum, string> = {
  [JobStatusEnum.UPLOADED]: 'Video uploaded',
  [JobStatusEnum.VALIDATING]: 'Validating video format',
  [JobStatusEnum.EXTRACTING_FRAMES]: 'Extracting frames from video',
  [JobStatusEnum.TRAINING]: 'Training 3D Splats (this takes time)',
  [JobStatusEnum.EXPORTING]: 'Exporting PLY model',
  [JobStatusEnum.COMPRESSING]: 'Compressing output file',
  [JobStatusEnum.COMPLETED]: 'Completed',
  [JobStatusEnum.ERROR]: 'Processing Error',
};

const PRESET_LABELS: Record<string, string> = {
  balanced: 'Balanced (~12 min est.)',
  quality: 'Quality (~30 min est.)',
};

const POLL_OK_MS = 2000;
const POLL_BACKOFF_CAP_MS = 30_000;
const MAX_CONSECUTIVE_POLL_FAILURES = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function backoffMsAfterFailure(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return POLL_OK_MS;
  return Math.min(POLL_BACKOFF_CAP_MS, POLL_OK_MS * 2 ** (consecutiveFailures - 1));
}

export default function JobStatus({ jobId, onComplete, embedded }: JobStatusProps) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  /** Avoid calling onComplete again when the poll effect restarts (e.g. parent re-render); resets when jobId changes. */
  const completionNotifiedForJobIdRef = useRef<string | null>(null);

  const [status, setStatus] = useState<JobStatusEnum>(JobStatusEnum.UPLOADED);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [qualityPreset, setQualityPreset] = useState<string | null>(null);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [startTime] = useState<Date>(new Date());
  const [elapsedTime, setElapsedTime] = useState<string>('0:00');

  // Update elapsed time every second
  useEffect(() => {
    if (
      status === JobStatusEnum.COMPLETED ||
      status === JobStatusEnum.ERROR ||
      connectError
    ) {
      return;
    }

    const timer = setInterval(() => {
      const elapsed = Math.floor((new Date().getTime() - startTime.getTime()) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      setElapsedTime(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(timer);
  }, [startTime, status, connectError]);

  // Poll job status: fixed interval after success, exponential backoff after failures; stop on 404 or cap.
  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    const failMessage = (code: number | undefined, failures: number): string => {
      if (code === 404) {
        return (
          'Job not found (HTTP 404). The API has no record for this job id — often after a pod restart without ' +
          'persistent storage, a changed RunPod URL, or the worker never saw this id. Check RunPod volume mount ' +
          'for /app/storage and that the same API base URL is used for the whole run.'
        );
      }
      return (
        `Lost contact with the job API after ${failures} failed attempts (${code ?? 'network'}). ` +
        'The worker may be stopped, unreachable, or returning errors. Check RunPod uptime and your API URL.'
      );
    };

    void (async () => {
      let consecutiveFailures = 0;
      while (!cancelled && !ac.signal.aborted) {
        try {
          const response: JobStatusResponse = await getJobStatus(jobId, { signal: ac.signal });
          if (cancelled) return;
          consecutiveFailures = 0;
          setConnectError(null);
          setStatus(response.status);
          setProgress(response.progress);
          setError(response.error_message || null);
          if (response.quality_preset) setQualityPreset(response.quality_preset);
          if (response.estimated_minutes) setEstimatedMinutes(response.estimated_minutes);
          if (response.status === JobStatusEnum.COMPLETED && response.model_url) {
            if (completionNotifiedForJobIdRef.current !== jobId) {
              completionNotifiedForJobIdRef.current = jobId;
              onCompleteRef.current(
                response.model_url,
                response.model_url_obj ?? undefined,
                response.model_metadata,
              );
            }
            return;
          }
          if (response.status === JobStatusEnum.ERROR) {
            return;
          }
          await sleep(POLL_OK_MS);
        } catch (err) {
          if (cancelled) return;
          if (axios.isAxiosError(err) && err.code === 'ERR_CANCELED') return;
          const code = axios.isAxiosError(err) ? err.response?.status : undefined;
          consecutiveFailures += 1;
          console.error('Error fetching job status:', err);
          if (code === 404 || consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
            if (!cancelled) setConnectError(failMessage(code, consecutiveFailures));
            return;
          }
          await sleep(backoffMsAfterFailure(consecutiveFailures));
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [jobId]);

  const isComplete = status === JobStatusEnum.COMPLETED;
  const isError = status === JobStatusEnum.ERROR;
  const isPollFatal = connectError != null;
  const isActive = !isComplete && !isError && !isPollFatal;

  const content = (
    <>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center">
            {isComplete && <CheckCircle className="w-5 h-5 mr-2 text-[#efe752]" />}
            {(isError || isPollFatal) && <AlertOctagon className="w-5 h-5 mr-2 text-red-400" />}
            Processing Status
          </CardTitle>
          {isActive && (
            <span className="flex items-center gap-1.5 text-[10px] font-mono text-[#f5ec99] bg-[#f5ec99]/[0.08] px-2 py-0.5 rounded border border-[#f5ec99]/[0.19]">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing
            </span>
          )}
        </div>
        <CardDescription>
          Job ID: <span className="font-mono text-xs opacity-70">{jobId}</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Info Grid */}
        {(qualityPreset || isActive) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-black border border-white/[0.18]">
              <span className="text-gray-500 block text-xs mb-1">Status</span>
              <span className="text-xs font-medium text-white flex items-center">
                {STATUS_LABELS[status]}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-black border border-white/[0.18]">
              <span className="text-gray-500 block text-xs mb-1">Elapsed</span>
              <span className="text-xs font-mono text-white">{elapsedTime}</span>
            </div>

            {qualityPreset && (
              <div className="p-3 rounded-lg bg-black border border-white/[0.18]">
                <span className="text-gray-500 block text-xs mb-1">Quality</span>
                <span className="text-xs font-medium text-white">
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
            <div className="h-2 w-full bg-black rounded-full overflow-hidden border border-white/[0.20]">
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

        {/* Lost API / job record (polling stopped) */}
        {connectError && (
          <div className="p-4 rounded-lg bg-red-500/[0.06] border border-red-500/28 text-red-400 text-sm flex items-start">
            <AlertOctagon className="w-5 h-5 mr-3 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Cannot reach job status</p>
              <p className="opacity-90 leading-relaxed">{connectError}</p>
            </div>
          </div>
        )}

        {/* Pipeline error from server */}
        {error && !connectError && (
          <div className="p-4 rounded-lg bg-red-500/[0.06] border border-red-500/15 text-red-400 text-sm flex items-start">
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
