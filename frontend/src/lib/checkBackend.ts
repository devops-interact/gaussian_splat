import axios from 'axios';
import { getApiBaseUrl } from './apiBase';

export type BackendCheckResult =
  | { ok: true }
  | { ok: false; reason: 'unset' | 'vercel_404' | 'unreachable' | 'error'; detail: string };

const HEALTH_TIMEOUT_MS = 12_000;

function crossOriginHint(base: string, isProdVercel: boolean): string {
  if (!base || !isProdVercel) return '';
  return (
    ' Direct RunPod cross-origin calls often show misleading CORS errors when the pod is down (HTTP 524). ' +
    'Prefer unsetting VITE_API_BASE_URL and proxying /api via frontend/vercel.json rewrites.'
  );
}

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
        'Add /api rewrites in frontend/vercel.json (see vercel.rewrites.example.json), redeploy, ' +
        'or set VITE_API_BASE_URL to your RunPod HTTPS origin (no trailing slash).',
    };
  }

  const healthUrl = `${base}/health`;
  try {
    const res = await axios.get(healthUrl, { timeout: HEALTH_TIMEOUT_MS, validateStatus: () => true });
    if (res.status === 200 && res.data?.status === 'healthy') {
      return { ok: true };
    }
    if (res.status === 404 && typeof res.data === 'string' && res.data.includes('NOT_FOUND')) {
      return {
        ok: false,
        reason: 'vercel_404',
        detail:
          'GET /health returned Vercel NOT_FOUND — the frontend is not connected to RunPod. ' +
          'Add /api and /static rewrites in frontend/vercel.json, or set VITE_API_BASE_URL and redeploy.',
      };
    }
    const hint = crossOriginHint(base, isProdVercel);
    return {
      ok: false,
      reason: 'unreachable',
      detail:
        `Backend health probe failed (HTTP ${res.status}). ` +
        `Check that your RunPod pod is running and curl ${base || '(origin)'}/health returns {"status":"healthy"}.${hint}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = crossOriginHint(base, isProdVercel);
    return {
      ok: false,
      reason: 'error',
      detail:
        `Cannot reach the API (${msg}). Verify RunPod is up and vercel.json rewrites or VITE_API_BASE_URL are correct.${hint}`,
    };
  }
}
