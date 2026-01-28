import { useEffect, useState } from 'react';
import { JobStatus as JobStatusEnum, JobStatusResponse } from '../types/job';
import { getJobStatus, downloadModel } from '../api/jobs';

interface JobStatusProps {
  jobId: string;
  onComplete: (modelUrl: string) => void;
}

const STATUS_LABELS: Record<JobStatusEnum, string> = {
  [JobStatusEnum.UPLOADED]: 'Video uploaded',
  [JobStatusEnum.VALIDATING]: 'Validating video',
  [JobStatusEnum.EXTRACTING_FRAMES]: 'Extracting frames',
  [JobStatusEnum.TRAINING]: 'Training 3D model (this takes a while)',
  [JobStatusEnum.EXPORTING]: 'Exporting model',
  [JobStatusEnum.COMPRESSING]: 'Compressing output',
  [JobStatusEnum.COMPLETED]: 'Completed',
  [JobStatusEnum.ERROR]: 'Error',
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
    }, 2000); // Poll every 2 seconds

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

  const statusClass = 
    status === JobStatusEnum.ERROR ? 'error' :
    status === JobStatusEnum.COMPLETED ? 'success' :
    'info';

  return (
    <div className="status-section">
      <h2>Processing Status</h2>
      
      {/* Preset and time info */}
      {qualityPreset && (
        <div style={{ 
          fontSize: '0.9rem', 
          color: '#888', 
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>Preset: {PRESET_LABELS[qualityPreset] || qualityPreset}</span>
          <span>Elapsed: {elapsedTime}</span>
        </div>
      )}
      
      <div className={`status-message ${statusClass}`}>
        <strong>{STATUS_LABELS[status]}</strong>
        {status !== JobStatusEnum.COMPLETED && status !== JobStatusEnum.ERROR && (
          <span className="loading" style={{ marginLeft: '0.5rem' }}></span>
        )}
      </div>

      {status !== JobStatusEnum.COMPLETED && status !== JobStatusEnum.ERROR && (
        <>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progress * 100}%` }}
            >
              {Math.round(progress * 100)}%
            </div>
          </div>
          {estimatedMinutes && (
            <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem', textAlign: 'center' }}>
              Estimated total time: ~{estimatedMinutes} minutes
            </p>
          )}
        </>
      )}

      {error && (
        <div className="status-message error" style={{ marginTop: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {status === JobStatusEnum.COMPLETED && (
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button 
            className="button" 
            onClick={() => handleDownload(false)}
            disabled={downloading}
          >
            {downloading ? 'Downloading...' : 'Download Model (.ply)'}
          </button>
          <button 
            className="button" 
            onClick={() => handleDownload(true)}
            disabled={downloading}
            style={{ background: '#444' }}
          >
            Download Compressed (.ply.gz)
          </button>
        </div>
      )}
    </div>
  );
}
