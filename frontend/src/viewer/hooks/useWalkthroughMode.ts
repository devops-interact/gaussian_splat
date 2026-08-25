import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { SceneManifestResponse } from '@/types/job';
import type { BabylonViewerCtx, LoadPhase, ViewerMode } from '../types';
import { applyWalkPathStart } from './useCameraMode';

/** Walkthrough uses Babylon UniversalCamera — orbit→walk copies position in useCameraMode. */
export function useWalkthroughMode(
  viewerRef: RefObject<BabylonViewerCtx | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  mode: ViewerMode,
  loadPhase: LoadPhase,
  sceneManifest: SceneManifestResponse | null,
  sceneScaleRef: RefObject<number>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = viewerRef.current;
    if (!canvas || loadPhase !== 'ready') return;

    if (mode !== 'walkthrough') {
      try {
        document.exitPointerLock?.();
      } catch { /* ignore */ }
      return;
    }

    if (ctx) {
      applyWalkPathStart(ctx, sceneManifest, sceneScaleRef.current ?? 1);
    }
  }, [mode, loadPhase, canvasRef, viewerRef, sceneManifest, sceneScaleRef]);
}
