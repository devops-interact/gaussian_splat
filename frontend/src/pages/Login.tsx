'use client';

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'framer-motion';
import { ApiConfigBanner } from '@/components/ApiConfigBanner';
import { formatLoginError } from '@/lib/authErrors';
import { getApiBaseUrl } from '@/lib/apiBase';

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
    } catch (err: unknown) {
      setError(formatLoginError(err));
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
        <ApiConfigBanner />
        <div className="rounded-2xl border border-white/[0.22] bg-black p-8 shadow-2xl">
          <h1 className="text-2xl font-mono font-bold text-[#efe752] mb-2 tracking-tighter">
            METROA
          </h1>
          <p className="text-gray-500 text-sm mb-2">Sign in to access your projects</p>
          {import.meta.env.PROD && (
            <p className="text-gray-600 text-xs font-mono mb-6 break-all">
              API: {getApiBaseUrl() || '(unset — requests go to this Vercel domain)'}
            </p>
          )}
          {!import.meta.env.PROD && <div className="mb-6" />}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-lg bg-black border border-white/[0.22] text-white placeholder-gray-600 focus:border-[#efe752]/50 focus:ring-1 focus:ring-[#efe752]/38 outline-none transition-all font-mono text-sm"
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
                className="w-full px-4 py-3 rounded-lg bg-black border border-white/[0.22] text-white placeholder-gray-600 focus:border-[#efe752]/50 focus:ring-1 focus:ring-[#efe752]/38 outline-none transition-all font-mono text-sm"
                required
              />
            </div>

            <button
              type="button"
              onClick={fillDemo}
              className="w-full py-2.5 rounded-lg border border-[#efe752]/42 bg-[#efe752]/[0.06] text-[#efe752] text-sm font-mono hover:bg-[#efe752]/[0.12] transition-colors"
            >
              Usar credenciales demo
            </button>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/19 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-lg bg-[#efe752] text-black font-mono font-semibold hover:bg-[#e5dd4a] disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
