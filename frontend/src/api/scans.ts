import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface Scan {
  id: number;
  project_id: number;
  job_id: string | null;
  name: string;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export const listScans = async (projectId: number): Promise<Scan[]> => {
  const response = await axios.get(`${API_BASE_URL}/api/projects/${projectId}/scans`, {
    headers: getAuthHeaders(),
  });
  return response.data;
};

export const createScan = async (projectId: number, name?: string): Promise<Scan> => {
  const response = await axios.post(
    `${API_BASE_URL}/api/projects/${projectId}/scans`,
    { name: name || '' },
    { headers: getAuthHeaders() }
  );
  return response.data;
};

export const getScan = async (projectId: number, scanId: number): Promise<Scan> => {
  const response = await axios.get(`${API_BASE_URL}/api/projects/${projectId}/scans/${scanId}`, {
    headers: getAuthHeaders(),
  });
  return response.data;
};

export const updateScan = async (projectId: number, scanId: number, data: { name?: string }): Promise<Scan> => {
  const response = await axios.put(
    `${API_BASE_URL}/api/projects/${projectId}/scans/${scanId}`,
    data,
    { headers: getAuthHeaders() }
  );
  return response.data;
};

export const deleteScan = async (projectId: number, scanId: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/api/projects/${projectId}/scans/${scanId}`, {
    headers: getAuthHeaders(),
  });
};
