import { Vector3 } from '@babylonjs/core';
import type { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { SceneManifestResponse } from '@/types/job';
import type { BabylonViewerCtx, LoadPhase, StoredCameraPose, ViewerMode } from '../types';
import { restoreCameraPose } from '../camera/poseStorage';
import { resetViewWithFraming } from '../camera/framing';
import { AUTO_ROTATE_ALPHA_SPEED } from '../constants';
import { getWalkStartPoseFromRaw } from '../walk/walkPath';

function configureMeasureOrbitInputs(orbitCamera: import('@babylonjs/core').ArcRotateCamera): void {
  const pointers = orbitCamera.inputs.attached.pointers as ArcRotateCameraPointersInput | null;
  if (pointers) {
    pointers.buttons = [2];
  }
}

function restoreOrbitInputs(orbitCamera: import('@babylonjs/core').ArcRotateCamera): void {
  const pointers = orbitCamera.inputs.attached.pointers as ArcRotateCameraPointersInput | null;
  if (pointers) {
    pointers.buttons = [0, 1, 2];
  }
}

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
      restoreOrbitInputs(orbitCamera);
      scene.activeCamera = orbitCamera;
      orbitCamera.attachControl(canvas, false);
      walkCamera.detachControl();
    } else if (mode === 'walkthrough') {
      restoreOrbitInputs(orbitCamera);
      walkCamera.position.copyFrom(orbitCamera.position);
      const tgt = orbitCamera.getTarget();
      walkCamera.setTarget(tgt);
      if (ctx.collisionMesh) {
        ctx.collisionMesh.checkCollisions = true;
      }
      scene.gravity = new Vector3(0, -Math.max(0.08, ctx.effectiveDiagonal * 0.06), 0);
      scene.activeCamera = walkCamera;
      orbitCamera.detachControl();
      walkCamera.attachControl(canvas, false);
    } else {
      configureMeasureOrbitInputs(orbitCamera);
      scene.activeCamera = orbitCamera;
      orbitCamera.attachControl(canvas, false);
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
    restoreOrbitInputs(orbitCamera);
    scene.activeCamera = orbitCamera;
    orbitCamera.attachControl(canvas, false);
    walkCamera.detachControl();
  };
}

/** Place walk camera at walk_path start when entering walkthrough in room scenes. */
export function applyWalkPathStart(
  ctx: BabylonViewerCtx,
  sceneManifest: SceneManifestResponse | null,
  sceneScale: number,
): boolean {
  if (!sceneManifest?.walk_path?.length || !ctx.walkPath?.length) return false;

  const pose = getWalkStartPoseFromRaw(sceneManifest.walk_path, ctx.roomBounds, sceneScale);
  if (!pose) return false;

  ctx.walkCamera.position.copyFrom(pose.position);
  ctx.walkCamera.setTarget(pose.target);
  return true;
}
