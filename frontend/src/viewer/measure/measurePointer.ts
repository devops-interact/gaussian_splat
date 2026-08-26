export interface CanvasPointerCoords {
  /** CSS pixels relative to canvas (Babylon scene.pointerX/Y space). */
  cssX: number;
  cssY: number;
  /** Render-buffer pixels (Vector3.Project space). */
  bufferX: number;
  bufferY: number;
}

/** Map a DOM pointer event to CSS and render-buffer canvas coordinates. */
export function canvasCoordsFromPointerEvent(
  canvas: HTMLCanvasElement,
  e: Pick<MouseEvent | PointerEvent, 'clientX' | 'clientY'>,
): CanvasPointerCoords {
  const pickW = canvas.width;
  const pickH = canvas.height;
  const rect = canvas.getBoundingClientRect();
  let cssX: number;
  let cssY: number;

  if (rect.width > 0 && rect.height > 0) {
    cssX = e.clientX - rect.left;
    cssY = e.clientY - rect.top;
  } else {
    const cw = Math.max(1, canvas.clientWidth);
    const ch = Math.max(1, canvas.clientHeight);
    cssX = 'offsetX' in e ? (e as MouseEvent).offsetX : e.clientX - rect.left;
    cssY = 'offsetY' in e ? (e as MouseEvent).offsetY : e.clientY - rect.top;
    cssX = (cssX / cw) * Math.max(1, pickW / Math.max(cw, 1));
    cssY = (cssY / ch) * Math.max(1, pickH / Math.max(ch, 1));
  }

  const clampedCssX = Math.max(0, Math.min(rect.width > 0 ? rect.width : pickW, cssX));
  const clampedCssY = Math.max(0, Math.min(rect.height > 0 ? rect.height : pickH, cssY));

  const scaleX = rect.width > 0 ? pickW / rect.width : 1;
  const scaleY = rect.height > 0 ? pickH / rect.height : 1;

  return {
    cssX: clampedCssX,
    cssY: clampedCssY,
    bufferX: Math.max(0, Math.min(pickW, clampedCssX * scaleX)),
    bufferY: Math.max(0, Math.min(pickH, clampedCssY * scaleY)),
  };
}
