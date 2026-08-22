import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { JobStatus as JobStatusEnum, JobStatusResponse, type ModelMetadataResponse } from '../types/job';
import { getJobStatus } from '../api/jobs';
import { getApiBaseUrl } from '@/lib/apiBase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, CheckCircle, AlertOctagon, AlertTriangle, RefreshCw } from 'lucide-react';

interface JobStatusProps {
  jobId: string;
  onComplete: (
    modelUrl: string,
    objUrl?: string,
    modelMetadata?: ModelMetadataResponse,
    extras?: {
      keyframes?: import('../types/job').KeyframeInfo[];
      scene_manifest?: import('../types/job').SceneManifestResponse;
      processing_time_seconds?: number;
      meshy_task_id?: string;
      quality_preset?: string;
      total_zones?: number;
    },
  ) => void;
  /** Mirrors `quality_preset` from each successful status poll (null when job id changes, before first poll). */
  onQualityPresetChange?: (preset: string | null) => void;
  onElapsedTimeChange?: (elapsed: string) => void;
  embedded?: boolean;
}

const STATUS_LABELS: Record<JobStatusEnum, string> = {
  [JobStatusEnum.UPLOADED]: 'Video uploaded',
  [JobStatusEnum.VALIDATING]: 'Validating video format',
  [JobStatusEnum.EXTRACTING_FRAMES]: 'Extracting frames from video',
  [JobStatusEnum.SELECTING_KEYFRAMES]: 'Selecting best keyframes',
  [JobStatusEnum.SUBMITTING_RECONSTRUCTION]: 'Submitting to Meshy AI',
  [JobStatusEnum.RECONSTRUCTING]: 'AI reconstructing 3D mesh',
  [JobStatusEnum.DOWNLOADING_MODEL]: 'Downloading model',
  [JobStatusEnum.COMPOSING_SCENE]: 'Composing room scene',
  [JobStatusEnum.COMPLETED]: 'Completed',
  [JobStatusEnum.ERROR]: 'Processing Error',
};

const PRESET_LABELS: Record<string, string> = {
  fast: 'Fast (~5 min est.)',
  balanced: 'Balanced (~8 min est.)',
  quality: 'Quality (~22 min est.)',
  room: 'Room beta (~40 min est.)',
};

const POLL_OK_MS = 2000;
const POLL_BACKOFF_CAP_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function backoffMsAfterFailure(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return POLL_OK_MS;
  return Math.min(POLL_BACKOFF_CAP_MS, POLL_OK_MS * 2 ** (consecutiveFailures - 1));
}

function isActivePipelineStatus(s: JobStatusEnum): boolean {
  return s !== JobStatusEnum.COMPLETED && s !== JobStatusEnum.ERROR;
}

function jobNotFoundMessage(): string {
  return (
    'Job not found (HTTP 404). The API has no record for this job id — often after a redeploy ' +
    'without persistent storage. Ensure the API volume is mounted at /app/backend/storage.'
  );
}

function networkPollWarning(failures: number): string {
  const apiBase = getApiBaseUrl() || '(same-origin /api via Railway frontend)';
  return (
    `Cannot reach the job API (${failures} failed poll${failures === 1 ? '' : 's'}). ` +
    'Verify the Railway API service is running and the frontend BACKEND_URL is correct. ' +
    `Check: curl ${apiBase === '(same-origin /api via Railway frontend)' ? 'https://YOUR-API.up.railway.app' : apiBase}/health . ` +
    'Polling continues in case reconstruction is still running.'
  );
}

