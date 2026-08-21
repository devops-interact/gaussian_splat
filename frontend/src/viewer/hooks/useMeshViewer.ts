import { useEffect, useRef, useState, type RefObject } from 'react';
import { Color4, Engine, Scene, Vector3 } from '@babylonjs/core';
import { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer';
import { isAxiosError, isCancel } from 'axios';
import { getApiBaseUrl } from '@/lib/apiBase';
import type { ModelMetadataResponse } from '@/types/job';
import {
  applyInitialCameraPose,
  attachFramingBehavior,
  bboxFromMesh,
  defaultBboxCameraPosition,
  frameCameraOnMesh,
} from '../camera/framing';
import { storeCameraPose } from '../camera/poseStorage';
import {
  applyOrbitZoomLimitsFromDiagonal,
  setupCamerasFromPose,
} from '../camera/setupCameras';
import { parseViewerSceneScale, modelFetchAbortSignal } from '../constants';
import {
  createCollisionProxy,
  fetchModelBuffer,
  glbModelUrl,
  importGlbBuffer,
  modelMetadataFromJobResponse,
} from '../load/loadMeshScene';
import { addSceneOverlays } from '../overlays/sceneOverlays';
import { showInspectorIfRequested, resetInspectorFlag } from '../dev/inspector';
import type { BabylonViewerCtx, LoadPhase, ModelMetadata, StoredCameraPose } from '../types';

export interface UseMeshViewerOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  modelUrl: string | null;
  jobId?: string | null;
  prefetchedJobModelMetadata?: ModelMetadataResponse | null;
  onModelMetadata?: (meta: ModelMetadata) => void;
}

export interface UseMeshViewerResult {
  viewerRef: RefObject<BabylonViewerCtx | null>;
  initialPoseRef: RefObject<StoredCameraPose | null>;
  loadPhase: LoadPhase;
  loadProgress: number;
  loadLabel: string;
  error: string | null;
  metadataRef: RefObject<ModelMetadata | null>;
  sceneScaleRef: RefObject<number>;
  worldUnitRef: RefObject<number>;
  walkSpeedRef: RefObject<number>;
}

