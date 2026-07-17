import { Quaternion, Vector3 } from '@babylonjs/core';

/**
 * Floor-down orientation for LongSplat/3DGS reconstructions.
 *
 * cameras_all.json entries store `R` as the camera-to-world rotation (3DGS / COLMAP
 * convention) and the camera frame has +Y pointing down in the image. The camera's
 * physical "up" in world space is therefore -R·(0,1,0) — the negated second column
 * of R. People film rooms holding the phone roughly upright, so averaging that
 * vector over the first poses gives a robust world-up estimate; rotating the splat
 * mesh so this maps to +Y renders the floor at the bottom.
 */

/** Poses averaged for the up estimate (matches initial_camera's "first cameras" idea). */
export const ORIENTATION_POSE_SAMPLES = 24;

/**
 * 3DGS world convention default when no camera poses are available: +Y points down.
 * Aligning (0,-1,0) → (0,1,0) is the 180° flip that fixes upside-down renders.
 */
export const DEFAULT_SPLAT_WORLD_UP = new Vector3(0, -1, 0);

interface CameraPoseLike {
  R?: unknown;
}

function as3x3(m: unknown): number[][] | null {
  if (!Array.isArray(m) || m.length !== 3) return null;
  const rows: number[][] = [];
  for (const row of m) {
    if (!Array.isArray(row) || row.length !== 3) return null;
    const r = row.map(Number);
    if (r.some((v) => !Number.isFinite(v))) return null;
    rows.push(r);
  }
  return rows;
}

/** Camera's physical up in world coords from a camera-to-world rotation matrix. */
export function cameraUpInWorldFromPose(R: number[][]): Vector3 {
  return new Vector3(-R[0][1], -R[1][1], -R[2][1]);
}

/**
 * Average camera-up over the first `maxSamples` poses of a raw cameras_all.json list.
 * Returns null when the payload has no usable poses or the average is degenerate.
 */
export function estimateWorldUpFromCameras(
  raw: unknown,
  maxSamples: number = ORIENTATION_POSE_SAMPLES,
): Vector3 | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const sum = new Vector3(0, 0, 0);
  let used = 0;
  for (let i = 0; i < raw.length && used < maxSamples; i++) {
    const entry = raw[i] as CameraPoseLike;
    const R = as3x3(entry?.R);
    if (!R) continue;
    const up = cameraUpInWorldFromPose(R);
    const len = up.length();
    if (len < 1e-6) continue;
    sum.addInPlace(up.scaleInPlace(1 / len));
    used++;
  }
  if (used === 0) return null;
  const norm = sum.length();
  if (norm < 1e-6) return null;
  return sum.scaleInPlace(1 / norm);
}

/** Shortest-arc quaternion rotating unit-ish vector `from` onto `to`. */
export function quaternionFromTo(from: Vector3, to: Vector3): Quaternion {
  const f = from.normalizeToNew();
  const t = to.normalizeToNew();
  const d = Vector3.Dot(f, t);
  if (d >= 1 - 1e-9) return Quaternion.Identity();
  if (d <= -1 + 1e-9) {
    // Antiparallel: 180° about any axis perpendicular to `from`.
    let axis = Vector3.Cross(f, new Vector3(1, 0, 0));
    if (axis.lengthSquared() < 1e-8) axis = Vector3.Cross(f, new Vector3(0, 0, 1));
    axis.normalize();
    return Quaternion.RotationAxis(axis, Math.PI);
  }
  const axis = Vector3.Cross(f, t);
  const q = new Quaternion(axis.x, axis.y, axis.z, 1 + d);
  return q.normalize();
}

/** Quaternion that rotates the scene so `worldUp` becomes +Y (floor at the bottom). */
export function upAlignQuaternion(worldUp: Vector3): Quaternion {
  return quaternionFromTo(worldUp, Vector3.Up());
}

/** Rotate a point/vector by a quaternion: v' = q·v·q⁻¹ (unit q assumed). */
export function rotateVectorByQuaternion(v: Vector3, q: Quaternion): Vector3 {
  // v' = v + 2·qv × (qv × v + w·v), qv = (q.x, q.y, q.z)
  const qv = new Vector3(q.x, q.y, q.z);
  const t = Vector3.Cross(qv, Vector3.Cross(qv, v).addInPlace(v.scale(q.w))).scaleInPlace(2);
  return v.add(t);
}

/** Rotate a `[x,y,z]` tuple by a quaternion (convenience for camera pose arrays). */
export function rotateTupleByQuaternion(
  p: [number, number, number],
  q: Quaternion,
): [number, number, number] {
  const r = rotateVectorByQuaternion(new Vector3(p[0], p[1], p[2]), q);
  return [r.x, r.y, r.z];
}
