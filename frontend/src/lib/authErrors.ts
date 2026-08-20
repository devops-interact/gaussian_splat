import axios from 'axios';
import { getApiBaseUrl } from './apiBase';

export function formatLoginError(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return 'Sign-in failed. Check your connection and try again.';
  }

  const status = err.response?.status;
  const detail = err.response?.data?.detail;
  const apiBase = getApiBaseUrl();
  const apiLabel = apiBase || '(same-origin /api via Railway frontend proxy)';

  if (err.code === 'ERR_NETWORK' || !err.response) {
    return (
      `Cannot reach the API at ${apiLabel}. ` +
      'Confirm the Railway API service is running and the frontend service has BACKEND_URL set correctly. ' +
      'Try a private window if a browser extension blocks requests.'
    );
  }

  if (status === 404) {
    return (
      'API route not found (404). On Railway, set BACKEND_URL on the frontend service to your API URL ' +
      `(e.g. https://your-api.up.railway.app). Current base: ${apiLabel}.`
    );
  }

  if (status === 401 && typeof detail === 'string') {
    return detail;
  }

  if (typeof detail === 'string') {
    return detail;
  }

  return `Sign-in failed (HTTP ${status ?? 'unknown'}). API base: ${apiLabel}`;
}
