import axios from 'axios';
import { JobStatusResponse } from '../types/job';
import { getApiBaseUrl } from '../lib/apiBase';

const API_BASE_URL = getApiBaseUrl();
const API_JOBS_URL = `${API_BASE_URL}/api/jobs`;

export interface UploadResponse {
  job_id: string;
  scan_id?: number;
  project_id?: number;
  status: string;
  quality_preset: string;
  estimated_minutes: number;
  message: string;
  warnings?: string[];
  video_info?: {
    duration: number;
    resolution: string;
    fps: number;
  };
}

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const uploadVideo = async (
  file: File,
  qualityPreset: string = 'balanced',
  projectId?: number,
  scanId?: number
): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('quality_preset', qualityPreset);
  if (projectId != null) formData.append('project_id', String(projectId));
  if (scanId != null) formData.append('scan_id', String(scanId));

  const response = await axios.post(`${API_JOBS_URL}/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      ...getAuthHeaders(),
    },
  });

  return response.data;
};

export const getJobStatus = async (
  jobId: string,
  opts?: { signal?: AbortSignal },
): Promise<JobStatusResponse> => {
  const response = await axios.get(`${API_JOBS_URL}/${jobId}/status`, {
    signal: opts?.signal,
  });
  return response.data;
};

export const downloadModel = async (jobId: string, compressed: boolean = false): Promise<Blob> => {
  const url = compressed 
    ? `${API_JOBS_URL}/${jobId}/model?compressed=true`
    : `${API_JOBS_URL}/${jobId}/model`;
    
  const response = await axios.get(url, {
    responseType: 'blob',
  });
  return response.data;
};

export const getPreviewUrl = async (jobId: string): Promise<{ preview_url: string; model_filename: string }> => {
  const response = await axios.get(`${API_JOBS_URL}/${jobId}/preview`);
  return response.data;
};

export interface InitialCameraResponse {
  position: [number, number, number];
  target: [number, number, number];
  /** Camera-up in world coords (newer backends); used for floor-down mesh orientation. */
  up?: [number, number, number];
}

const INITIAL_CAMERA_TIMEOUT_MS = 8000;

/** Suggested viewer pose from first 24 LongSplat cameras + ply center offset (404 if unavailable). */
export const getInitialCamera = async (
  jobId: string,
  opts?: { signal?: AbortSignal },
): Promise<InitialCameraResponse> => {
  const response = await axios.get<InitialCameraResponse>(`${API_JOBS_URL}/${jobId}/initial_camera`, {
    headers: { ...getAuthHeaders() },
    timeout: INITIAL_CAMERA_TIMEOUT_MS,
    signal: opts?.signal,
  });
  return response.data;
};

const CAMERAS_TIMEOUT_MS = 8000;

/**
 * Raw LongSplat cameras_all.json (list of {R, T, ...} poses). Used to estimate the
 * world-up vector for floor-down splat orientation. 404 when the job has no cameras.
 */
export const getCameras = async (
  jobId: string,
  opts?: { signal?: AbortSignal },
): Promise<unknown> => {
  const response = await axios.get<unknown>(`${API_JOBS_URL}/${jobId}/cameras`, {
    headers: { ...getAuthHeaders() },
    timeout: CAMERAS_TIMEOUT_MS,
    signal: opts?.signal,
  });
  return response.data;
};

export interface PresetInfo {
  id: string;
  name: string;
  description: string;
  estimated_minutes: number;
}

export const getPresets = async (): Promise<PresetInfo[]> => {
  const response = await axios.get(`${API_BASE_URL}/api/presets`);
  return response.data;
};
