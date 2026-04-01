'use client'

import { useState, useCallback, useRef, useEffect } from 'react';
import VideoUpload from '@/components/VideoUpload';
import JobStatus from '@/components/JobStatus';
import Viewer3D from '@/components/Viewer3D';
import TechnicalDetails from '@/components/TechnicalDetails';
import type { ModelMetadata } from '@/components/Viewer3D';
import { Card, CardContent } from '@/components/ui/card';
import { Box, Download, ChevronDown, FileBox, FileArchive, FileCode } from 'lucide-react';
import { downloadModel } from '@/api/jobs';

export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [objUrl, setObjUrl] = useState<string | null>(null);
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
    setObjUrl(null);
    setModelMetadata(null);
  };

  const handleProcessingComplete = (url: string, objUrlResp?: string) => {
    setModelUrl(url);
    setObjUrl(objUrlResp ?? null);
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

  const handleObjDownload = () => {
    if (!objUrl) return;
    setDownloadOpen(false);
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
    const fullUrl = objUrl.startsWith('http') ? objUrl : `${apiBase}${objUrl}`;
    const a = document.createElement('a');
    a.href = fullUrl;
    a.download = `model_${jobId}.obj`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="space-y-4">
      {/* ── Header with Download Dropdown ───────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-1 font-mono">
            3D Reconstruction
          </h2>
          <p className="text-gray-600 text-sm max-w-2xl">
            Upload video scans to generate high-fidelity 3D Gaussian Splats.
          </p>
        </div>

        {/* Download Dropdown */}
        {modelUrl && jobId && (
          <div className="relative flex-shrink-0" ref={downloadRef}>
            <button
              onClick={() => setDownloadOpen(!downloadOpen)}
              disabled={downloading}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#efe752]/[0.1] text-[#efe752] border border-[#efe752]/20 hover:bg-[#efe752]/[0.18] hover:border-[#efe752]/30 transition-all duration-200 text-sm font-mono font-medium disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${downloadOpen ? 'rotate-180' : ''}`} />
            </button>

            {downloadOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-[#0a0a0a] border border-white/[0.08] shadow-2xl shadow-black/50 backdrop-blur-xl z-50 overflow-hidden">
                <div className="p-1.5">
                  <button
                    onClick={() => handleDownload(false)}
                    disabled={downloading}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-mono text-white/70 hover:text-white hover:bg-[#121008] transition-colors group"
                  >
                    <FileBox className="w-4 h-4 text-[#efe752]/50 group-hover:text-[#efe752]" />
                    <div>
                      <span className="block text-white/80 group-hover:text-white">.ply</span>
                      <span className="block text-[10px] text-white/30">Full quality</span>
                    </div>
                  </button>
                  <button
                    onClick={() => handleDownload(true)}
                    disabled={downloading}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-mono text-white/70 hover:text-white hover:bg-[#121008] transition-colors group"
                  >
                    <FileArchive className="w-4 h-4 text-[#f5ec99]/50 group-hover:text-[#f5ec99]" />
                    <div>
                      <span className="block text-white/80 group-hover:text-white">.ply.gz</span>
                      <span className="block text-[10px] text-white/30">Compressed</span>
                    </div>
                  </button>
                  {objUrl && (
                    <button
                      onClick={handleObjDownload}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-mono text-white/70 hover:text-white hover:bg-[#121008] transition-colors group"
                    >
                      <FileCode className="w-4 h-4 text-amber-400/50 group-hover:text-amber-400" />
                      <div>
                        <span className="block text-white/80 group-hover:text-white">.obj</span>
                        <span className="block text-[10px] text-white/30">Wavefront OBJ</span>
                      </div>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Main Layout: Viewer (2/3) | Sidebar (1/3) ──────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
        {/* ── 3D Viewer (2/3 width) ─────────────────────────────────────── */}
        <div className="w-full lg:w-2/3 flex-shrink-0">
          {modelUrl ? (
            <div className="rounded-xl overflow-hidden border border-[#efe752]/[0.08] bg-[#08080f] h-[400px] sm:h-[520px] lg:h-[calc(100vh-160px)] shadow-2xl shadow-[#efe752]/[0.03]">
              <Viewer3D modelUrl={modelUrl} onModelMetadata={handleModelMetadata} />
            </div>
          ) : (
            <Card className="h-[300px] sm:h-[400px] lg:h-[calc(100vh-160px)] flex items-center justify-center border-dashed border-2 border-white/[0.04] bg-[#08080f]">
              <CardContent className="text-center text-gray-600">
                <div className="w-16 h-16 rounded-2xl bg-[#121008]/50 flex items-center justify-center mx-auto mb-4 border border-white/[0.06]">
                  <Box className="w-8 h-8 text-gray-700" />
                </div>
                <h3 className="text-base font-medium text-gray-500 mb-1 font-mono">3D Viewer</h3>
                <p className="text-sm text-gray-600 max-w-xs mx-auto">
                  Upload a video to start reconstruction. Your 3D model will appear here.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Sidebar (1/3 width): Upload + Status + Metadata ──────────── */}
        <div className="w-full lg:w-1/3 flex flex-col gap-4 lg:max-h-[calc(100vh-160px)] lg:overflow-y-auto scrollbar-thin">
          {/* Upload Panel */}
          <VideoUpload
            onUploadSuccess={handleUploadSuccess}
            disabled={!!jobId && modelUrl === null}
          />

          {/* Combined Status + Metadata Panel */}
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
