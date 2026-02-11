'use client'

import { useState, useCallback, useRef, useEffect } from 'react';
import VideoUpload from '@/components/VideoUpload';
import JobStatus from '@/components/JobStatus';
import Viewer3D from '@/components/Viewer3D';
import TechnicalDetails from '@/components/TechnicalDetails';
import type { ModelMetadata } from '@/components/Viewer3D';
import { Card, CardContent } from '@/components/ui/card';
import { Box, Download, ChevronDown, FileBox, FileArchive } from 'lucide-react';
import { downloadModel } from '@/api/jobs';

export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelMetadata, setModelMetadata] = useState<ModelMetadata | null>(null);
  const [qualityPreset] = useState<string>('balanced');
  const [elapsedTime] = useState<string>('--');
  const [downloading, setDownloading] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
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
    setDownloadOpen(false);
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
      {/* ── Header with Download Dropdown ───────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-1 font-mono">
            3D Reconstruction
          </h2>
          <p className="text-gray-600 text-sm max-w-2xl">
            Upload room video scans to generate high-fidelity 3D Gaussian Splats.
            View, measure, and interact with your reconstructions directly in the browser.
          </p>
        </div>

        {/* Download Dropdown */}
        {modelUrl && jobId && (
          <div className="relative flex-shrink-0" ref={downloadRef}>
            <button
              onClick={() => setDownloadOpen(!downloadOpen)}
              disabled={downloading}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#35c889]/[0.1] text-[#35c889] border border-[#35c889]/20 hover:bg-[#35c889]/[0.18] hover:border-[#35c889]/30 transition-all duration-200 text-sm font-mono font-medium disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${downloadOpen ? 'rotate-180' : ''}`} />
            </button>

            {downloadOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-[#0a0a0a] border border-white/[0.08] shadow-2xl shadow-black/50 backdrop-blur-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="p-1.5">
                  <button
                    onClick={() => handleDownload(false)}
                    disabled={downloading}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-mono text-white/70 hover:text-white hover:bg-[#081717] transition-colors group"
                  >
                    <FileBox className="w-4 h-4 text-[#35c889]/50 group-hover:text-[#35c889]" />
                    <div>
                      <span className="block text-white/80 group-hover:text-white">.ply</span>
                      <span className="block text-[10px] text-white/30">Full quality</span>
                    </div>
                  </button>
                  <button
                    onClick={() => handleDownload(true)}
                    disabled={downloading}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-mono text-white/70 hover:text-white hover:bg-[#081717] transition-colors group"
                  >
                    <FileArchive className="w-4 h-4 text-[#a4a4ff]/50 group-hover:text-[#a4a4ff]" />
                    <div>
                      <span className="block text-white/80 group-hover:text-white">.ply.gz</span>
                      <span className="block text-[10px] text-white/30">Compressed</span>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 3D Viewer (Full Width) ─────────────────────────────────────── */}
      {modelUrl ? (
        <div className="rounded-xl overflow-hidden border border-[#35c889]/[0.08] bg-[#060606] h-[520px] lg:h-[600px] shadow-2xl shadow-[#35c889]/[0.03]">
          <Viewer3D modelUrl={modelUrl} onModelMetadata={handleModelMetadata} />
        </div>
      ) : (
        <Card className="h-[320px] lg:h-[420px] flex items-center justify-center border-dashed border-2 border-white/[0.04] bg-[#060606]">
          <CardContent className="text-center text-gray-600">
            <div className="w-16 h-16 rounded-2xl bg-[#081717]/50 flex items-center justify-center mx-auto mb-4 border border-white/[0.06]">
              <Box className="w-8 h-8 text-gray-700" />
            </div>
            <h3 className="text-base font-medium text-gray-500 mb-1 font-mono">3D Viewer</h3>
            <p className="text-sm text-gray-600 max-w-xs mx-auto">
              Upload a video to start reconstruction. Your 3D model will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Panels Grid (Upload | Status + Metadata) ───────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Upload Panel */}
        <div>
          <VideoUpload
            onUploadSuccess={handleUploadSuccess}
            disabled={!!jobId && modelUrl === null}
          />
        </div>

        {/* Combined Status + Metadata Panel */}
        <div>
          <Card className="w-full">
            {/* Processing Status Section */}
            {jobId ? (
              <JobStatus
                jobId={jobId}
                onComplete={handleProcessingComplete}
                embedded
              />
            ) : (
              <div className="p-6 text-center text-gray-600">
                <p className="text-sm font-mono">No active job</p>
                <p className="text-xs text-gray-700 mt-1">Upload a video to start processing</p>
              </div>
            )}

            {/* Divider */}
            <div className="border-t border-white/[0.04] mx-4" />

            {/* Metadata Section */}
            <TechnicalDetails
              metadata={modelMetadata}
              jobInfo={{
                qualityPreset,
                elapsedTime,
                isProcessing: !!jobId && modelUrl === null,
              }}
              embedded
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
