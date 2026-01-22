import { useEffect, useState } from 'react';
import { JobStatus as JobStatusEnum } from '../types/job';
import { getJobStatus, downloadModel } from '../api/jobs';

interface JobStatusProps {
  jobId: string;
  onComplete: (modelUrl: string) => void;
}

const STATUS_LABELS: Record<JobStatusEnum, string> = {
  [JobStatusEnum.UPLOADED]: 'Video uploaded',
  [JobStatusEnum.EXTRACTING_FRAMES]: 'Extracting frames',
  [JobStatusEnum.ESTIMATING_POSES]: 'Estimating camera poses',
  [JobStatusEnum.TRAINING]: 'Training Gaussian Splatting model',
  [JobStatusEnum.EXPORTING]: 'Exporting model',
  [JobStatusEnum.COMPLETED]: 'Completed',
  [JobStatusEnum.ERROR]: 'Error',
};

export default function JobStatus({ jobId, onComplete }: JobStatusProps) {
  const [status, setStatus] = useState<JobStatusEnum>(JobStatusEnum.UPLOADED);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (status === JobStatusEnum.COMPLETED || status === JobStatusEnum.ERROR) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const response = await getJobStatus(jobId);
        setStatus(response.status);
        setProgress(response.progress);
        setError(response.error_message || null);

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

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const blob = await downloadModel(jobId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `model_${jobId}.ply`;
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
      
      <div className={`status-message ${statusClass}`}>
        <strong>{STATUS_LABELS[status]}</strong>
        {status !== JobStatusEnum.COMPLETED && status !== JobStatusEnum.ERROR && (
          <span className="loading" style={{ marginLeft: '0.5rem' }}></span>
        )}
      </div>

      {status !== JobStatusEnum.COMPLETED && status !== JobStatusEnum.ERROR && (
        <div className="progress-bar">
          <div 
            className="progress-fill" 
            style={{ width: `${progress * 100}%` }}
          >
            {Math.round(progress * 100)}%
          </div>
        </div>
      )}

      {error && (
        <div className="status-message error" style={{ marginTop: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {status === JobStatusEnum.COMPLETED && (
        <div style={{ marginTop: '1rem' }}>
          <button 
            className="button" 
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? 'Downloading...' : 'Download Model (.ply)'}
          </button>
        </div>
      )}
    </div>
  );
}
