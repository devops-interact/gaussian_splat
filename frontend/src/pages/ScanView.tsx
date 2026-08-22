'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import VideoUpload from '@/components/VideoUpload';
import JobStatus from '@/components/JobStatus';
import Viewer3D from '@/components/Viewer3D';
import TechnicalDetails from '@/components/TechnicalDetails';
import KeyframeStrip from '@/components/KeyframeStrip';
import type { ModelMetadata } from '@/components/Viewer3D';
import type { ModelMetadataResponse, KeyframeInfo, SceneManifestResponse } from '@/types/job';
import { Card, CardContent } from '@/components/ui/card';
import { Box, Download, ChevronDown, FileBox, FileCode, ArrowLeft } from 'lucide-react';
import { downloadModel, getJobStatus, getSceneManifest } from '@/api/jobs';
import { getScan } from '@/api/scans';
import { JobStatus as JobStatusEnum } from '@/types/job';
import { getApiBaseUrl } from '@/lib/apiBase';

export default function ScanView() {
  const { projectId, scanId } = useParams<{ projectId: string; scanId: string }>();
  const navigate = useNavigate();
  const projectIdNum = projectId ? parseInt(projectId, 10) : 0;
  const isNewScan = scanId === 'new';

  const [scan, setScan] = useState<{ id: number; job_id: string | null } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [modelMetadata, setModelMetadata] = useState<ModelMetadata | null>(null);
  const [prefetchedJobModelMetadata, setPrefetchedJobModelMetadata] = useState<ModelMetadataResponse | null>(null);
  const [keyframes, setKeyframes] = useState<KeyframeInfo[]>([]);
  const [sceneManifest, setSceneManifest] = useState<SceneManifestResponse | null>(null);
  const [jobQualityPreset, setJobQualityPreset] = useState<string | null>(null);
  const [processingTimeSeconds, setProcessingTimeSeconds] = useState<number | null>(null);
  const [meshyTaskId, setMeshyTaskId] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>('--');
  const [viewerZoneWarning, setViewerZoneWarning] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadRef = useRef<HTMLDivElement>(null);

  const resolveSceneManifest = useCallback(async (
    manifest: SceneManifestResponse | null | undefined,
    totalZones?: number | null,
  ): Promise<SceneManifestResponse | null> => {
    if (!jobId) return manifest ?? null;
    const zoneCount = manifest?.zones?.length ?? 0;
    const needsFallback = zoneCount === 0 || (totalZones != null && totalZones > 0 && zoneCount < totalZones);
    if (!needsFallback) return manifest ?? null;
    try {
      return await getSceneManifest(jobId);
    } catch {
      return manifest ?? null;
    }
  }, [jobId]);

  // Load existing scan or create placeholder for new
  useEffect(() => {
    if (!projectIdNum) return;
    if (isNewScan) {
      setScan(null);
      setJobId(null);
      setJobQualityPreset(null);
      return;
    }
    const sid = parseInt(scanId!, 10);
    getScan(projectIdNum, sid)
      .then((s) => {
        setScan(s);
        setJobId(s.job_id || null);
      })
      .catch(() => setScan(null));
  }, [projectIdNum, scanId, isNewScan]);

  // Hydrate viewer for completed jobs on page reload
  useEffect(() => {
    if (!jobId || modelUrl || sceneManifest?.zones?.length) return;
    let cancelled = false;
    getJobStatus(jobId)
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === JobStatusEnum.COMPLETED && (response.model_url || response.scene_manifest?.zones?.length)) {
          const manifest = await resolveSceneManifest(
            response.scene_manifest,
            response.total_zones,
          );
          if (cancelled) return;
          const isRoomScene = (manifest?.zones?.length ?? 0) > 0;
          if (!isRoomScene && response.model_url) setModelUrl(response.model_url);
          else setModelUrl('');
          setObjUrl(response.model_url_obj ?? null);
          setPrefetchedJobModelMetadata(response.model_metadata ?? null);
          setKeyframes(response.keyframes ?? []);
          setSceneManifest(manifest);
          if (response.quality_preset) setJobQualityPreset(response.quality_preset);
          if (response.processing_time_seconds) setProcessingTimeSeconds(response.processing_time_seconds);
          if (response.meshy_task_id) setMeshyTaskId(response.meshy_task_id);
        }
      })
      .catch(() => { /* JobStatus component will retry */ });
    return () => {
      cancelled = true;
    };
  }, [jobId, modelUrl, sceneManifest?.zones?.length, resolveSceneManifest]);

  useEffect(() => {
    if (!downloadOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
        setDownloadOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [downloadOpen]);

  const handleProcessingComplete = useCallback(
    async (url: string, objUrlResp?: string, jobMeta?: ModelMetadataResponse, statusExtras?: {
      keyframes?: KeyframeInfo[];
      scene_manifest?: SceneManifestResponse;
      processing_time_seconds?: number;
      meshy_task_id?: string;
      quality_preset?: string;
      total_zones?: number;
    }) => {
      const manifest = await resolveSceneManifest(
        statusExtras?.scene_manifest,
        statusExtras?.total_zones,
      );
      const isRoomScene = (manifest?.zones?.length ?? 0) > 0;
      if (isRoomScene) {
        setModelUrl('');
      } else {
        setModelUrl(url);
      }
      setObjUrl(objUrlResp ?? null);
      setPrefetchedJobModelMetadata(jobMeta ?? null);
      if (statusExtras?.keyframes) setKeyframes(statusExtras.keyframes);
      setSceneManifest(manifest);
      if (statusExtras?.processing_time_seconds) setProcessingTimeSeconds(statusExtras.processing_time_seconds);
      if (statusExtras?.meshy_task_id) setMeshyTaskId(statusExtras.meshy_task_id);
      if (statusExtras?.quality_preset) setJobQualityPreset(statusExtras.quality_preset);
    },
    [resolveSceneManifest],
  );

  const handleModelMetadata = useCallback((meta: ModelMetadata) => {
    setModelMetadata(meta);
  }, []);

  const handleDownload = async () => {
    if (!jobId) return;
    setDownloading(true);
    setDownloadOpen(false);
    try {
      const blob = await downloadModel(jobId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `model_${jobId}.glb`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  const handleObjDownload = () => {
    if (!objUrl) return;
    setDownloadOpen(false);
    const apiBase = getApiBaseUrl();
    const fullUrl = objUrl.startsWith('http') ? objUrl : `${apiBase}${objUrl}`;
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = `model_${jobId}.obj`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleUploadSuccess = (newJobId: string, scanIdFromResponse?: number) => {
    setJobId(newJobId);
    setModelUrl(null);
    setObjUrl(null);
    setModelMetadata(null);
    setPrefetchedJobModelMetadata(null);
    setKeyframes([]);
    setSceneManifest(null);
    setJobQualityPreset(null);
    setProcessingTimeSeconds(null);
    setMeshyTaskId(null);
    if (scanIdFromResponse && isNewScan && projectId) {
      setScan({ id: scanIdFromResponse, job_id: newJobId });
      navigate(`/projects/${projectId}/scans/${scanIdFromResponse}`, { replace: true });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/projects/${projectId}`)}
            className="p-2 rounded-lg border border-white/[0.22] hover:bg-white/[0.04] text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white mb-1">
              3D Reconstruction
            </h2>
            <p className="text-gray-600 text-sm max-w-2xl">
              Upload video scans to generate AI-reconstructed 3D meshes via Meshy.
            </p>
            <p className="text-gray-700 text-xs max-w-2xl mt-1">
              Use <strong>Room — full space</strong> for walkthrough videos (multi-zone). Object presets produce a single mesh.
            </p>
            {jobQualityPreset && (
              <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded border uppercase tracking-wide ${
                (sceneManifest?.zones?.length ?? 0) > 0
                  ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                  : 'text-white/50 border-white/20 bg-white/5'
              }`}>
                {                (sceneManifest?.shell_url || sceneManifest?.composition_mode === 'room_shell' || (sceneManifest?.zones?.length ?? 0) > 0)
                  ? sceneManifest?.shell_url
                    ? `Room shell${(sceneManifest?.zones?.length ?? 0) > 0 ? ` · ${sceneManifest.zones.length} detail` : ''}`
                    : `Room · ${sceneManifest?.zones?.length ?? 0} zones`
                  : `Single object · ${jobQualityPreset}`}
              </span>
            )}
            {viewerZoneWarning && (
              <p className="text-amber-400/90 text-xs mt-2">{viewerZoneWarning}</p>
            )}
            {sceneManifest?.zone_errors && Object.keys(sceneManifest.zone_errors).length > 0 && (
              <p className="text-amber-400/90 text-xs mt-2">
                {sceneManifest.shell_url ? (
                  <>
                    Room envelope loaded
                    {(sceneManifest.zone_count ?? sceneManifest.zones?.length ?? 0) > 0
                      ? ` · ${sceneManifest.zone_count ?? sceneManifest.zones?.length} optional detail mesh(es)`
                      : ''}
                    .
                  </>
                ) : (
                  <>
                    Partial reconstruction: {sceneManifest.zone_count ?? sceneManifest.zones?.length} zones loaded.
                  </>
                )}
                {Object.entries(sceneManifest.zone_errors).map(([zid, msg]) => (
                  <span key={zid} className="block text-amber-400/70">
                    Zone {Number(zid) + 1}: {msg}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>

        {modelUrl && jobId && (
          <div className="relative flex-shrink-0" ref={downloadRef}>
            <button
              onClick={() => setDownloadOpen(!downloadOpen)}
              disabled={downloading}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/[0.1] text-white border border-white/40 hover:bg-white/[0.18] hover:border-white/55 transition-all duration-200 text-sm font-medium disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${downloadOpen ? 'rotate-180' : ''}`} />
            </button>

            {downloadOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-neutral-950 border border-white/[0.22] shadow-2xl shadow-black/50 backdrop-blur-xl z-50 overflow-hidden">
                <div className="p-1.5">
                  <button
                    onClick={() => handleDownload()}
                    disabled={downloading}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors group"
                  >
                    <FileBox className="w-4 h-4 text-white/50 group-hover:text-white" />
                    <div>
                      <span className="block text-white/80 group-hover:text-white">.glb</span>
                      <span className="block text-[10px] text-white/30">Textured mesh</span>
                    </div>
                  </button>
                  {objUrl && (
                    <button
                      onClick={handleObjDownload}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors group"
                    >
                      <FileCode className="w-4 h-4 text-amber-400/50 group-hover:text-amber-400" />
                      <div>
                        <span className="block text-white/80 group-hover:text-white">.obj</span>
                        <span className="block text-[10px] text-white/30">Wavefront OBJ</span>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
        <div className="w-full lg:w-2/3 flex-shrink-0">
          {modelUrl || sceneManifest?.zones?.length ? (
            <div className="rounded-xl overflow-hidden border border-white/[0.26] bg-neutral-950 h-[400px] sm:h-[520px] lg:h-[calc(100vh-160px)] shadow-2xl shadow-white/[0.03]">
              <Viewer3D
                modelUrl={modelUrl}
                jobId={jobId}
                prefetchedJobModelMetadata={prefetchedJobModelMetadata}
                sceneManifest={sceneManifest}
                onModelMetadata={handleModelMetadata}
                onZoneLoadWarning={setViewerZoneWarning}
              />
            </div>
          ) : (
            <Card className="h-[300px] sm:h-[400px] lg:h-[calc(100vh-160px)] flex items-center justify-center border-dashed border-2 border-white/[0.22] bg-neutral-950">
              <CardContent className="text-center text-gray-600">
                <div className="w-16 h-16 rounded-2xl bg-neutral-950/50 flex items-center justify-center mx-auto mb-4 border border-white/[0.18]">
                  <Box className="w-8 h-8 text-gray-700" />
                </div>
                <h3 className="text-base font-medium text-gray-500 mb-1">3D Viewer</h3>
                <p className="text-sm text-gray-600 max-w-xs mx-auto">
                  Upload a video to start reconstruction. Your 3D model will appear here.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="w-full lg:w-1/3 flex flex-col gap-4 lg:max-h-[calc(100vh-160px)] lg:overflow-y-auto scrollbar-thin">
          <VideoUpload
            onUploadSuccess={handleUploadSuccess}
            jobStarted={!!jobId}
            allowRerun
            projectId={projectIdNum}
            scanId={isNewScan ? undefined : scan?.id}
          />

          {keyframes.length > 0 && (
            <Card className="w-full p-4">
              <KeyframeStrip keyframes={keyframes} embedded />
            </Card>
          )}

          <Card className="w-full">
            {jobId ? (
              <JobStatus
                jobId={jobId}
                onComplete={handleProcessingComplete}
                onQualityPresetChange={setJobQualityPreset}
                onElapsedTimeChange={setElapsedTime}
                embedded
              />
            ) : (
              <div className="p-6 text-center text-gray-600">
                <p className="text-sm">No active job</p>
                <p className="text-xs text-gray-700 mt-1">Upload a video to start processing</p>
              </div>
            )}

            <div className="border-t border-white/[0.20] mx-4" />

            <TechnicalDetails
              metadata={modelMetadata}
              jobInfo={{
                qualityPreset: jobQualityPreset ?? undefined,
                elapsedTime,
                isProcessing: !!jobId && modelUrl === null && !sceneManifest?.zones?.length,
                meshyTaskId: meshyTaskId ?? prefetchedJobModelMetadata?.meshy_task_id,
                thumbnailUrl: prefetchedJobModelMetadata?.thumbnail_url,
                processingTimeSeconds: processingTimeSeconds ?? undefined,
              }}
              embedded
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
