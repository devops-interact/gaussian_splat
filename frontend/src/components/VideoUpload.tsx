import { useState, useRef } from 'react';
import { uploadVideo } from '../api/jobs';

// Quality preset definitions
const PRESETS = [
  {
    id: 'fast',
    name: 'Fast',
    description: 'Quick preview (~3-5 min). Lower quality, good for testing.',
    time: '3-5 min'
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Good quality (~8-12 min). Recommended for most videos.',
    time: '8-12 min'
  },
  {
    id: 'quality',
    name: 'Quality',
    description: 'Best quality (~20-30 min). For final production renders.',
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
      console.error('Response:', err.response);
      console.error('Request:', err.request);
      
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

  return (
    <div className="upload-section">
      <h2>Upload Video</h2>
      <p style={{ color: '#b0b0b0', marginTop: '0.5rem', marginBottom: '1rem' }}>
        Upload a video file of a room to start 3D reconstruction
      </p>

      {/* Quality Preset Selector */}
      <div className="preset-selector" style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
          Quality Preset:
        </label>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => setSelectedPreset(preset.id)}
              disabled={disabled || uploading}
              style={{
                padding: '0.75rem 1rem',
                border: selectedPreset === preset.id ? '2px solid #66b3ff' : '2px solid #444',
                borderRadius: '8px',
                background: selectedPreset === preset.id ? 'rgba(102, 179, 255, 0.1)' : 'transparent',
                color: selectedPreset === preset.id ? '#66b3ff' : '#fff',
                cursor: disabled || uploading ? 'not-allowed' : 'pointer',
                opacity: disabled || uploading ? 0.5 : 1,
                transition: 'all 0.2s',
                flex: '1',
                minWidth: '120px'
              }}
            >
              <div style={{ fontWeight: 600 }}>{preset.name}</div>
              <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.25rem' }}>
                {preset.time}
              </div>
            </button>
          ))}
        </div>
        <p style={{ 
          fontSize: '0.85rem', 
          color: '#888', 
          marginTop: '0.5rem',
          fontStyle: 'italic' 
        }}>
          {PRESETS.find(p => p.id === selectedPreset)?.description}
        </p>
      </div>

      <div className="file-input">
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.mov,.avi,.webm"
          onChange={handleFileChange}
          disabled={disabled || uploading}
        />
      </div>

      {uploading && (
        <div className="status-message info">
          <span className="loading"></span>
          Uploading and validating video...
        </div>
      )}

      {videoInfo && (
        <div className="status-message info" style={{ background: 'rgba(100, 108, 255, 0.1)' }}>
          Video: {videoInfo.duration.toFixed(1)}s, {videoInfo.resolution}, {videoInfo.fps.toFixed(1)} fps
        </div>
      )}

      {warnings.length > 0 && (
        <div className="status-message" style={{ background: 'rgba(255, 200, 0, 0.1)', borderColor: '#ffc800' }}>
          <strong>Warnings:</strong>
          <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0 }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {error && (
        <div className="status-message error">
          {error}
        </div>
      )}
    </div>
  );
}
