export enum JobStatus {
  UPLOADED = "uploaded",
  VALIDATING = "validating",
  EXTRACTING_FRAMES = "extracting_frames",
  SELECTING_KEYFRAMES = "selecting_keyframes",
  SUBMITTING_RECONSTRUCTION = "submitting_reconstruction",
  RECONSTRUCTING = "reconstructing",
  DOWNLOADING_MODEL = "downloading_model",
  COMPOSING_SCENE = "composing_scene",
  COMPLETED = "completed",
  ERROR = "error",
}

export interface ValidationInfo {
  duration?: number;
  resolution?: string;
  fps?: number;
  warnings?: string[];
}

export interface ModelMetadataResponse {
  file_size?: number;
  vertex_count?: number;
  face_count?: number;
  has_colors?: boolean;
  has_pbr?: boolean;
  bounding_box?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  format?: string;
  thumbnail_url?: string;
  meshy_task_id?: string;
}

export interface KeyframeInfo {
  url: string;
  index: number;
  zone_id?: number | null;
  yaw_deg?: number | null;
  sharpness?: number | null;
}

export interface ZoneMeshInfo {
  id: number;
  mesh_url: string;
  meshy_task_id?: string | null;
  transform: number[][];
}

export interface SceneManifestResponse {
  composition_mode: string;
  zones: ZoneMeshInfo[];
  shell_url?: string | null;
  walk_path?: number[][] | null;
  zone_errors?: Record<string, string> | null;
  zone_count?: number | null;
  coverage_span_deg?: number | null;
  normalization_ref_height?: number | null;
}

export interface PresetInfo {
  id: string;
  name: string;
  description: string;
  estimated_minutes: number;
  composition_mode?: string;
}

export interface Job {
  job_id: string;
  status: JobStatus;
  progress: number;
  error_message?: string;
  model_url?: string;
  model_url_obj?: string;
  quality_preset?: string;
  estimated_minutes?: number;
  processing_time_seconds?: number;
  meshy_task_id?: string;
  validation?: ValidationInfo;
  model_metadata?: ModelMetadataResponse;
  keyframes?: KeyframeInfo[];
  scene_manifest?: SceneManifestResponse;
  current_zone?: number;
  total_zones?: number;
  created_at: string;
  updated_at: string;
}

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  progress: number;
  error_message?: string;
  model_url?: string;
  model_url_obj?: string;
  quality_preset?: string;
  estimated_minutes?: number;
  processing_time_seconds?: number;
  meshy_task_id?: string;
  validation?: ValidationInfo;
  model_metadata?: ModelMetadataResponse;
  keyframes?: KeyframeInfo[];
  scene_manifest?: SceneManifestResponse;
  current_zone?: number;
  total_zones?: number;
  created_at: string;
  updated_at: string;
}
