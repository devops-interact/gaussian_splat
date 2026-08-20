import type { AbstractMesh, ArcRotateCamera, Engine, Scene, UniversalCamera } from '@babylonjs/core';
import type { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer';
import type { FramingBehavior } from '@babylonjs/core/Behaviors/Cameras/framingBehavior';
import type { ModelMetadataResponse } from '@/types/job';

export interface Viewer3DProps {
  modelUrl: string | null;
  jobId?: string | null;
  prefetchedJobModelMetadata?: ModelMetadataResponse | null;
  onModelMetadata?: (meta: ModelMetadata) => void;
}

export interface ModelMetadata {
  vertexCount: number;
  faceCount: number;
  fileSize: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  hasColors: boolean;
  hasPbr: boolean;
  format: string;
  /** Legacy alias */
  pointCount: number;
  hasOpacity: boolean;
  properties: string[];
}

export type ViewerMode = 'orbit' | 'walkthrough' | 'measure';

export type LoadPhase = 'idle' | 'initializing' | 'fetching' | 'parsing' | 'ready' | 'error';

export interface StoredCameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  alpha: number;
  beta: number;
  radius: number;
}

export interface MeasurePoint {
  position: import('@babylonjs/core').Vector3;
}

export type MeasurePhase = 'calibrate' | 'measure';

export interface CalibrationState {
  points: MeasurePoint[];
  rawDistance: number;
  realMeters: number;
  scaleFactor: number;
}

export interface BabylonViewerCtx {
  engine: Engine;
  scene: Scene;
  orbitCamera: ArcRotateCamera;
  walkCamera: UniversalCamera;
  rootMesh: AbstractMesh | null;
  collisionMesh: AbstractMesh | null;
  utilityLayer: UtilityLayerRenderer;
  framingBehavior: FramingBehavior;
}
