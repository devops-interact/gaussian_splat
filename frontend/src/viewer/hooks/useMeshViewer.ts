import { useEffect, useRef, useState, type RefObject } from 'react';
import { Color4, Engine, Scene, Vector3 } from '@babylonjs/core';
import '@/viewer/babylonSetup';
import { UtilityLayerRenderer } from '@babylonjs/core/Rendering/utilityLayerRenderer';
import { isAxiosError, isCancel } from 'axios';
import { getApiBaseUrl } from '@/lib/apiBase';
import type { ModelMetadataResponse } from '@/types/job';
import type { SceneManifestResponse } from '@/types/job';
import {
  applyInitialCameraPose,
  attachFramingBehavior,
  bboxCentroid,
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
  importComposedScene,
  importGlbBuffer,
  isRoomManifest,
  modelMetadataFromJobResponse,
} from '../load/loadMeshScene';
import { addSceneOverlays, alignGridToFloor } from '../overlays/sceneOverlays';
import { setupSceneLighting } from '../lighting/sceneLighting';
import { showInspectorIfRequested, resetInspectorFlag } from '../dev/inspector';
import type { BabylonViewerCtx, LoadPhase, ModelMetadata, StoredCameraPose } from '../types';

export interface UseMeshViewerOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  modelUrl: string | null;
  jobId?: string | null;
  prefetchedJobModelMetadata?: ModelMetadataResponse | null;
  sceneManifest?: SceneManifestResponse | null;
  onModelMetadata?: (meta: ModelMetadata) => void;
  onZoneLoadWarning?: (message: string | null) => void;
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
  zoneMeshes: import('../load/loadMeshScene').ZoneMeshHandle[];
}

