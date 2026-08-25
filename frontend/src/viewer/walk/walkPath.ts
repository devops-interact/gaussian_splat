import { Vector3 } from '@babylonjs/core';
import type { RoomBounds } from '../types';

export interface WalkStartPose {
  position: Vector3;
  target: Vector3;
}

/** Parse manifest walk_path rows — supports [x,y,z] and [x,y,z,tx,ty,tz]. */
export function parseWalkPath(
  raw: number[][] | null | undefined,
  sceneScale = 1,
): Vector3[] {
  if (!raw?.length) return [];

  const points: Vector3[] = [];
  for (const row of raw) {
    if (row.length < 3) continue;
    points.push(new Vector3(row[0] * sceneScale, row[1] * sceneScale, row[2] * sceneScale));
  }
  return points;
}

/** Extract look-at target from a row when 6D format is present. */
export function parseWalkTarget(row: number[], sceneScale = 1): Vector3 | null {
  if (row.length >= 6) {
    return new Vector3(row[3] * sceneScale, row[4] * sceneScale, row[5] * sceneScale);
  }
  return null;
}

export function getWalkStartPose(path: Vector3[], roomBounds: RoomBounds): WalkStartPose {
  const position = path[0].clone();
  let target: Vector3;

  if (path.length >= 2) {
    target = path[1].clone();
  } else {
    target = roomBounds.min.add(roomBounds.max).scale(0.5);
  }

  return { position, target };
}

/** Apply walk_path target override when manifest uses 6D rows. */
export function getWalkStartPoseFromRaw(
  raw: number[][] | null | undefined,
  roomBounds: RoomBounds,
  sceneScale = 1,
): WalkStartPose | null {
  const path = parseWalkPath(raw, sceneScale);
  if (path.length === 0) return null;

  const pose = getWalkStartPose(path, roomBounds);
  const explicitTarget = raw?.[0] ? parseWalkTarget(raw[0], sceneScale) : null;
  if (explicitTarget) {
    pose.target = explicitTarget;
  }
  return pose;
}
