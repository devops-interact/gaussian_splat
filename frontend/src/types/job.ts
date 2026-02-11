export enum JobStatus {
  UPLOADED = "uploaded",
  VALIDATING = "validating",
  EXTRACTING_FRAMES = "extracting_frames",
  TRAINING = "training",  // LongSplat handles pose estimation + training together
  EXPORTING = "exporting",
  COMPRESSING = "compressing",
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
  point_count?: number;
  has_colors?: boolean;
  has_opacity?: boolean;
  bounding_box?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  properties?: string[];
  format?: string;
}

export interface Job {
  job_id: string;
  status: JobStatus;
  progress: number;
  error_message?: string;
  model_url?: string;
  model_url_compressed?: string;
  quality_preset?: string;
  estimated_minutes?: number;
  processing_time_seconds?: number;
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
  model_url_compressed?: string;
  quality_preset?: string;
  estimated_minutes?: number;
  processing_time_seconds?: number;
  validation?: ValidationInfo;
  model_metadata?: ModelMetadataResponse;
  created_at: string;
  updated_at: string;
}
