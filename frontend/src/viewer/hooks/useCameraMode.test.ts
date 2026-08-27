import { describe, expect, it } from 'vitest';
import { MEASURE_POINTER_BUTTONS } from './useCameraMode';

describe('useCameraMode measure inputs', () => {
  it('uses LMB orbit and RMB pan in measure mode', () => {
    expect(MEASURE_POINTER_BUTTONS).toEqual([0, 2]);
  });
});
