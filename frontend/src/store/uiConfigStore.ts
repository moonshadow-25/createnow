import { create } from 'zustand';
import { versionApi } from '@/services/api';

interface UiConfigState {
  showHistoricalFailedRefunds: boolean;
  enableSiliconPlatform: boolean;
  creditsPerYuan: number;
  setShowHistoricalFailedRefunds: (show: boolean) => void;
  setEnableSiliconPlatform: (show: boolean) => void;
  setCreditsPerYuan: (credits: number) => void;
  fetchConfig: () => Promise<void>;
  saveShowHistoricalFailedRefunds: (show: boolean) => Promise<void>;
  saveEnableSiliconPlatform: (show: boolean) => Promise<void>;
  saveCreditsPerYuan: (credits: number) => Promise<void>;
}

export const useUiConfigStore = create<UiConfigState>((set) => ({
  showHistoricalFailedRefunds: false,
  enableSiliconPlatform: false,
  creditsPerYuan: 200,

  setShowHistoricalFailedRefunds: (show) => set({ showHistoricalFailedRefunds: show }),
  setEnableSiliconPlatform: (show) => set({ enableSiliconPlatform: show }),
  setCreditsPerYuan: (credits) => set({ creditsPerYuan: credits > 0 ? credits : 200 }),

  fetchConfig: async () => {
    const response = await versionApi.getFrontendConfig();
    set({
      showHistoricalFailedRefunds: !!response.data?.show_historical_failed_refunds,
      enableSiliconPlatform: !!response.data?.enable_silicon_platform,
      creditsPerYuan: Number(response.data?.credits_per_yuan) > 0 ? Number(response.data?.credits_per_yuan) : 200,
    });
  },

  saveShowHistoricalFailedRefunds: async (show) => {
    set({ showHistoricalFailedRefunds: show });
    await versionApi.updateUiConfig({ show_historical_failed_refunds: show });
  },

  saveEnableSiliconPlatform: async (show) => {
    set({ enableSiliconPlatform: show });
    await versionApi.updateUiConfig({ enable_silicon_platform: show });
  },

  saveCreditsPerYuan: async (credits) => {
    set({ creditsPerYuan: credits });
    await versionApi.updateUiConfig({ credits_per_yuan: credits });
  },
}));
