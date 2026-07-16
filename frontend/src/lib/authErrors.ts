import axios from 'axios';
import { getApiBaseUrl } from './apiBase';

/** Turn axios/network failures into actionable login errors (avoid generic 401 text on 404/CORS). */
export function formatLoginError(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return 'Sign-in failed. Check your connection and try again.';
  }

  const status = err.response?.status;
  const detail = err.response?.data?.detail;
  const apiBase = getApiBaseUrl();
  const apiLabel = apiBase || '(unset — same-origin /api on Vercel)';

  if (err.code === 'ERR_NETWORK' || !err.response) {
    return (
      `Cannot reach the API at ${apiLabel}. ` +
      'Confirm RunPod is running, VITE_API_BASE_URL is set in Vercel, and redeploy after changing env vars. ' +
      'Browser extensions (e.g. MetaMask) can also block cross-origin requests — try a private window.'
    );
  }

  if (status === 404) {
    const body = typeof err.response.data === 'string' ? err.response.data : '';
    if (body.includes('NOT_FOUND')) {
      return (
        'Login request hit Vercel (404), not RunPod. Set VITE_API_BASE_URL in Vercel → Production to your pod HTTPS URL, redeploy, then hard-refresh (Ctrl+Shift+R).'
      );
    }
    return `API route not found (404). Check VITE_API_BASE_URL (${apiLabel}) and that the pod exposes /api/auth/login.`;
  }

  if (status === 401 && typeof detail === 'string') {
    return detail;
  }

  if (typeof detail === 'string') {
    return detail;
  }

  return `Sign-in failed (HTTP ${status ?? 'unknown'}). API base: ${apiLabel}`;
}
