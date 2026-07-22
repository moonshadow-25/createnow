import { create } from 'zustand';
import { authApi } from '@/services/api';

interface AuthState {
  loggedIn: boolean;
  hardwareId: string | null;
  apiKeyMasked: string | null;
  userName: string | null;
  credits: number | null;
  fetchAuthInfo: () => Promise<void>;
  setLoggedIn: (data: { hardwareId: string; apiKeyMasked: string; userName?: string; credits?: number }) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  loggedIn: false,
  hardwareId: null,
  apiKeyMasked: null,
  userName: null,
  credits: null,

  fetchAuthInfo: async () => {
    try {
      const res = await authApi.info();
      const data = res.data;
      set({
        loggedIn: data.logged_in,
        hardwareId: data.hardware_id,
        apiKeyMasked: data.api_key_masked,
        userName: data.user_name || null,
        credits: typeof data.credits === 'number' ? data.credits : null,
      });
    } catch (e) {
      // ignore - not critical
    }
  },

  setLoggedIn: ({ hardwareId, apiKeyMasked, userName, credits }) => {
    set({
      loggedIn: true,
      hardwareId,
      apiKeyMasked,
      userName: userName || null,
      credits: typeof credits === 'number' ? credits : null,
    });
  },

  logout: async () => {
    await authApi.logout();
    set({ loggedIn: false, hardwareId: null, apiKeyMasked: null, userName: null, credits: null });
  },
}));
