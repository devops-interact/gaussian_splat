import { useState, useRef } from 'react';
import { uploadVideo } from '../api/jobs';

interface VideoUploadProps {
  onUploadSuccess: (jobId: string) => void;
  disabled?: boolean;
}

export default function VideoUpload({ onUploadSuccess, disabled }: VideoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.mp4')) {
      setError('Please upload a .mp4 video file');
      return;
    }

    setError(null);
    setUploading(true);

    try {
      const result = await uploadVideo(file);
      onUploadSuccess(result.job_id);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Upload failed. Please try again.');
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
        Upload a .mp4 video file of a room to start 3D reconstruction
      </p>

      <div className="file-input">
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4"
          onChange={handleFileChange}
          disabled={disabled || uploading}
        />
      </div>

      {uploading && (
        <div className="status-message info">
          <span className="loading"></span>
          Uploading video...
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
