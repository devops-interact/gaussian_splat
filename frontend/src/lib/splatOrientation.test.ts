import { describe, expect, it } from 'vitest';
import { Vector3 } from '@babylonjs/core';
import {
  cameraUpInWorldFromPose,
  DEFAULT_SPLAT_WORLD_UP,
  estimateWorldUpFromCameras,
  quaternionFromTo,
  rotateTupleByQuaternion,
  rotateVectorByQuaternion,
  upAlignQuaternion,
} from './splatOrientation';

const I3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

describe('cameraUpInWorldFromPose', () => {
  it('identity camera-to-world rotation gives world up (0,-1,0) — COLMAP Y-down camera', () => {
    const up = cameraUpInWorldFromPose(I3);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-1);
    expect(up.z).toBeCloseTo(0);
  });

  it('reads the negated second column of R', () => {
    // R with second column (0, 0, 1): camera up in world = (0, 0, -1)
    const R = [
      [1, 0, 0],
      [0, 0, -1],
      [0, 1, 0],
    ];
    const up = cameraUpInWorldFromPose(R);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(0);
    expect(up.z).toBeCloseTo(-1);
  });
});

describe('estimateWorldUpFromCameras', () => {
  it('averages up vectors over the first poses', () => {
    const raw = [{ R: I3, T: [0, 0, 0] }, { R: I3, T: [1, 2, 3] }];
    const up = estimateWorldUpFromCameras(raw);
    expect(up).not.toBeNull();
    expect(up!.y).toBeCloseTo(-1);
    expect(up!.length()).toBeCloseTo(1);
  });

  it('returns null for invalid payloads', () => {
    expect(estimateWorldUpFromCameras(null)).toBeNull();
    expect(estimateWorldUpFromCameras([])).toBeNull();
    expect(estimateWorldUpFromCameras([{ R: [[1, 2], [3, 4]] }])).toBeNull();
    expect(estimateWorldUpFromCameras({ not: 'a list' })).toBeNull();
  });

  it('skips malformed entries but uses valid ones', () => {
    const raw = [{ R: 'bad' }, { R: I3 }];
    const up = estimateWorldUpFromCameras(raw);
    expect(up).not.toBeNull();
    expect(up!.y).toBeCloseTo(-1);
  });
});

describe('quaternionFromTo / upAlignQuaternion', () => {
  it('rotates an arbitrary up vector onto +Y', () => {
    const worldUp = new Vector3(0.3, -0.9, 0.2).normalize();
    const q = upAlignQuaternion(worldUp);
    const rotated = rotateVectorByQuaternion(worldUp, q);
    expect(rotated.x).toBeCloseTo(0, 5);
    expect(rotated.y).toBeCloseTo(1, 5);
    expect(rotated.z).toBeCloseTo(0, 5);
  });

  it('handles the antiparallel 3DGS default (0,-1,0) → (0,1,0) as a 180° flip', () => {
    const q = upAlignQuaternion(DEFAULT_SPLAT_WORLD_UP);
    const rotated = rotateVectorByQuaternion(new Vector3(0, -1, 0), q);
    expect(rotated.y).toBeCloseTo(1, 5);
    // Rotation must preserve lengths.
    const v = rotateVectorByQuaternion(new Vector3(1, 2, 3), q);
    expect(v.length()).toBeCloseTo(new Vector3(1, 2, 3).length(), 5);
  });

  it('is the identity when already aligned', () => {
    const q = quaternionFromTo(new Vector3(0, 1, 0), new Vector3(0, 1, 0));
    const v = rotateVectorByQuaternion(new Vector3(1, 2, 3), q);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(2);
    expect(v.z).toBeCloseTo(3);
  });
});

describe('rotateTupleByQuaternion', () => {
  it('matches the vector rotation', () => {
    const q = upAlignQuaternion(new Vector3(1, 0, 0));
    const [x, y, z] = rotateTupleByQuaternion([1, 0, 0], q);
    expect(x).toBeCloseTo(0, 5);
    expect(y).toBeCloseTo(1, 5);
    expect(z).toBeCloseTo(0, 5);
  });
});
