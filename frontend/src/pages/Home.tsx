'use client'

import { useState, useCallback } from 'react';
import VideoUpload from '@/components/VideoUpload';
import JobStatus from '@/components/JobStatus';
import Viewer3D from '@/components/Viewer3D';
import TechnicalDetails from '@/components/TechnicalDetails';
import type { ModelMetadata } from '@/components/Viewer3D';
import { Card, CardContent } from '@/components/ui/card';
import { Box, Download } from 'lucide-react';
import { downloadModel } from '@/api/jobs';

export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelMetadata, setModelMetadata] = useState<ModelMetadata | null>(null);
  const [qualityPreset] = useState<string>('balanced');
  const [elapsedTime] = useState<string>('--');
  const [downloading, setDownloading] = useState(false);

  const handleUploadSuccess = (newJobId: string) => {
    setJobId(newJobId);
    setModelUrl(null);
    setModelMetadata(null);
  };

  const handleProcessingComplete = (url: string) => {
    setModelUrl(url);
  };

  const handleModelMetadata = useCallback((meta: ModelMetadata) => {
    setModelMetadata(meta);
  }, []);

  const handleDownload = async (compressed: boolean = false) => {
    if (!jobId) return;
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
      console.error('Download failed:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white mb-1 font-mono">
          3D Reconstruction
        </h2>
        <p className="text-gray-500 text-sm max-w-2xl">
          Upload room video scans to generate high-fidelity 3D Gaussian Splats.
          View, measure, and interact with your reconstructions directly in the browser.
        </p>
      </div>

      {/* ── 3D Viewer (Full Width) ─────────────────────────────────────── */}
      {modelUrl ? (
        <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-[#0a0a0a] h-[520px] lg:h-[600px] shadow-2xl">
          <Viewer3D modelUrl={modelUrl} onModelMetadata={handleModelMetadata} />
        </div>
      ) : (
        <Card className="h-[320px] lg:h-[420px] flex items-center justify-center border-dashed border-2 border-white/[0.04] bg-[#060606]">
          <CardContent className="text-center text-gray-600">
            <div className="w-16 h-16 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto mb-4 border border-white/[0.06]">
              <Box className="w-8 h-8 text-gray-700" />
            </div>
            <h3 className="text-base font-medium text-gray-500 mb-1 font-mono">3D Viewer</h3>
            <p className="text-sm text-gray-600 max-w-xs mx-auto">
              Upload a video to start reconstruction. Your 3D model will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Panels Grid (Stacked Below Viewer) ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Upload Panel */}
        <div className="lg:col-span-1">
          <VideoUpload
            onUploadSuccess={handleUploadSuccess}
            disabled={!!jobId && modelUrl === null}
          />
        </div>

        {/* Status Panel */}
        <div className="lg:col-span-1">
          {jobId ? (
            <JobStatus
              jobId={jobId}
              onComplete={handleProcessingComplete}
            />
          ) : (
            <Card className="h-full flex items-center justify-center border-app-primary bg-app-card/30 min-h-[200px]">
              <CardContent className="text-center text-gray-600 py-8">
                <p className="text-sm font-mono">No active job</p>
                <p className="text-xs text-gray-700 mt-1">Upload a video to start processing</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Technical Details Panel */}
        <div className="lg:col-span-1">
          <TechnicalDetails
            metadata={modelMetadata}
            jobInfo={{
              qualityPreset,
              elapsedTime,
              projectName: jobId ? `Reconstruction ${jobId.slice(0, 8)}` : undefined,
              updatedAt: new Date().toLocaleDateString('en-GB'),
            }}
          />
        </div>
      </div>

      {/* ── Downloads Section ──────────────────────────────────────────── */}
      {modelUrl && jobId && (
        <Card className="border-app-primary bg-app-card/30">
          <CardContent className="p-5">
            <h4 className="text-sm font-mono font-semibold text-white flex items-center gap-2 mb-4">
              <Download className="w-4 h-4 text-blue-400" />
              Downloads
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <button
                onClick={() => handleDownload(false)}
                disabled={downloading}
                className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors text-sm font-mono group"
              >
                <span className="text-white/70 group-hover:text-white">.ply (Full Quality)</span>
                <Download className="w-3.5 h-3.5 text-white/30 group-hover:text-white/70" />
              </button>
              <button
                onClick={() => handleDownload(true)}
                disabled={downloading}
                className="flex items-center justify-between px-4 py-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors text-sm font-mono group"
              >
                <span className="text-white/70 group-hover:text-white">.ply.gz (Compressed)</span>
                <Download className="w-3.5 h-3.5 text-white/30 group-hover:text-white/70" />
              </button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
