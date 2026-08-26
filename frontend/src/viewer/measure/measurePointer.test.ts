import { describe, expect, it } from 'vitest';
import { canvasCoordsFromPointerEvent } from './measurePointer';

describe('canvasCoordsFromPointerEvent', () => {
  it('maps client coords through getBoundingClientRect to canvas buffer space', () => {
    const canvas = {
      width: 800,
      height: 600,
      clientWidth: 400,
      clientHeight: 300,
      getBoundingClientRect: () => ({
        left: 100,
        top: 50,
        width: 400,
        height: 300,
        right: 500,
        bottom: 350,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }),
    } as HTMLCanvasElement;

    const coords = canvasCoordsFromPointerEvent(canvas, { clientX: 300, clientY: 200 });
    expect(coords.x).toBe(400);
    expect(coords.y).toBe(300);
  });

  it('clamps coordinates to canvas bounds', () => {
    const canvas = {
      width: 100,
      height: 100,
      clientWidth: 100,
      clientHeight: 100,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    } as HTMLCanvasElement;

    const coords = canvasCoordsFromPointerEvent(canvas, { clientX: -50, clientY: 200 });
    expect(coords.x).toBe(0);
    expect(coords.y).toBe(100);
  });
});
