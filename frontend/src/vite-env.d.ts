/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** When "1" or "true", Viewer3D disables GPU-accelerated sort + shared worker memory even if crossOriginIsolated is true. */
  readonly VITE_GS3D_FORCE_LEGACY_WORKERS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