export function useMeshViewer({
  canvasRef,
  modelUrl,
  prefetchedJobModelMetadata = null,
  sceneManifest = null,
  onModelMetadata,
  onZoneLoadWarning,
}: UseMeshViewerOptions): UseMeshViewerResult {
  const viewerRef = useRef<BabylonViewerCtx | null>(null);
  const initialPoseRef = useRef<StoredCameraPose | null>(null);
  const metadataRef = useRef<ModelMetadata | null>(null);
  const sceneScaleRef = useRef(1);
  const worldUnitRef = useRef(0.024);
  const walkSpeedRef = useRef(3);
  const onMetadataRef = useRef(onModelMetadata);
  onMetadataRef.current = onModelMetadata;
  const onZoneLoadWarningRef = useRef(onZoneLoadWarning);
  onZoneLoadWarningRef.current = onZoneLoadWarning;

  const [loadPhase, setLoadPhase] = useState<LoadPhase>('idle');
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadLabel, setLoadLabel] = useState('Initializing…');
  const [error, setError] = useState<string | null>(null);
  const [zoneMeshes, setZoneMeshes] = useState<import('../load/loadMeshScene').ZoneMeshHandle[]>([]);

  useEffect(() => {
    const hasScene = isRoomManifest(sceneManifest);
    if (!canvasRef.current || (!modelUrl && !hasScene)) return;

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
    setupSceneLighting(scene);

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
      geometryMeshes: [],
      zoneMeshes: [],
      collisionMesh: null,
      utilityLayer,
      framingBehavior,
      floorY: 0,
      effectiveDiagonal: 2,
    };

    (async () => {
      try {
        const isComposed = isRoomManifest(sceneManifest);
        let buffer: ArrayBuffer | null = null;

        if (!isComposed) {
          setLoadPhase('fetching');
          setLoadLabel('Fetching 3D model…');

          const glbUrl = glbModelUrl(modelUrl!, apiBase);
          const fetchSignal = modelFetchAbortSignal();
          buffer = await fetchModelBuffer(glbUrl, fetchSignal, (pct) => {
            if (!disposed) setLoadProgress(pct);
          });
          if (disposed) return;
        } else {
          setLoadPhase('fetching');
          setLoadLabel('Loading room zones…');
          setLoadProgress(10);
        }

        const prefetched = prefetchedJobModelMetadata;
        let modelMeta: ModelMetadata;
        if (prefetched && prefetched.vertex_count) {
          modelMeta = modelMetadataFromJobResponse(prefetched, buffer?.byteLength ?? 0);
        } else {
          modelMeta = {
            vertexCount: 0,
            faceCount: 0,
            pointCount: 0,
            fileSize: buffer?.byteLength ?? 0,
            boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
            hasColors: true,
            hasPbr: true,
            format: 'glb',
          };
        }

        metadataRef.current = modelMeta;
        onMetadataRef.current?.(modelMeta);

        const prefetchedCentroid = bboxCentroid(
          modelMeta.boundingBox.min,
          modelMeta.boundingBox.max,
        );
        const diag = Math.sqrt(
          (modelMeta.boundingBox.max[0] - modelMeta.boundingBox.min[0]) ** 2 +
          (modelMeta.boundingBox.max[1] - modelMeta.boundingBox.min[1]) ** 2 +
          (modelMeta.boundingBox.max[2] - modelMeta.boundingBox.min[2]) ** 2,
        ) || 2;
        const def = defaultBboxCameraPosition(diag, prefetchedCentroid);
        applyInitialCameraPose(orbitCamera, def.position, def.lookAt, [0, 1, 0]);

        setLoadPhase('parsing');
        setLoadLabel(isComposed ? 'Loading room scene…' : 'Loading mesh…');

        let rootMesh;
        let geometryMeshes;
        let zoneMeshes: import('../load/loadMeshScene').ZoneMeshHandle[] = [];

        if (isComposed && sceneManifest) {
          const composed = await importComposedScene(scene, sceneManifest, apiBase);
          rootMesh = composed.rootMesh;
          geometryMeshes = composed.geometryMeshes;
          zoneMeshes = composed.zoneMeshes;
          if (composed.emptyZoneIds.length > 0) {
            onZoneLoadWarningRef.current?.(
              `${composed.emptyZoneIds.length} zone(s) have no visible geometry (zone ${composed.emptyZoneIds.join(', ')}).`,
            );
          } else {
            onZoneLoadWarningRef.current?.(null);
          }
          for (const mesh of geometryMeshes) {
            mesh.computeWorldMatrix(true);
            mesh.getBoundingInfo().update(mesh.getWorldMatrix());
          }
        } else {
          onZoneLoadWarningRef.current?.(null);
          const imported = await importGlbBuffer(scene, buffer!);
          rootMesh = imported.rootMesh;
          geometryMeshes = imported.geometryMeshes;
        }
        if (disposed) return;

        if (sceneScale !== 1) rootMesh.scaling.setAll(sceneScale);
        rootMesh.computeWorldMatrix(true);

        const collisionMesh = createCollisionProxy(scene, rootMesh);

        const meshBbox = bboxFromMesh(rootMesh);
        const effectiveDiagonal = meshBbox.diagonal;
        const floorY = meshBbox.min[1];
        alignGridToFloor(scene, floorY);

        const ellipsoidH = Math.max(0.15, effectiveDiagonal * 0.04);
        walkCamera.ellipsoid = new Vector3(ellipsoidH * 0.28, ellipsoidH, ellipsoidH * 0.28);
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

        const frameTargets = geometryMeshes.length > 0 ? geometryMeshes : [rootMesh];
        frameCameraOnMesh(orbitCamera, frameTargets);
        initialPoseRef.current = storeCameraPose(orbitCamera);

        viewerRef.current = {
          engine,
          scene,
          orbitCamera,
          walkCamera,
          rootMesh,
          geometryMeshes,
          zoneMeshes,
          collisionMesh,
          utilityLayer,
          framingBehavior,
          floorY,
          effectiveDiagonal,
        };
        setZoneMeshes(zoneMeshes);

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
      setZoneMeshes([]);
      resetInspectorFlag();
    };
  }, [modelUrl, prefetchedJobModelMetadata, sceneManifest, canvasRef]);

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
    zoneMeshes,
  };
}

// Re-export for backward compatibility during migration
export { useMeshViewer as useBabylonViewer };
