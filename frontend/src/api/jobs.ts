import axios from 'axios';
import { JobStatusResponse, PresetInfo, SceneManifestResponse } from '../types/job';
import { getApiBaseUrl } from '../lib/apiBase';
import { getAuthHeaders } from '../lib/authHeaders';

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

const JOB_STATUS_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 12_000;

export const getJobStatus = async (
  jobId: string,
  opts?: { signal?: AbortSignal },
): Promise<JobStatusResponse> => {
  const response = await axios.get(`${API_JOBS_URL}/${jobId}/status`, {
    signal: opts?.signal,
    timeout: JOB_STATUS_TIMEOUT_MS,
  });
  return response.data;
};

/** Lightweight connectivity probe (same origin or VITE_API_BASE_URL). */
export const getHealth = async (): Promise<{ status: string }> => {
  const response = await axios.get<{ status: string }>(`${API_BASE_URL}/health`, {
    timeout: HEALTH_TIMEOUT_MS,
    validateStatus: () => true,
  });
  if (response.status !== 200) {
    throw new Error(`Health check failed (HTTP ${response.status})`);
  }
  return response.data;
};

export const downloadModel = async (jobId: string): Promise<Blob> => {
  const response = await axios.get(`${API_JOBS_URL}/${jobId}/model`, {
    responseType: 'blob',
    headers: { ...getAuthHeaders() },
  });
  return response.data;
};

export const getSceneManifest = async (jobId: string): Promise<SceneManifestResponse> => {
  const response = await axios.get(`${API_JOBS_URL}/${jobId}/scene`);
  return response.data;
};

export { type PresetInfo };

export const getPresets = async (): Promise<PresetInfo[]> => {
  const response = await axios.get(`${API_BASE_URL}/api/presets`);
  return response.data;
};
