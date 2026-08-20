import { describe, expect, it } from 'vitest';
import { maxMeshPickDistance } from './meshPick';

describe('maxMeshPickDistance', () => {
  it('returns half diagonal with minimum floor', () => {
    const d = maxMeshPickDistance({ min: [0, 0, 0], max: [10, 0, 0] });
    expect(d).toBeGreaterThanOrEqual(0.05);
    expect(d).toBe(5);
  });
});
