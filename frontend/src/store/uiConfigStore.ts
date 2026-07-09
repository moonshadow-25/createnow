import { create } from 'zustand';
import { versionApi } from '@/services/api';

interface UiConfigState {
  showHistoricalFailedRefunds: boolean;
  setShowHistoricalFailedRefunds: (show: boolean) => void;
  fetchConfig: () => Promise<void>;
  saveShowHistoricalFailedRefunds: (show: boolean) => Promise<void>;
}

export const useUiConfigStore = create<UiConfigState>((set) => ({
  showHistoricalFailedRefunds: false,

  setShowHistoricalFailedRefunds: (show) => set({ showHistoricalFailedRefunds: show }),

  fetchConfig: async () => {
    const response = await versionApi.getFrontendConfig();
    set({ showHistoricalFailedRefunds: !!response.data?.show_historical_failed_refunds });
  },

  saveShowHistoricalFailedRefunds: async (show) => {
    set({ showHistoricalFailedRefunds: show });
    await versionApi.updateUiConfig({ show_historical_failed_refunds: show });
  },
}));
