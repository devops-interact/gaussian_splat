export enum JobStatus {
  UPLOADED = "uploaded",
  VALIDATING = "validating",
  EXTRACTING_FRAMES = "extracting_frames",
  SELECTING_KEYFRAMES = "selecting_keyframes",
  SUBMITTING_RECONSTRUCTION = "submitting_reconstruction",
  RECONSTRUCTING = "reconstructing",
  DOWNLOADING_MODEL = "downloading_model",
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
  point_count?: number;
  has_colors?: boolean;
  has_pbr?: boolean;
  has_opacity?: boolean;
  bounding_box?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  format?: string;
  thumbnail_url?: string;
  meshy_task_id?: string;
  properties?: string[];
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
  created_at: string;
  updated_at: string;
}
