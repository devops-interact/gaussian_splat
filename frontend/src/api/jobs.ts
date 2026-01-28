import axios from 'axios';
import { JobStatusResponse } from '../types/job';

// Use environment variable for API URL, fallback to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const API_JOBS_URL = `${API_BASE_URL}/api/jobs`;

export interface UploadResponse {
  job_id: string;
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

export const uploadVideo = async (file: File, qualityPreset: string = 'balanced'): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('quality_preset', qualityPreset);

  const response = await axios.post(`${API_JOBS_URL}/upload`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

export const getJobStatus = async (jobId: string): Promise<JobStatusResponse> => {
  const response = await axios.get(`${API_JOBS_URL}/${jobId}/status`);
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
