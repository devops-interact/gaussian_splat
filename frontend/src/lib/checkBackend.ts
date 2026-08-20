import axios from 'axios';
import { getApiBaseUrl } from './apiBase';

export type BackendCheckResult =
  | { ok: true }
  | { ok: false; reason: 'unset' | 'proxy_404' | 'unreachable' | 'error'; detail: string };

const HEALTH_TIMEOUT_MS = 12_000;

export async function checkBackendReachable(): Promise<BackendCheckResult> {
  const base = getApiBaseUrl();
  const healthUrl = `${base}/health`;

  try {
    const res = await axios.get(healthUrl, { timeout: HEALTH_TIMEOUT_MS, validateStatus: () => true });
    if (res.status === 200 && res.data?.status === 'healthy') {
      return { ok: true };
    }
    if (res.status === 404) {
      return {
        ok: false,
        reason: 'proxy_404',
        detail:
          'GET /health returned 404. On Railway, set BACKEND_URL on the frontend service to your API service URL ' +
          '(e.g. https://your-api.up.railway.app) and redeploy.',
      };
    }
    return {
      ok: false,
      reason: 'unreachable',
      detail:
        `Backend health probe failed (HTTP ${res.status}). ` +
        `Expected ${healthUrl} to return {"status":"healthy"}.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: 'error',
      detail: `Cannot reach the API (${msg}). Verify the Railway API service is running and BACKEND_URL is correct.`,
    };
  }
}
