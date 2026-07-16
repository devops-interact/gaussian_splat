import axios from 'axios';
import { getApiBaseUrl } from './apiBase';

export type BackendCheckResult =
  | { ok: true }
  | { ok: false; reason: 'unset' | 'vercel_404' | 'unreachable' | 'error'; detail: string };

/** Probe whether the SPA can reach the FastAPI backend (same path rules as the app). */
export async function checkBackendReachable(): Promise<BackendCheckResult> {
  const base = getApiBaseUrl();
  const isProdVercel =
    typeof window !== 'undefined' &&
    (window.location.hostname.endsWith('.vercel.app') || window.location.hostname.includes('vercel'));

  if (!base && isProdVercel) {
    return {
      ok: false,
      reason: 'unset',
      detail:
        'VITE_API_BASE_URL is not set for this build, and Vercel is not proxying /api to RunPod. ' +
        'In Vercel → Settings → Environment Variables → Production, set VITE_API_BASE_URL to your RunPod HTTPS origin (no trailing slash), then redeploy. ' +
        'Or add /api rewrites in frontend/vercel.json (see vercel.rewrites.example.json).',
    };
  }

  const url = `${base}/api/presets`;
  try {
    const res = await axios.get(url, { timeout: 12_000, validateStatus: () => true });
    if (res.status === 200 && Array.isArray(res.data)) {
      return { ok: true };
    }
    if (res.status === 404 && typeof res.data === 'string' && res.data.includes('NOT_FOUND')) {
      return {
        ok: false,
        reason: 'vercel_404',
        detail:
          'GET /api/presets returned Vercel NOT_FOUND — the frontend is not connected to RunPod. ' +
          'Set VITE_API_BASE_URL in Vercel (Production) to your pod URL and redeploy.',
      };
    }
    return {
      ok: false,
      reason: 'unreachable',
      detail: `Backend probe failed (HTTP ${res.status}). Check that your RunPod pod is running and curl ${base || '(origin)'}/health returns {"status":"healthy"}.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'error',
      detail: `Cannot reach the API (${msg}). Verify RunPod is up and VITE_API_BASE_URL / vercel.json rewrites are correct.`,
    };
  }
}
