'use client';

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login, demoCredentials } = useAuth();
  const navigate = useNavigate();

  const fillDemo = () => {
    setEmail(demoCredentials.email);
    setPassword(demoCredentials.password);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="rounded-2xl border border-white/[0.08] bg-[#08080f] p-8 shadow-2xl">
          <h1 className="text-2xl font-mono font-bold text-[#7c3aed] mb-2 tracking-tighter">
            3D Scanner
          </h1>
          <p className="text-gray-500 text-sm mb-6">Sign in to access your projects</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-lg bg-[#0a0a0a] border border-white/[0.08] text-white placeholder-gray-600 focus:border-[#7c3aed]/50 focus:ring-1 focus:ring-[#7c3aed]/30 outline-none transition-all font-mono text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-lg bg-[#0a0a0a] border border-white/[0.08] text-white placeholder-gray-600 focus:border-[#7c3aed]/50 focus:ring-1 focus:ring-[#7c3aed]/30 outline-none transition-all font-mono text-sm"
                required
              />
            </div>

            <button
              type="button"
              onClick={fillDemo}
              className="w-full py-2.5 rounded-lg border border-[#7c3aed]/20 bg-[#7c3aed]/[0.06] text-[#7c3aed] text-sm font-mono hover:bg-[#7c3aed]/[0.12] transition-colors"
            >
              Usar credenciales demo
            </button>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-lg bg-[#7c3aed] text-white font-mono font-semibold hover:bg-[#7c3aed]/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
