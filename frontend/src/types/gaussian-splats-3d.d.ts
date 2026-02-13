declare module '@mkkellogg/gaussian-splats-3d' {
  import * as THREE from 'three';

  export enum LogLevel {
    None = 0,
    Error = 1,
    Warning = 2,
    Info = 3,
    Debug = 4,
  }

  export enum RenderMode {
    Always = 0,
    OnChange = 1,
    Never = 2,
  }

  export enum SceneRevealMode {
    Default = 0,
    Gradual = 1,
    Instant = 2,
  }

  export interface DropInViewerOptions {
    gpuAcceleratedSort?: boolean;
    sharedMemoryForWorkers?: boolean;
    logLevel?: LogLevel;
    renderMode?: RenderMode;
    sceneRevealMode?: SceneRevealMode;
    dynamicScene?: boolean;
    freeIntermediateSplatData?: boolean;
    inMemoryCompressionLevel?: number;
    antialiased?: boolean;
    maxScreenSpaceSplatSize?: number;
  }

  export interface SplatSceneOptions {
    splatAlphaRemovalThreshold?: number;
    showLoadingUI?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    progressiveLoad?: boolean;
    format?: number;
    streamView?: boolean;
  }

  export class DropInViewer extends THREE.Group {
    constructor(options?: DropInViewerOptions);
    addSplatScene(url: string, options?: SplatSceneOptions): Promise<void>;
    addSplatScenes(
      scenes: Array<{ path: string; options?: SplatSceneOptions }>,
      showLoadingUI?: boolean,
    ): Promise<void>;
    getSplatCount(): number;
    dispose(): void;
    start(): void;
    stop(): void;
  }

  export class Viewer {
    constructor(options?: Record<string, unknown>);
    addSplatScene(url: string, options?: SplatSceneOptions): Promise<void>;
    start(): void;
    stop(): void;
    dispose(): void;
    getSplatCount(): number;
  }
}
