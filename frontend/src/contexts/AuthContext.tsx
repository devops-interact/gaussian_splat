'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { login as apiLogin, getMe, User, DEMO_CREDENTIALS } from '../api/auth';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  demoCredentials: typeof DEMO_CREDENTIALS;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async (t: string) => {
    try {
      const u = await getMe(t);
      setUser(u);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch {
      setToken(null);
      setUser(null);
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  }, []);

  useEffect(() => {
    if (token) {
      loadUser(token).finally(() => setLoading(false));
    } else {
      const stored = localStorage.getItem(USER_KEY);
      if (stored) {
        try {
          setUser(JSON.parse(stored));
        } catch {
          localStorage.removeItem(USER_KEY);
        }
      }
      setLoading(false);
    }
  }, [token, loadUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiLogin(email, password);
      setToken(res.access_token);
      localStorage.setItem(TOKEN_KEY, res.access_token);
      await loadUser(res.access_token);
    },
    [loadUser]
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
        demoCredentials: DEMO_CREDENTIALS,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
