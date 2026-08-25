import { describe, expect, it } from 'vitest';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import {
  getWalkStartPose,
  getWalkStartPoseFromRaw,
  parseWalkPath,
  parseWalkTarget,
} from './walkPath';

describe('parseWalkPath', () => {
  it('parses 3D rows with scene scale', () => {
    const path = parseWalkPath([[2, 1.5, 0], [4, 1.5, 0]], 0.5);
    expect(path).toHaveLength(2);
    expect(path[0].x).toBe(1);
    expect(path[0].y).toBe(0.75);
    expect(path[0].z).toBe(0);
  });

  it('returns empty array for null input', () => {
    expect(parseWalkPath(null)).toEqual([]);
    expect(parseWalkPath(undefined)).toEqual([]);
  });
});

describe('parseWalkTarget', () => {
  it('reads explicit look-at from 6D rows', () => {
    const target = parseWalkTarget([0, 0, 0, 1, 2, 3], 1);
    expect(target).not.toBeNull();
    expect(target!.x).toBe(1);
    expect(target!.y).toBe(2);
    expect(target!.z).toBe(3);
  });

  it('returns null for 3D rows', () => {
    expect(parseWalkTarget([1, 2, 3])).toBeNull();
  });
});

describe('getWalkStartPose', () => {
  it('looks at second path point when available', () => {
    const pose = getWalkStartPose(
      [new Vector3(0, 1, 0), new Vector3(2, 1, 0)],
      { min: new Vector3(-1, 0, -1), max: new Vector3(1, 2, 1), diagonal: 2 },
    );
    expect(pose.position.x).toBe(0);
    expect(pose.target.x).toBe(2);
  });

  it('looks at room center for single-point path', () => {
    const pose = getWalkStartPose(
      [new Vector3(0, 1, 0)],
      { min: new Vector3(-2, 0, -2), max: new Vector3(2, 2, 2), diagonal: 4 },
    );
    expect(pose.target.x).toBe(0);
    expect(pose.target.y).toBe(1);
    expect(pose.target.z).toBe(0);
  });
});

describe('getWalkStartPoseFromRaw', () => {
  it('uses 6D target override on first row', () => {
    const pose = getWalkStartPoseFromRaw(
      [[0, 1, 0, 5, 1, 0]],
      { min: new Vector3(-1, 0, -1), max: new Vector3(1, 2, 1), diagonal: 2 },
    );
    expect(pose).not.toBeNull();
    expect(pose!.target.x).toBe(5);
  });
});
