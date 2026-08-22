import { useEffect } from 'react';
import type { RefObject } from 'react';
import { Vector3 } from '@babylonjs/core';
import type { SceneManifestResponse } from '@/types/job';
import type { BabylonViewerCtx, LoadPhase, ViewerMode } from '../types';

/** Walkthrough uses Babylon UniversalCamera; optionally positions from manifest walk_path. */
export function useWalkthroughMode(
  viewerRef: RefObject<BabylonViewerCtx | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  mode: ViewerMode,
  loadPhase: LoadPhase,
  sceneManifest?: SceneManifestResponse | null,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loadPhase !== 'ready') return;

    if (mode !== 'walkthrough') {
      try {
        document.exitPointerLock?.();
      } catch { /* ignore */ }
      return;
    }

    const ctx = viewerRef.current;
    if (!ctx || !sceneManifest?.walk_path?.length) return;

    const first = sceneManifest.walk_path[0];
    if (first.length >= 3) {
      ctx.walkCamera.position = new Vector3(first[0], first[1] ?? 1.6, first[2]);
      if (first.length >= 6) {
        const target = new Vector3(first[3], first[4], first[5]);
        ctx.walkCamera.setTarget(target);
      }
    }
  }, [mode, loadPhase, canvasRef, viewerRef, sceneManifest]);
}
