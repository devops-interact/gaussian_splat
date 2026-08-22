import type { LightingState } from '@/viewer/lighting/sceneLighting';

const STORAGE_KEY = 'meshup_viewer_settings';

export interface ViewerSettings {
  sceneScale: number;
  lighting: LightingState;
  exposure: number;
}

const DEFAULTS: ViewerSettings = {
  sceneScale: 1,
  lighting: {
    hemiIntensity: 0.9,
    dirIntensity: 0.65,
    envIntensity: 1,
  },
  exposure: 1,
};

export function loadViewerSettings(): ViewerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<ViewerSettings>;
    return {
      sceneScale: typeof parsed.sceneScale === 'number' ? parsed.sceneScale : DEFAULTS.sceneScale,
      lighting: {
        hemiIntensity: parsed.lighting?.hemiIntensity ?? DEFAULTS.lighting.hemiIntensity,
        dirIntensity: parsed.lighting?.dirIntensity ?? DEFAULTS.lighting.dirIntensity,
        envIntensity: parsed.lighting?.envIntensity ?? DEFAULTS.lighting.envIntensity,
      },
      exposure: typeof parsed.exposure === 'number' ? parsed.exposure : DEFAULTS.exposure,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveViewerSettings(settings: ViewerSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getSceneScale(): number {
  const env = import.meta.env.VITE_VIEWER_SCENE_SCALE;
  if (env !== undefined && env !== '') {
    const n = Number(String(env).trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return loadViewerSettings().sceneScale;
}
