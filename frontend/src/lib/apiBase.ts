/**
 * Production builds must not default to localhost — the browser would call the user's machine.
 * If unset in production, return '' so requests use same-origin paths like `/api/...`
 * (configure Vercel rewrites to proxy to RunPod) or set VITE_API_BASE_URL at build time.
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
    const h = window.location.hostname;
    if (h.endsWith('.vercel.app') || h.includes('vercel')) {
      console.error(
        '[api] VITE_API_BASE_URL is unset in this production build. Set it in Vercel Environment Variables, or add vercel.json rewrites so /api routes to your RunPod URL.',
      );
    }
  }
  return '';
}