export function useMeshViewer({
  canvasRef,
  modelUrl,
  prefetchedJobModelMetadata = null,
  onModelMetadata,
}: UseMeshViewerOptions): UseMeshViewerResult {
  const viewerRef = useRef<BabylonViewerCtx | null>(null);
  const initialPoseRef = useRef<StoredCameraPose | null>(null);
  const metadataRef = useRef<ModelMetadata | null>(null);
  const sceneScaleRef = useRef(1);
  const worldUnitRef = useRef(0.024);
  const walkSpeedRef = useRef(3);
  const onMetadataRef = useRef(onModelMetadata);
  onMetadataRef.current = onModelMetadata;

  const [loadPhase, setLoadPhase] = useState<LoadPhase>('idle');
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadLabel, setLoadLabel] = useState('Initializing…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !modelUrl) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    const apiBase = getApiBaseUrl();

    setLoadPhase('initializing');
    setLoadProgress(0);
    setLoadLabel('Starting renderer…');
    setError(null);
    resetInspectorFlag();

    const canvas = canvasRef.current;
    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      adaptToDeviceRatio: true,
    });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 1);
    scene.collisionsEnabled = true;

    const sceneScale = parseViewerSceneScale();
    sceneScaleRef.current = sceneScale;
    const provisionalWalk = 3;
    const { orbitCamera, walkCamera } = setupCamerasFromPose(
      scene,
      canvas,
      [0, 2, 5],
      [0, 0, 0],
      [0, 1, 0],
      provisionalWalk,
    );
    walkCamera.checkCollisions = true;
    walkCamera.applyGravity = true;
    walkCamera.ellipsoid = new Vector3(0.25, 0.9, 0.25);

    const framingBehavior = attachFramingBehavior(orbitCamera);
    addSceneOverlays(scene);
    const utilityLayer = new UtilityLayerRenderer(scene);

    engine.runRenderLoop(() => scene.render());
    resizeObserver = new ResizeObserver(() => engine.resize());
    resizeObserver.observe(canvas);

    viewerRef.current = {
      engine,
      scene,
      orbitCamera,
      walkCamera,
      rootMesh: null,
      collisionMesh: null,
      utilityLayer,
      framingBehavior,
    };

    (async () => {
      try {
        setLoadPhase('fetching');
        setLoadLabel('Fetching 3D model…');

        const glbUrl = glbModelUrl(modelUrl, apiBase);
        const fetchSignal = modelFetchAbortSignal();
        const buffer = await fetchModelBuffer(glbUrl, fetchSignal, (pct) => {
          if (!disposed) setLoadProgress(pct);
        });

        if (disposed) return;

        const prefetched = prefetchedJobModelMetadata;
        let modelMeta: ModelMetadata;
        if (prefetched && prefetched.vertex_count) {
          modelMeta = modelMetadataFromJobResponse(prefetched, buffer.byteLength);
        } else {
          modelMeta = {
            vertexCount: 0,
            faceCount: 0,
            pointCount: 0,
            fileSize: buffer.byteLength,
            boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
            hasColors: true,
            hasPbr: true,
            format: 'glb',
          };
        }

        metadataRef.current = modelMeta;
        onMetadataRef.current?.(modelMeta);

        const diag = Math.sqrt(
          (modelMeta.boundingBox.max[0] - modelMeta.boundingBox.min[0]) ** 2 +
          (modelMeta.boundingBox.max[1] - modelMeta.boundingBox.min[1]) ** 2 +
          (modelMeta.boundingBox.max[2] - modelMeta.boundingBox.min[2]) ** 2,
        ) || 2;
        const def = defaultBboxCameraPosition(diag * sceneScale);
        applyInitialCameraPose(orbitCamera, def.position, def.lookAt, [0, 1, 0]);

        setLoadPhase('parsing');
        setLoadLabel('Loading mesh…');

        const { rootMesh } = await importGlbBuffer(scene, buffer);
        if (disposed) return;

        if (sceneScale !== 1) rootMesh.scaling.setAll(sceneScale);
        rootMesh.computeWorldMatrix(true);

        const collisionMesh = createCollisionProxy(scene, rootMesh);
        collisionMesh.scaling.copyFrom(rootMesh.scaling);

        const meshBbox = bboxFromMesh(rootMesh);
        const effectiveDiagonal = meshBbox.diagonal * sceneScale;
        worldUnitRef.current = Math.min(0.12, Math.max(0.008, effectiveDiagonal * 0.004));
        walkSpeedRef.current = Math.min(20, Math.max(1, effectiveDiagonal * 0.5));
        walkCamera.speed = walkSpeedRef.current;
        applyOrbitZoomLimitsFromDiagonal(orbitCamera, effectiveDiagonal);

        modelMeta = {
          ...modelMeta,
          vertexCount: modelMeta.vertexCount || 0,
          boundingBox: { min: meshBbox.min, max: meshBbox.max },
        };
        metadataRef.current = modelMeta;
        onMetadataRef.current?.(modelMeta);

        frameCameraOnMesh(orbitCamera, [rootMesh]);
        initialPoseRef.current = storeCameraPose(orbitCamera);

        viewerRef.current = {
          engine,
          scene,
          orbitCamera,
          walkCamera,
          rootMesh,
          collisionMesh,
          utilityLayer,
          framingBehavior,
        };

        setLoadPhase('ready');
        setLoadLabel('');
        void showInspectorIfRequested(scene);
      } catch (err: unknown) {
        if (!disposed) {
          const msg = err instanceof Error ? err.message : String(err);
          if (isAxiosError(err) && isCancel(err)) return;
          console.error('[Babylon] Mesh viewer error:', msg);
          setError(msg);
          setLoadPhase('error');
        }
      }
    })();

    return () => {
      disposed = true;
      initialPoseRef.current = null;
      sceneScaleRef.current = 1;
      resizeObserver?.disconnect();
      try {
        document.exitPointerLock?.();
      } catch { /* ignore */ }
      utilityLayer.dispose();
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
      viewerRef.current = null;
      resetInspectorFlag();
    };
  }, [modelUrl, prefetchedJobModelMetadata, canvasRef]);

  return {
    viewerRef,
    initialPoseRef,
    loadPhase,
    loadProgress,
    loadLabel,
    error,
    metadataRef,
    sceneScaleRef,
    worldUnitRef,
    walkSpeedRef,
  };
}

// Re-export for backward compatibility during migration
export { useMeshViewer as useBabylonViewer };
