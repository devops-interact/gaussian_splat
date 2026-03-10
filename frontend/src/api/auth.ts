import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const API_AUTH_URL = `${API_BASE_URL}/api/auth`;

export interface User {
  id: number;
  email: string;
  is_demo: boolean;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export const login = async (email: string, password: string): Promise<LoginResponse> => {
  const formData = new URLSearchParams();
  formData.append('username', email);
  formData.append('password', password);
  const response = await axios.post(`${API_AUTH_URL}/login`, formData, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return response.data;
};

export const getMe = async (token: string): Promise<User> => {
  const response = await axios.get(`${API_AUTH_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
};

export const DEMO_CREDENTIALS = {
  email: 'demo@gaussian-splat.demo',
  password: 'demo123',
};
