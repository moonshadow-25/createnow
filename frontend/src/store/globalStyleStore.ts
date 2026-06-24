import { create } from 'zustand';

interface GlobalStyleState {
  global_resolution: string;
  nine_grid_mode: boolean;
  setConfig: (cfg: { global_resolution?: string; nine_grid_mode?: boolean }) => void;
}

export const useGlobalStyleStore = create<GlobalStyleState>((set) => ({
  global_resolution: '16:9-720p',
  nine_grid_mode: false,
  setConfig: (cfg) => set((s) => ({ ...s, ...cfg })),
}));
