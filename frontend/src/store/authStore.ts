import { create } from 'zustand';
import { authApi } from '@/services/api';

interface AuthState {
  loggedIn: boolean;
  hardwareId: string | null;
  apiKeyMasked: string | null;
  fetchAuthInfo: () => Promise<void>;
  setLoggedIn: (data: { hardwareId: string; apiKeyMasked: string }) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  loggedIn: false,
  hardwareId: null,
  apiKeyMasked: null,

  fetchAuthInfo: async () => {
    try {
      const res = await authApi.info();
      const data = res.data;
      set({
        loggedIn: data.logged_in,
        hardwareId: data.hardware_id,
        apiKeyMasked: data.api_key_masked,
      });
    } catch (e) {
      // ignore - not critical
    }
  },

  setLoggedIn: ({ hardwareId, apiKeyMasked }) => {
    set({ loggedIn: true, hardwareId, apiKeyMasked });
  },

  logout: async () => {
    await authApi.logout();
    set({ loggedIn: false, hardwareId: null, apiKeyMasked: null });
  },
}));