export default function JobStatus({ jobId, onComplete, onQualityPresetChange, onElapsedTimeChange, embedded }: JobStatusProps) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onQualityPresetChangeRef = useRef(onQualityPresetChange);
  onQualityPresetChangeRef.current = onQualityPresetChange;
  const onElapsedTimeChangeRef = useRef(onElapsedTimeChange);
  onElapsedTimeChangeRef.current = onElapsedTimeChange;
  /** Avoid calling onComplete again when the poll effect restarts (e.g. parent re-render); resets when jobId changes. */
  const completionNotifiedForJobIdRef = useRef<string | null>(null);

  const [status, setStatus] = useState<JobStatusEnum>(JobStatusEnum.UPLOADED);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Fatal: job record missing (404) — polling stopped. */
  const [connectError, setConnectError] = useState<string | null>(null);
  /** Non-fatal: transient network/proxy failure — polling continues. */
  const [connectWarning, setConnectWarning] = useState<string | null>(null);
  const [pollSession, setPollSession] = useState(0);
  const [qualityPreset, setQualityPreset] = useState<string | null>(null);
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null);
  const [currentZone, setCurrentZone] = useState<number | null>(null);
  const [totalZones, setTotalZones] = useState<number | null>(null);
  const [zoneErrors, setZoneErrors] = useState<Record<string, string> | null>(null);
  const [zonesCompleted, setZonesCompleted] = useState<number | null>(null);
  const [startTime] = useState<Date>(new Date());
  const [elapsedTime, setElapsedTime] = useState<string>('0:00');

  const handleRetryConnection = useCallback(() => {
    setConnectError(null);
    setConnectWarning(null);
    setPollSession((s) => s + 1);
  }, []);

  // Update elapsed time every second
  useEffect(() => {
    if (status === JobStatusEnum.COMPLETED || status === JobStatusEnum.ERROR || connectError) {
      return;
    }

    const timer = setInterval(() => {
      const elapsed = Math.floor((new Date().getTime() - startTime.getTime()) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      setElapsedTime(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      onElapsedTimeChangeRef.current?.(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(timer);
  }, [startTime, status, connectError]);

  // New job id: clear local preset and parent Metadata row until the next poll.
  useEffect(() => {
    setQualityPreset(null);
    setConnectError(null);
    setConnectWarning(null);
    onQualityPresetChangeRef.current?.(null);
  }, [jobId]);

  // Poll job status: keep retrying on network errors (35–70 min jobs); stop only on 404 or terminal status.
  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    void (async () => {
      let consecutiveFailures = 0;
      while (!cancelled && !ac.signal.aborted) {
        try {
          const response: JobStatusResponse = await getJobStatus(jobId, { signal: ac.signal });
          if (cancelled) return;
          consecutiveFailures = 0;
          setConnectWarning(null);
          setConnectError(null);
          setStatus(response.status);
          setProgress(response.progress);
          setError(response.error_message || null);
          if (response.quality_preset) {
            setQualityPreset(response.quality_preset);
            onQualityPresetChangeRef.current?.(response.quality_preset);
          }
          if (response.estimated_minutes) setEstimatedMinutes(response.estimated_minutes);
          if (response.current_zone != null) setCurrentZone(response.current_zone);
          if (response.total_zones != null) setTotalZones(response.total_zones);
          if (response.scene_manifest?.zone_errors) {
            setZoneErrors(response.scene_manifest.zone_errors);
          }
          if (response.scene_manifest?.zone_count != null) {
            setZonesCompleted(response.scene_manifest.zone_count);
          }
          if (
            response.status === JobStatusEnum.COMPLETED &&
            (response.model_url || (response.scene_manifest?.zones?.length ?? 0) > 0)
          ) {
            if (completionNotifiedForJobIdRef.current !== jobId) {
              completionNotifiedForJobIdRef.current = jobId;
              onCompleteRef.current(
                response.model_url ?? '',
                response.model_url_obj ?? undefined,
                response.model_metadata,
                {
                  keyframes: response.keyframes,
                  scene_manifest: response.scene_manifest,
                  processing_time_seconds: response.processing_time_seconds,
                  meshy_task_id: response.meshy_task_id,
                  quality_preset: response.quality_preset,
                  total_zones: response.total_zones,
                },
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

          if (code === 404) {
            if (!cancelled) setConnectError(jobNotFoundMessage());
            return;
          }

          // Network / 524 / CORS-blocked gateway errors: warn but keep polling while job may still run.
          if (!cancelled) {
            setConnectWarning(networkPollWarning(consecutiveFailures));
          }
          await sleep(backoffMsAfterFailure(consecutiveFailures));
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [jobId, pollSession]);

  const isComplete = status === JobStatusEnum.COMPLETED;
  const isError = status === JobStatusEnum.ERROR;
  const isPollFatal = connectError != null;
  const isActive = !isComplete && !isError && !isPollFatal;

  const content = (
    <>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center">
            {isComplete && <CheckCircle className="w-5 h-5 mr-2 text-white" />}
            {(isError || isPollFatal) && <AlertOctagon className="w-5 h-5 mr-2 text-red-400" />}
            {connectWarning && !isPollFatal && !isComplete && (
              <AlertTriangle className="w-5 h-5 mr-2 text-amber-400" />
            )}
            Processing Status
          </CardTitle>
          {(isActive || connectWarning) && !isPollFatal && (
            <span className="flex items-center gap-1.5 text-[10px] text-neutral-300 bg-neutral-300/[0.08] px-2 py-0.5 rounded border border-neutral-300/[0.19]">
              <Loader2 className="w-3 h-3 animate-spin" />
              {connectWarning ? 'Reconnecting…' : 'Processing'}
            </span>
          )}
        </div>
        <CardDescription>
          Job ID: <span className="text-xs opacity-70">{jobId}</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Info Grid */}
        {(qualityPreset || isActive || connectWarning) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3 rounded-lg bg-neutral-950 border border-white/[0.18]">
              <span className="text-gray-500 block text-xs mb-1">Status</span>
              <span className="text-xs font-medium text-white flex items-center">
                {STATUS_LABELS[status]}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-neutral-950 border border-white/[0.18]">
              <span className="text-gray-500 block text-xs mb-1">Elapsed</span>
              <span className="text-xs text-white">{elapsedTime}</span>
            </div>

            {qualityPreset && (
              <div className="p-3 rounded-lg bg-neutral-950 border border-white/[0.18]">
                <span className="text-gray-500 block text-xs mb-1">Quality</span>
                <span className="text-xs font-medium text-white">
                  {PRESET_LABELS[qualityPreset] || qualityPreset}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Progress Bar */}
        {(isActive || connectWarning) && !isPollFatal && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Progress</span>
              <span className="text-white/70">{Math.round(progress * 100)}%</span>
            </div>
            <div className="h-2 w-full bg-neutral-950 rounded-full overflow-hidden border border-white/[0.20]">
              <div
                className="h-full bg-gradient-to-r from-white/60 to-white transition-all duration-500 ease-out rounded-full"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            {estimatedMinutes && (
              <p className="text-xs text-center text-gray-600 mt-2">
                Estimated total time: ~{estimatedMinutes} minutes
                {totalZones != null && totalZones > 1 && currentZone != null && (
                  <span className="block text-gray-500 mt-0.5">
                    Zone {currentZone + 1} of {totalZones}
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {/* Transient network / 524 — polling continues */}
        {connectWarning && !connectError && (
          <div className="p-4 rounded-lg bg-amber-500/[0.06] border border-amber-500/28 text-amber-200 text-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
              <div className="flex-1 space-y-2">
                <p className="font-semibold text-amber-100">Connection interrupted</p>
                <p className="opacity-90 leading-relaxed text-amber-100/85">{connectWarning}</p>
                {isActivePipelineStatus(status) && (
                  <p className="text-xs text-amber-100/60">
                    Last known step: {STATUS_LABELS[status]}. Reconstruction may still be running on Railway.
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleRetryConnection}
                  className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded border border-amber-500/40 text-amber-100 text-xs hover:bg-amber-500/10 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> Retry connection
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fatal: job record missing (404) */}
        {connectError && (
          <div className="p-4 rounded-lg bg-red-500/[0.06] border border-red-500/28 text-red-400 text-sm">
            <div className="flex items-start gap-3">
              <AlertOctagon className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p className="font-semibold mb-1">Cannot reach job status</p>
                <p className="opacity-90 leading-relaxed">{connectError}</p>
                <button
                  type="button"
                  onClick={handleRetryConnection}
                  className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-1 rounded border border-red-500/40 text-red-300 text-xs hover:bg-red-500/10 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> Retry connection
                </button>
              </div>
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

        {/* Partial zone failures on completed room jobs */}
        {isComplete && zoneErrors && Object.keys(zoneErrors).length > 0 && (
          <div className="p-4 rounded-lg bg-amber-500/[0.06] border border-amber-500/28 text-amber-200 text-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
              <div>
                <p className="font-semibold text-amber-100 mb-1">Some zones failed</p>
                <p className="opacity-90 text-xs mb-2">
                  {zonesCompleted ?? '?'} of {totalZones ?? '?'} zones reconstructed successfully.
                </p>
                <ul className="space-y-1 text-xs opacity-90">
                  {Object.entries(zoneErrors).map(([zoneId, msg]) => (
                    <li key={zoneId}>
                      Zone {Number(zoneId) + 1}: {msg}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </>
  );

  if (embedded) return content;

  return <Card className="w-full h-full">{content}</Card>;
}
