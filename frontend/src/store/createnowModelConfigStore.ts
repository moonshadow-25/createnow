import { create } from 'zustand';
import { versionApi } from '@/services/api';

export type CreatenowServiceType = 'llm' | 'vlm' | 'image' | 'video' | 'tts';

export interface CreatenowModelSuggestion {
  label: string;
  model: string;
}

export interface CreatenowModelConfig {
  suggestions: Record<CreatenowServiceType, CreatenowModelSuggestion[]>;
  default_models: Record<CreatenowServiceType, string>;
}

export const IMAGE_SIZE_OPTIONS = [
  { label: '16:9 横版', value: '16x9' },
  { label: '9:16 竖版', value: '9x16' },
  { label: '1:1 方形', value: '1x1' },
  { label: '4:3 标准', value: '4x3' },
  { label: '3:4 竖版', value: '3x4' },
];

export const VIDEO_RATIO_OPTIONS = [
  { label: '16:9 横版', value: '16:9' },
  { label: '9:16 竖版', value: '9:16' },
  { label: '21:9 超宽', value: '21:9' },
];

export const VIDEO_RESOLUTION_OPTIONS = [
  { label: '480p', value: '480p' },
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' },
];

export const DEFAULT_CREATENOW_MODEL_CONFIG: CreatenowModelConfig = {
  suggestions: {
    llm: [],
    vlm: [],
    image: [
      { label: 'image2', model: 'nova-max' },
      { label: 'nano2', model: 'nova-pro' },
      { label: 'image2备用', model: 'image2-backup' },
    ],
    video: [
      { label: 'sd2', model: 'nova-pro' },
      { label: 'sd2-fast', model: 'nova' },
      { label: 'happyhorse', model: 'happyhorse-1.0-r2v' },
    ],
    tts: [],
  },
  default_models: {
    llm: 'nova-pro',
    vlm: 'nova-pro',
    image: 'nova-pro',
    video: 'nova-pro',
    tts: 'nova-pro',
  },
};

function normalizeConfig(raw: any): CreatenowModelConfig {
  const normalized: CreatenowModelConfig = {
    suggestions: {
      llm: [...DEFAULT_CREATENOW_MODEL_CONFIG.suggestions.llm],
      vlm: [...DEFAULT_CREATENOW_MODEL_CONFIG.suggestions.vlm],
      image: [...DEFAULT_CREATENOW_MODEL_CONFIG.suggestions.image],
      video: [...DEFAULT_CREATENOW_MODEL_CONFIG.suggestions.video],
      tts: [...DEFAULT_CREATENOW_MODEL_CONFIG.suggestions.tts],
    },
    default_models: { ...DEFAULT_CREATENOW_MODEL_CONFIG.default_models },
  };

  (['llm', 'vlm', 'image', 'video', 'tts'] as const).forEach((type) => {
    const suggestions = raw?.suggestions?.[type];
    if (Array.isArray(suggestions)) {
      normalized.suggestions[type] = suggestions
        .map((item) => ({
          label: String(item?.label || '').trim(),
          model: String(item?.model || '').trim(),
        }))
        .filter((item) => item.label && item.model);
    }

    const defaultModel = String(raw?.default_models?.[type] || '').trim();
    if (defaultModel) normalized.default_models[type] = defaultModel;
  });

  return normalized;
}

interface CreatenowModelConfigState {
  config: CreatenowModelConfig;
  loading: boolean;
  fetchConfig: () => Promise<void>;
  setConfig: (config: CreatenowModelConfig) => void;
  saveConfig: (config: CreatenowModelConfig) => Promise<CreatenowModelConfig>;
}

export const useCreatenowModelConfigStore = create<CreatenowModelConfigState>((set) => ({
  config: DEFAULT_CREATENOW_MODEL_CONFIG,
  loading: false,

  fetchConfig: async () => {
    set({ loading: true });
    try {
      const response = await versionApi.getFrontendConfig();
      set({ config: normalizeConfig(response.data?.createnow_model_config), loading: false });
    } catch {
      set({ config: DEFAULT_CREATENOW_MODEL_CONFIG, loading: false });
    }
  },

  setConfig: (config) => set({ config: normalizeConfig(config) }),

  saveConfig: async (config) => {
    const normalized = normalizeConfig(config);
    const response = await versionApi.updateCreatenowModelConfig(normalized);
    const saved = normalizeConfig(response.data);
    set({ config: saved });
    return saved;
  },
}));
