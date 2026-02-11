import { useState, useRef } from 'react';
import { uploadVideo } from '../api/jobs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FileVideo, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// Quality preset definitions
const PRESETS = [
  {
    id: 'fast',
    name: 'Fast',
    description: 'Quick preview (~3-5 min). Lower quality.',
    time: '3-5 min'
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Good quality (~8-12 min). Recommended.',
    time: '8-12 min'
  },
  {
    id: 'quality',
    name: 'Quality',
    description: 'Best quality (~20-30 min). Production use.',
    time: '20-30 min'
  }
];

interface VideoUploadProps {
  onUploadSuccess: (jobId: string) => void;
  disabled?: boolean;
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

export default function VideoUpload({ onUploadSuccess, disabled }: VideoUploadProps) {
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
      const result = await uploadVideo(file, selectedPreset) as UploadResult;

      // Show warnings if any
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings);
      }

      // Show video info
      if (result.video_info) {
        setVideoInfo(result.video_info);
      }

      onUploadSuccess(result.job_id);
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
    <Card className="w-full border-app-primary bg-app-card/30 h-full">
      <CardHeader>
        <CardTitle>New Project</CardTitle>
        <CardDescription>Upload a video to start 3D reconstruction</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Presets */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-gray-300">Quality Preset</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setSelectedPreset(preset.id)}
                disabled={disabled || uploading}
                className={cn(
                  "flex flex-col items-start p-3 rounded-lg border text-left transition-all duration-200",
                  selectedPreset === preset.id
                    ? "border-primary-500 bg-primary-500/10 text-primary-400"
                    : "border-app-secondary bg-app-elevated/50 text-gray-400 hover:border-gray-600 hover:bg-app-elevated",
                  (disabled || uploading) && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-semibold text-sm">{preset.name}</span>
                  {selectedPreset === preset.id && <CheckCircle className="w-3 h-3" />}
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
            "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all",
            "border-app-secondary bg-app-elevated/20 hover:bg-app-elevated/40 hover:border-gray-500",
            (disabled || uploading) && "opacity-50 pointer-events-none"
          )}
        >
          <div className="w-12 h-12 rounded-full bg-app-elevated flex items-center justify-center mb-4">
            <Upload className="w-6 h-6 text-gray-400" />
          </div>

          <h3 className="text-lg font-medium text-white mb-2">
            {uploading ? 'Uploading Video...' : 'Upload Video File'}
          </h3>

          <p className="text-sm text-gray-400 max-w-xs mb-6">
            Supported formats: MP4, MOV, AVI, WEBM. Max size 500MB.
          </p>

          <Button
            onClick={onUploadClick}
            disabled={disabled || uploading}
            loading={uploading}
            size="lg"
            className="w-full max-w-xs"
          >
            {uploading ? 'Processing...' : 'Select File'}
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
          <div className="flex items-center p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-sm">
            <FileVideo className="w-4 h-4 mr-2" />
            <span>
              Video: {videoInfo.duration.toFixed(1)}s • {videoInfo.resolution} • {videoInfo.fps.toFixed(1)} fps
            </span>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-sm">
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
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-center">
            <AlertTriangle className="w-4 h-4 mr-2" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
