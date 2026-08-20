import type { Scene } from '@babylonjs/core';

let inspectorShown = false;

export function isInspectorEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('inspector') === '1';
}

export async function showInspectorIfRequested(scene: Scene): Promise<void> {
  if (!isInspectorEnabled() || inspectorShown) return;
  try {
    const { ShowInspector } = await import('@babylonjs/inspector');
    ShowInspector(scene, {});
    inspectorShown = true;
    console.info('[Babylon] Inspector opened (?inspector=1)');
  } catch (e) {
    console.warn('[Babylon] Inspector failed to load:', e);
  }
}

export function resetInspectorFlag(): void {
  inspectorShown = false;
}
