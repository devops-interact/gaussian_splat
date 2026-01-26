export enum JobStatus {
  UPLOADED = "uploaded",
  EXTRACTING_FRAMES = "extracting_frames",
  TRAINING = "training",  // LongSplat handles pose estimation + training together
  EXPORTING = "exporting",
  COMPLETED = "completed",
  ERROR = "error",
}

export interface Job {
  job_id: string;
  status: JobStatus;
  progress: number;
  error_message?: string;
  model_url?: string;
  created_at: string;
  updated_at: string;
}

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  progress: number;
  error_message?: string;
  model_url?: string;
  created_at: string;
  updated_at: string;
}
