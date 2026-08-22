import { Vector3 } from '@babylonjs/core';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { BabylonViewerCtx, LoadPhase, StoredCameraPose, ViewerMode } from '../types';
import { restoreCameraPose } from '../camera/poseStorage';
import { resetViewWithFraming } from '../camera/framing';
import { AUTO_ROTATE_ALPHA_SPEED } from '../constants';

export function useCameraMode(
  viewerRef: RefObject<BabylonViewerCtx | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  mode: ViewerMode,
  loadPhase: LoadPhase,
  autoRotate: boolean,
): void {
  const beforeRenderRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const ctx = viewerRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas || loadPhase !== 'ready') return;

    const { scene, orbitCamera, walkCamera } = ctx;

    if (mode === 'orbit') {
      scene.activeCamera = orbitCamera;
      orbitCamera.attachControl(canvas, true);
      walkCamera.detachControl();
    } else if (mode === 'walkthrough') {
      walkCamera.position.copyFrom(orbitCamera.position);
      const tgt = orbitCamera.getTarget();
      walkCamera.setTarget(tgt);
      if (ctx.collisionMesh) {
        ctx.collisionMesh.checkCollisions = true;
      }
      scene.gravity = new Vector3(0, -Math.max(0.08, ctx.effectiveDiagonal * 0.06), 0);
      scene.activeCamera = walkCamera;
      orbitCamera.detachControl();
      walkCamera.attachControl(canvas, true);
    } else {
      // measure — orbit stays active camera but controls detached for picking
      scene.activeCamera = orbitCamera;
      orbitCamera.detachControl();
      walkCamera.detachControl();
    }
  }, [mode, loadPhase, viewerRef, canvasRef]);

  useEffect(() => {
    const ctx = viewerRef.current;
    if (!ctx || loadPhase !== 'ready') return;

    const { scene, orbitCamera } = ctx;
    if (beforeRenderRef.current) {
      scene.onBeforeRenderObservable.removeCallback(beforeRenderRef.current);
      beforeRenderRef.current = null;
    }

    if (autoRotate && mode === 'orbit') {
      const cb = () => {
        orbitCamera.alpha += AUTO_ROTATE_ALPHA_SPEED;
      };
      beforeRenderRef.current = cb;
      scene.onBeforeRenderObservable.add(cb);
    }

    return () => {
      if (beforeRenderRef.current) {
        scene.onBeforeRenderObservable.removeCallback(beforeRenderRef.current);
        beforeRenderRef.current = null;
      }
    };
  }, [autoRotate, mode, loadPhase, viewerRef]);
}

export function useResetView(
  viewerRef: RefObject<BabylonViewerCtx | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  initialPoseRef: RefObject<StoredCameraPose | null>,
): () => void {
  return () => {
    const ctx = viewerRef.current;
    const canvas = canvasRef.current;
    const pose = initialPoseRef.current;
    if (!ctx || !canvas) return;
    const { orbitCamera, walkCamera, scene, rootMesh, framingBehavior } = ctx;

    if (pose) {
      restoreCameraPose(orbitCamera, pose);
    } else if (rootMesh) {
      resetViewWithFraming(orbitCamera, framingBehavior, rootMesh, true);
    }

    walkCamera.position.copyFrom(orbitCamera.position);
    walkCamera.setTarget(orbitCamera.getTarget());
    walkCamera.upVector.copyFrom(orbitCamera.upVector);
    scene.activeCamera = orbitCamera;
    orbitCamera.attachControl(canvas, true);
    walkCamera.detachControl();
  };
}
