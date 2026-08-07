import { create } from 'zustand';

interface GlobalStyleState {
  global_video_ratio: string;
  global_video_resolution: string;
  nine_grid_mode: boolean;
  setConfig: (cfg: { global_video_ratio?: string; global_video_resolution?: string; nine_grid_mode?: boolean }) => void;
}

export const useGlobalStyleStore = create<GlobalStyleState>((set) => ({
  global_video_ratio: '16:9',
  global_video_resolution: '720p',
  nine_grid_mode: false,
  setConfig: (cfg) => set((s) => ({ ...s, ...cfg })),
}));
