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

  /**
   * Standalone Viewer — creates its own canvas, renderer, camera,
   * orbit controls, and render loop inside the given rootElement.
   */
  export class Viewer {
    constructor(options?: Record<string, unknown>);
    addSplatScene(url: string, options?: SplatSceneOptions): Promise<void>;
    addSplatScenes(
      scenes: Array<{ path: string; options?: SplatSceneOptions }>,
      showLoadingUI?: boolean,
    ): Promise<void>;
    start(): void;
    stop(): void;
    update(): void;
    render(): void;
    dispose(): void;

    // Internal properties (accessible at runtime)
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    threeScene: THREE.Scene;
    controls: unknown;
    rootElement: HTMLElement;
    splatMesh: THREE.Object3D;
  }

  /**
   * Drop-in viewer that can be added to an existing Three.js scene.
   * Extends THREE.Group. Less reliable inside React Three Fiber.
   */
  export class DropInViewer extends THREE.Group {
    constructor(options?: Record<string, unknown>);
    addSplatScene(url: string, options?: SplatSceneOptions): Promise<void>;
    addSplatScenes(
      scenes: Array<{ path: string; options?: SplatSceneOptions }>,
      showLoadingUI?: boolean,
    ): Promise<void>;
    dispose(): void;
    start(): void;
    stop(): void;
  }
}
