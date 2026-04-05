import { create } from 'zustand';

const STORAGE_KEY = 'saas_token';

interface SaasUser {
  user_id: string;
  display_name: string;
  email: string;
}

interface SaasAuthState {
  isAuthenticated: boolean;
  user: SaasUser | null;
  token: string | null;
  loginWithPoll: (sessionId: string) => Promise<{ registered: boolean }>;
  fetchUser: () => Promise<void>;
  logout: () => Promise<void>;
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

const baseUrl = import.meta.env.DEV ? 'http://localhost:8501/api' : '/api';

export const useSaasAuthStore = create<SaasAuthState>((set, get) => ({
  isAuthenticated: false,
  user: null,
  token: null,

  loginWithPoll: async (sessionId: string) => {
    const res = await fetch(`${baseUrl}/user/auth/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (!res.ok) throw new Error('轮询失败');
    const data = await res.json();

    if (data.registered && data.token) {
      localStorage.setItem(STORAGE_KEY, data.token);
      set({
        isAuthenticated: true,
        token: data.token,
        user: data.user ?? null,
      });
    }
    return { registered: !!data.registered };
  },

  fetchUser: async () => {
    const token = get().token;
    if (!token) return;
    try {
      const res = await fetch(`${baseUrl}/user/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const user = await res.json();
        set({ user });
      }
    } catch {
      // 忽略错误，用户信息可选
    }
  },

  logout: async () => {
    const token = get().token;
    if (token) {
      try {
        await fetch(`${baseUrl}/user/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // 即使失败也清除本地状态
      }
    }
    localStorage.removeItem(STORAGE_KEY);
    set({ isAuthenticated: false, user: null, token: null });
  },

  restoreFromStorage: () => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) return;
    const exp = _decodeTokenExp(token);
    if (exp && Date.now() / 1000 > exp) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    // token 有效，但 user 信息需要从 /user/me 获取（懒加载）
    set({ isAuthenticated: true, token, user: null });
  },
}));
