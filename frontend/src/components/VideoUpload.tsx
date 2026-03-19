import { useState, useRef } from 'react';
import { uploadVideo } from '../api/jobs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileVideo, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// Quality preset definitions
const PRESETS = [
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Good quality (~15-25 min). Recommended for most videos.',
    time: '15-25 min'
  },
  {
    id: 'quality',
    name: 'Quality',
    description: 'Best quality (~30-45 min). For production renders.',
    time: '30-45 min'
  }
];

interface VideoUploadProps {
  onUploadSuccess: (jobId: string, scanId?: number) => void;
  disabled?: boolean;
  projectId?: number;
  scanId?: number;
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

export default function VideoUpload({ onUploadSuccess, disabled, projectId, scanId }: VideoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('balanced');
  const [videoInfo, setVideoInfo] = useState<UploadResult['video_info'] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validExtensions = ['.mp4', '.mov', '.avi', '.webm'];
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (!validExtensions.includes(ext)) {
      setError(`Please upload a video file (${validExtensions.join(', ')})`);
      return;
    }

    setError(null);
    setWarnings([]);
    setVideoInfo(null);
    setUploading(true);

    try {
      const result = await uploadVideo(file, selectedPreset, projectId, scanId) as UploadResult & { scan_id?: number };

      // Show warnings if any
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings);
      }

      // Show video info
      if (result.video_info) {
        setVideoInfo(result.video_info);
      }

      onUploadSuccess(result.job_id, result.scan_id);
    } catch (err: any) {
      console.error('Upload error:', err);

      // Handle validation errors
      const detail = err.response?.data?.detail;
      if (typeof detail === 'object' && detail.errors) {
        setError(detail.errors.join('; '));
        if (detail.warnings) {
          setWarnings(detail.warnings);
        }
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
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const onUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <Card className="w-full h-full">
      <CardHeader>
        <CardTitle>New Project</CardTitle>
        <CardDescription>Upload a video to start 3D reconstruction</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Presets */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">Quality Preset</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setSelectedPreset(preset.id)}
                disabled={disabled || uploading}
                className={cn(
                  "flex flex-col items-start p-3 rounded-lg border text-left transition-all duration-200",
                  selectedPreset === preset.id
                    ? "border-[#7c3aed]/25 bg-[#7c3aed]/[0.06] text-[#7c3aed]"
                    : "border-white/[0.06] bg-[#08080f]/50 text-gray-400 hover:border-[#7c3aed]/[0.12] hover:bg-[#0d0b1a]/50",
                  (disabled || uploading) && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-semibold text-sm">{preset.name}</span>
                  {selectedPreset === preset.id && <CheckCircle className="w-3 h-3 text-[#7c3aed]" />}
                </div>
                <span className="text-xs opacity-70 mb-2 flex items-center">
                  <Clock className="w-3 h-3 mr-1" /> {preset.time}
                </span>
                <p className="text-[10px] opacity-60 leading-tight">{preset.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Upload Area */}
        <div
          className={cn(
            "border-2 border-dashed rounded-xl p-5 flex flex-col items-center justify-center text-center transition-all",
            "border-white/[0.06] bg-[#08080f]/30 hover:bg-[#0d0b1a]/40 hover:border-[#7c3aed]/[0.15]",
            (disabled || uploading) && "opacity-50 pointer-events-none"
          )}
        >
          <div className="w-10 h-10 rounded-full bg-[#0d0b1a] flex items-center justify-center mb-3 border border-white/[0.06]">
            <Upload className="w-5 h-5 text-gray-400" />
          </div>

          <p className="text-xs text-gray-400 mb-4">
            MP4, MOV, AVI, WEBM — Max 500MB
          </p>

          <Button
            onClick={onUploadClick}
            disabled={disabled || uploading}
            loading={uploading}
            className="w-full"
          >
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

        {/* Status Messages */}
        {videoInfo && (
          <div className="flex items-center p-3 rounded-lg bg-[#a78bfa]/[0.06] border border-[#a78bfa]/[0.12] text-[#a78bfa] text-sm">
            <FileVideo className="w-4 h-4 mr-2" />
            <span>
              Video: {videoInfo.duration.toFixed(1)}s • {videoInfo.resolution} • {videoInfo.fps.toFixed(1)} fps
            </span>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="p-3 rounded-lg bg-yellow-500/[0.06] border border-yellow-500/[0.12] text-yellow-400 text-sm">
            <div className="flex items-center font-semibold mb-1">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Warnings
            </div>
            <ul className="list-disc list-inside space-y-1 ml-5 opacity-90 text-xs">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-500/[0.06] border border-red-500/[0.12] text-red-400 text-sm flex items-center">
            <AlertTriangle className="w-4 h-4 mr-2" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
