import axios from 'axios';
import { JobStatusResponse } from '../types/job';

// Use environment variable for API URL, fallback to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const API_JOBS_URL = `${API_BASE_URL}/api/jobs`;

export const uploadVideo = async (file: File): Promise<{ job_id: string }> => {
  const formData = new FormData();
  formData.append('file', file);

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

export const downloadModel = async (jobId: string): Promise<Blob> => {
  const response = await axios.get(`${API_JOBS_URL}/${jobId}/model`, {
    responseType: 'blob',
  });
  return response.data;
};

export const getPreviewUrl = async (jobId: string): Promise<{ preview_url: string; model_filename: string }> => {
  const response = await axios.get(`${API_JOBS_URL}/${jobId}/preview`);
  return response.data;
};
