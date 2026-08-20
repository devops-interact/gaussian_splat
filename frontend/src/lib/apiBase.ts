/**
 * API base URL for axios/fetch.
 * Production on Railway: leave unset — nginx proxies /api to the backend service (same origin).
 * Local dev defaults to http://localhost:8000.
 */
let warnedEmptyProdBase = false;

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (raw != null && String(raw).trim() !== '') {
    return String(raw).replace(/\/+$/, '');
  }
  if (import.meta.env.DEV) {
    return 'http://localhost:8000';
  }
  if (typeof window !== 'undefined' && !warnedEmptyProdBase) {
    warnedEmptyProdBase = true;
    if (window.location.hostname.includes('localhost')) {
      console.warn('[api] VITE_API_BASE_URL unset — using same-origin /api (expected on Railway frontend).');
    }
  }
  return '';
}
