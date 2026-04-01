import axios from 'axios';
import { getApiBaseUrl } from '../lib/apiBase';

const API_BASE_URL = getApiBaseUrl();

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface Project {
  id: number;
  name: string;
  description: string;
  scan_count: number;
  created_at: string;
  updated_at: string;
}

export const listProjects = async (): Promise<Project[]> => {
  const response = await axios.get(`${API_BASE_URL}/api/projects`, {
    headers: getAuthHeaders(),
  });
  return response.data;
};

export const createProject = async (name: string, description?: string): Promise<Project> => {
  const response = await axios.post(
    `${API_BASE_URL}/api/projects`,
    { name, description: description || '' },
    { headers: getAuthHeaders() }
  );
  return response.data;
};

export const getProject = async (id: number): Promise<Project> => {
  const response = await axios.get(`${API_BASE_URL}/api/projects/${id}`, {
    headers: getAuthHeaders(),
  });
  return response.data;
};

export const updateProject = async (id: number, data: { name?: string; description?: string }): Promise<Project> => {
  const response = await axios.put(`${API_BASE_URL}/api/projects/${id}`, data, {
    headers: getAuthHeaders(),
  });
  return response.data;
};

export const deleteProject = async (id: number): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/api/projects/${id}`, {
    headers: getAuthHeaders(),
  });
};
