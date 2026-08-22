'use client';

import { useState, useRef, useEffect } from 'react';
import { uploadVideo, getPresets, type PresetInfo } from '../api/jobs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileVideo, AlertTriangle, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VideoUploadProps {
  onUploadSuccess: (jobId: string, scanId?: number) => void;
  /** After a job exists (processing or model ready), hide presets + upload UI; keep only video summary / messages. */
  jobStarted?: boolean;
  projectId?: number;
  scanId?: number;
  /** Allow re-running with a different preset when a job already exists */
  allowRerun?: boolean;
}

interface UploadResult {
  job_id: string;
  warnings?: string[];
  video_info?: {
    duration: number;
    resolution: string;
    fps: number;
  };
}

function formatPresetTime(minutes: number): string {
  if (minutes <= 5) return `~${minutes} min est.`;
  return `~${minutes} min est.`;
}

export default function VideoUpload({
  onUploadSuccess,
  jobStarted = false,
  projectId,
  scanId,
  allowRerun = false,
}: VideoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('balanced');
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [videoInfo, setVideoInfo] = useState<UploadResult['video_info'] | null>(null);
  const [showRerun, setShowRerun] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPresets()
      .then(setPresets)
      .catch(() => {
        setPresets([
          { id: 'fast', name: 'Fast', description: 'Quick AI mesh preview. Lower polycount.', estimated_minutes: 5 },
          { id: 'balanced', name: 'Balanced', description: 'Recommended balance of quality and speed.', estimated_minutes: 8 },
          { id: 'quality', name: 'Quality', description: 'Highest fidelity mesh with 4K textures.', estimated_minutes: 22 },
          { id: 'room', name: 'Room (beta)', description: 'Reconstructs space by zones; 4 meshes composed.', estimated_minutes: 40, composition_mode: 'zone_mesh' },
        ]);
      });
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validExtensions = ['.mp4', '.mov', '.avi', '.webm'];
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (!validExtensions.includes(ext)) {
      setError(`Please upload a video file (${validExtensions.join(', ')})`);
      return;
    }

    setError(null);
    setWarnings([]);
    if (!jobStarted) setVideoInfo(null);
    setUploading(true);

    try {
      const result = await uploadVideo(file, selectedPreset, projectId, scanId) as UploadResult & { scan_id?: number };

      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings);
      }
      if (result.video_info) {
        setVideoInfo(result.video_info);
      }

      onUploadSuccess(result.job_id, result.scan_id);
      setShowRerun(false);
    } catch (err: any) {
      console.error('Upload error:', err);
      const detail = err.response?.data?.detail;
      if (typeof detail === 'object' && detail.errors) {
        setError(detail.errors.join('; '));
        if (detail.warnings) setWarnings(detail.warnings);
      } else if (err.code === 'ERR_NETWORK') {
        setError('Network error: Cannot connect to server. Check if the backend is running.');
      } else if (err.response?.status === 413) {
        setError('File too large. Maximum size is 500MB.');
      } else if (err.response?.status >= 500) {
        setError(`Server error (${err.response?.status}): ${detail || 'Please check backend logs.'}`);
      } else {
        setError(detail || err.message || 'Upload failed. Please try again.');
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onUploadClick = () => fileInputRef.current?.click();

  const presetGrid = (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {presets.map((preset) => (
        <button
          key={preset.id}
          onClick={() => setSelectedPreset(preset.id)}
          disabled={uploading}
          className={cn(
            'flex flex-col items-start p-3 rounded-lg border text-left transition-all duration-200',
            selectedPreset === preset.id
              ? 'border-white/48 bg-white/[0.06] text-white'
              : 'border-white/[0.22] bg-neutral-950/50 text-gray-400 hover:border-white/[0.32] hover:bg-white/[0.06]',
            uploading && 'opacity-50 cursor-not-allowed',
          )}
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="font-semibold text-sm">{preset.name}</span>
            {selectedPreset === preset.id && <CheckCircle className="w-3 h-3 text-white" />}
          </div>
          <span className="text-xs opacity-70 mb-2 flex items-center">
            <Clock className="w-3 h-3 mr-1" /> {formatPresetTime(preset.estimated_minutes)}
          </span>
          <p className="text-[10px] opacity-60 leading-tight">{preset.description}</p>
          {preset.composition_mode === 'zone_mesh' && (
            <span className="mt-1 text-[9px] text-amber-400/80 uppercase tracking-wide">Multi-zone</span>
          )}
        </button>
      ))}
    </div>
  );

  const videoSummary =
    videoInfo && (
      <div className="flex items-center p-3 rounded-lg bg-white/[0.06] border border-white/48 text-neutral-300 text-sm">
        <FileVideo className="w-4 h-4 mr-2 shrink-0 text-white/80" />
        <span>
          Video: {videoInfo.duration.toFixed(1)}s • {videoInfo.resolution} • {videoInfo.fps.toFixed(1)} fps
        </span>
      </div>
    );

  const warningsBlock =
    warnings.length > 0 && (
      <div className="p-3 rounded-lg bg-yellow-500/[0.06] border border-yellow-500/[0.28] text-yellow-400 text-sm">
        <div className="flex items-center font-semibold mb-1">
          <AlertTriangle className="w-4 h-4 mr-2" />
          Warnings
        </div>
        <ul className="list-disc list-inside space-y-1 ml-5 opacity-90 text-xs">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </div>
    );

  const errorBlock =
    error && (
      <div className="p-3 rounded-lg bg-red-500/[0.06] border border-red-500/28 text-red-400 text-sm flex items-center">
        <AlertTriangle className="w-4 h-4 mr-2 shrink-0" />
        {error}
      </div>
    );

  if (jobStarted && !showRerun) {
    return (
      <div className="w-full space-y-3">
        {videoSummary}
        {warningsBlock}
        {errorBlock}
        {allowRerun && (
          <Button variant="outline" size="sm" onClick={() => setShowRerun(true)} className="w-full">
            <RefreshCw className="w-3.5 h-3.5 mr-2" />
            Re-run with different preset
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card className="w-full h-full">
      <CardHeader>
        <CardTitle>{jobStarted ? 'Re-run Scan' : 'New Project'}</CardTitle>
        <CardDescription>
          {jobStarted ? 'Upload a new video or change preset' : 'Upload a video to start 3D reconstruction'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">Quality Preset</label>
          {presetGrid}
        </div>

        <div
          className={cn(
            'border-2 border-dashed rounded-xl p-5 flex flex-col items-center justify-center text-center transition-all',
            'border-white/[0.22] bg-neutral-950/40 hover:bg-white/[0.08] hover:border-white/[0.38]',
            uploading && 'opacity-50 pointer-events-none',
          )}
        >
          <div className="w-10 h-10 rounded-full bg-neutral-950 flex items-center justify-center mb-3 border border-white/[0.18]">
            <Upload className="w-5 h-5 text-gray-400" />
          </div>
          <p className="text-xs text-gray-400 mb-4">MP4, MOV, AVI, WEBM — Max 500MB</p>
          <Button onClick={onUploadClick} disabled={uploading} loading={uploading} className="w-full">
            {uploading ? 'Uploading...' : 'Select Video File'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov,.avi,.webm"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {videoSummary}
        {warningsBlock}
        {errorBlock}
      </CardContent>
    </Card>
  );
}
