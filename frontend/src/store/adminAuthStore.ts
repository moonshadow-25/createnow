import { create } from 'zustand';

const STORAGE_KEY = 'admin_token';

interface AdminAuthState {
  isAuthenticated: boolean;
  username: string | null;
  role: string | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  restoreFromStorage: () => void;
}

function _decodeTokenExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ?? null;
  } catch {
    return null;
  }
}

function _decodeTokenPayload(token: string): { sub?: string; role?: string } | null {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

export const useAdminAuthStore = create<AdminAuthState>((set) => ({
  isAuthenticated: false,
  username: null,
  role: null,
  token: null,

  login: async (username: string, password: string) => {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    const baseUrl = import.meta.env.DEV ? 'http://localhost:8501/api' : '/api';
    const res = await fetch(`${baseUrl}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || '登录失败');
    }

    const data = await res.json();
    const token: string = data.access_token;
    const payload = _decodeTokenPayload(token);

    localStorage.setItem(STORAGE_KEY, token);
    set({
      isAuthenticated: true,
      token,
      username: payload?.sub ?? username,
      role: payload?.role ?? null,
    });
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ isAuthenticated: false, username: null, role: null, token: null });
  },

  restoreFromStorage: () => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) return;

    const exp = _decodeTokenExp(token);
    if (exp && Date.now() / 1000 > exp) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const payload = _decodeTokenPayload(token);
    set({
      isAuthenticated: true,
      token,
      username: payload?.sub ?? null,
      role: payload?.role ?? null,
    });
  },
}));
