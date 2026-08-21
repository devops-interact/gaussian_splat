import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getAuthHeaders } from './authHeaders';

describe('getAuthHeaders', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
    });
  });

  it('returns empty object when no token', () => {
    expect(getAuthHeaders()).toEqual({});
  });

  it('returns Authorization header when token is set', () => {
    localStorage.setItem('token', 'abc123');
    expect(getAuthHeaders()).toEqual({ Authorization: 'Bearer abc123' });
  });
});
