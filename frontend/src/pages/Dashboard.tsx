'use client';

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listProjects, createProject, deleteProject, Project } from '@/api/projects';
import { FolderOpen, Plus, Trash2, MoreVertical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const navigate = useNavigate();

  const loadProjects = async () => {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const p = await createProject(newName.trim());
      setProjects((prev) => [p, ...prev]);
      setNewName('');
      setShowCreate(false);
      navigate(`/projects/${p.id}`);
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setMenuOpen(null);
    } catch (err) {
      console.error(err);
    }
  };

  const formatDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-1 font-mono">
            My Projects
          </h2>
          <p className="text-gray-600 text-sm">
            Create projects and add scans for 3D reconstructions.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#efe752] text-black font-mono font-semibold hover:bg-[#e5dd4a] transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {showCreate && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-white/[0.10] bg-black p-4"
        >
          <form onSubmit={handleCreate} className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              className="flex-1 px-4 py-2 rounded-lg bg-black border border-white/[0.10] text-white placeholder-gray-500 font-mono text-sm focus:border-[#efe752]/50 outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={!newName.trim() || creating}
              className="px-4 py-2 rounded-lg bg-[#efe752] text-black font-mono font-medium disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewName(''); }}
              className="px-4 py-2 rounded-lg border border-white/[0.10] text-gray-400 hover:text-white font-mono"
            >
              Cancel
            </button>
          </form>
        </motion.div>
      )}

      {loading ? (
        <div className="text-gray-500 font-mono text-sm">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-white/[0.10] bg-black/50 p-12 text-center">
          <FolderOpen className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 font-mono mb-2">No projects yet</p>
          <p className="text-gray-600 text-sm mb-4">Create a project to start adding 3D scans</p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-lg bg-[#efe752] text-black font-mono font-medium"
          >
            Create Project
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {projects.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: i * 0.05 }}
                className="relative rounded-xl border border-white/[0.10] bg-black p-4 hover:border-[#efe752]/[0.19] transition-colors group"
              >
                <button
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className="block w-full text-left"
                >
                  <div className="flex items-start justify-between mb-2">
                    <FolderOpen className="w-8 h-8 text-[#efe752]/50" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === p.id ? null : p.id); }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/[0.06] text-gray-400"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>
                  <h3 className="font-mono font-semibold text-white mb-1">{p.name}</h3>
                  <p className="text-gray-500 text-xs font-mono">
                    {p.scan_count} scan{p.scan_count !== 1 ? 's' : ''} · {formatDate(p.updated_at)}
                  </p>
                </button>
                {menuOpen === p.id && (
                  <div className="absolute right-2 top-12 z-10 rounded-lg bg-black border border-white/[0.10] shadow-xl py-1 min-w-[120px]">
                    <button
                      onClick={() => handleDelete(p.id)}
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
