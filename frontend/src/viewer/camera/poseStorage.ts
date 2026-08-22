import { ArcRotateCamera, Vector3 } from '@babylonjs/core';
import type { StoredCameraPose } from '../types';

export function storeCameraPose(cam: ArcRotateCamera): StoredCameraPose {
  return {
    position: [cam.position.x, cam.position.y, cam.position.z],
    target: [cam.target.x, cam.target.y, cam.target.z],
    up: [cam.upVector.x, cam.upVector.y, cam.upVector.z],
    alpha: cam.alpha,
    beta: cam.beta,
    radius: cam.radius,
  };
}

export function restoreCameraPose(cam: ArcRotateCamera, pose: StoredCameraPose): void {
  cam.upVector = new Vector3(pose.up[0], pose.up[1], pose.up[2]);
  cam.setTarget(new Vector3(pose.target[0], pose.target[1], pose.target[2]));
  cam.alpha = pose.alpha;
  cam.beta = pose.beta;
  cam.radius = pose.radius;
}
