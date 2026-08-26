export interface CanvasPointerCoords {
  x: number;
  y: number;
}

/** Map a DOM pointer event to Babylon canvas buffer coordinates (DPR-aware). */
export function canvasCoordsFromPointerEvent(
  canvas: HTMLCanvasElement,
  e: Pick<MouseEvent | PointerEvent, 'clientX' | 'clientY'>,
): CanvasPointerCoords {
  const pickW = canvas.width;
  const pickH = canvas.height;
  const rect = canvas.getBoundingClientRect();
  let mouseX: number;
  let mouseY: number;

  if (rect.width > 0 && rect.height > 0) {
    mouseX = ((e.clientX - rect.left) / rect.width) * pickW;
    mouseY = ((e.clientY - rect.top) / rect.height) * pickH;
  } else {
    const cw = Math.max(1, canvas.clientWidth);
    const ch = Math.max(1, canvas.clientHeight);
    const offsetX = 'offsetX' in e ? (e as MouseEvent).offsetX : e.clientX - rect.left;
    const offsetY = 'offsetY' in e ? (e as MouseEvent).offsetY : e.clientY - rect.top;
    mouseX = (offsetX / cw) * pickW;
    mouseY = (offsetY / ch) * pickH;
  }

  return {
    x: Math.max(0, Math.min(pickW, mouseX)),
    y: Math.max(0, Math.min(pickH, mouseY)),
  };
}
