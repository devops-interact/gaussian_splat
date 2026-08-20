import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { BabylonViewerCtx, LoadPhase, ViewerMode } from '../types';

/** Walkthrough uses Babylon UniversalCamera native inputs — no second RAF loop. */
export function useWalkthroughMode(
  viewerRef: RefObject<BabylonViewerCtx | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  mode: ViewerMode,
  loadPhase: LoadPhase,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loadPhase !== 'ready') return;

    if (mode !== 'walkthrough') {
      try {
        document.exitPointerLock?.();
      } catch { /* ignore */ }
    }
  }, [mode, loadPhase, canvasRef, viewerRef]);
}
