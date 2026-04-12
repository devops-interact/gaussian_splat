'use client';

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { listScans, deleteScan, Scan } from '@/api/scans';
import { getProject as fetchProject, Project } from '@/api/projects';
import { ArrowLeft, Plus, Scan as ScanIcon, Trash2, MoreVertical, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const projectIdNum = projectId ? parseInt(projectId, 10) : 0;

  const [project, setProject] = useState<Project | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState<number | null>(null);

  const load = async () => {
    if (!projectIdNum) return;
    try {
      const [p, s] = await Promise.all([
        fetchProject(projectIdNum),
        listScans(projectIdNum),
      ]);
      setProject(p);
      setScans(s);
    } catch (err) {
      console.error(err);
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [projectIdNum]);

  const handleNewScan = () => {
    navigate(`/projects/${projectId}/scans/new`);
  };

  const handleDeleteScan = async (scanId: number) => {
    try {
      await deleteScan(projectIdNum, scanId);
      setScans((prev) => prev.filter((s) => s.id !== scanId));
      setMenuOpen(null);
    } catch (err) {
      console.error(err);
    }
  };

  const formatDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const statusColor = (s: string | null) => {
    if (!s) return 'text-gray-500';
    if (s === 'completed') return 'text-[#efe752]';
    if (s === 'error') return 'text-red-400';
    return 'text-amber-400';
  };

  if (loading || !project) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/dashboard')}
          className="p-2 rounded-lg border border-white/[0.10] hover:bg-white/[0.04] text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-mono">{project.name}</h2>
          <p className="text-gray-600 text-sm">
            {project.scan_count} scan{project.scan_count !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-gray-500 text-sm">Scans in this project</p>
        <button
          onClick={handleNewScan}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#efe752] text-black font-mono font-semibold hover:bg-[#e5dd4a] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Scan
        </button>
      </div>

      {scans.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-white/[0.10] bg-black/50 p-12 text-center">
          <ScanIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 font-mono mb-2">No scans yet</p>
          <p className="text-gray-600 text-sm mb-4">Create a scan to upload a video and start 3D reconstruction</p>
          <button
            onClick={handleNewScan}
            className="px-4 py-2 rounded-lg bg-[#efe752] text-black font-mono font-medium"
          >
            New Scan
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl border-2 border-dashed border-[#efe752]/25 bg-[#efe752]/[0.03] p-6 flex flex-col items-center justify-center min-h-[140px] hover:border-[#efe752]/35 hover:bg-[#efe752]/[0.06] transition-colors cursor-pointer"
            onClick={handleNewScan}
          >
            <Plus className="w-8 h-8 text-[#efe752] mb-2" />
            <span className="font-mono text-sm text-[#efe752]">New Scan</span>
          </motion.div>
          <AnimatePresence>
            {scans.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: i * 0.05 }}
                className="relative rounded-xl border border-white/[0.10] bg-black p-4 hover:border-[#efe752]/[0.19] transition-colors group"
              >
                <button
                  onClick={() => navigate(`/projects/${projectId}/scans/${s.id}`)}
                  className="block w-full text-left"
                >
                  <div className="flex items-start justify-between mb-2">
                    <ScanIcon className="w-8 h-8 text-[#efe752]/50" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === s.id ? null : s.id); }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] text-gray-400"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  <h3 className="font-mono font-semibold text-white mb-1">
                    {s.name || `Scan ${s.id}`}
                  </h3>
                  <p className={`text-xs font-mono ${statusColor(s.status)}`}>
                    {s.status || 'No video yet'}
                  </p>
                  <p className="text-gray-600 text-xs mt-1">{formatDate(s.created_at)}</p>
                </button>
                {menuOpen === s.id && (
                  <div className="absolute right-2 top-12 z-10 rounded-lg bg-black border border-white/[0.10] shadow-xl py-1 min-w-[120px]">
                    <button
                      onClick={() => handleDeleteScan(s.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-red-400 hover:bg-red-500/10 text-sm font-mono"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
