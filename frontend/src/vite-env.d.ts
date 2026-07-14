/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** Uniform scale for splat mesh + camera framing (e.g. 2). Clamped 0.25–10. */
  readonly VITE_VIEWER_SCENE_SCALE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
