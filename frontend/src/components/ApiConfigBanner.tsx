import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { checkBackendReachable, type BackendCheckResult } from '@/lib/checkBackend';

export function ApiConfigBanner() {
  const [result, setResult] = useState<BackendCheckResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkBackendReachable().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!result || result.ok) return null;

  return (
    <div className="mx-auto mb-6 max-w-lg rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-left">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-amber-200">API not configured</p>
          <p className="text-amber-100/80 leading-snug">{result.detail}</p>
          <p className="text-amber-100/60 text-xs pt-1">
            Demo login only works after the backend is reachable.
          </p>
        </div>
      </div>
    </div>
  );
}
