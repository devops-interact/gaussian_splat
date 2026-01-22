import { useState } from 'react';
import VideoUpload from '../components/VideoUpload';
import JobStatus from '../components/JobStatus';
import Viewer3D from '../components/Viewer3D';

export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);

  const handleUploadSuccess = (newJobId: string) => {
    setJobId(newJobId);
    setModelUrl(null);
  };

  const handleProcessingComplete = (url: string) => {
    setModelUrl(url);
  };

  return (
    <div>
      <div className="header">
        <div className="container">
          <h1>Gaussian Splatting Room Reconstruction</h1>
          <p>Upload a video of a room to generate a 3D reconstruction using Gaussian Splatting</p>
        </div>
      </div>

      <div className="container">
        <VideoUpload 
          onUploadSuccess={handleUploadSuccess}
          disabled={!!jobId && modelUrl === null}
        />

        {jobId && (
          <>
            <JobStatus 
              jobId={jobId} 
              onComplete={handleProcessingComplete}
            />
            <Viewer3D modelUrl={modelUrl} />
          </>
        )}
      </div>
    </div>
  );
}
