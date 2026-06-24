import type { Project } from '@/types';
import type { CreatenowModelConfig, CreatenowServiceType } from '@/store/createnowModelConfigStore';

export type ImageSizeContext = 'character' | 'scene' | 'prop' | 'storyboard';

export interface VideoSpec {
  ratio: string;
  resolution: string;
}

const DEFAULT_MODEL = 'nova-pro';
const DEFAULT_IMAGE_SIZE = '16x9';
const DEFAULT_VIDEO_SPEC: VideoSpec = { ratio: '16:9', resolution: '720p' };

export function getDefaultServiceModel(
  project: Project | null | undefined,
  modelConfig: CreatenowModelConfig,
  serviceType: CreatenowServiceType,
): string {
  const aiConfig = project?.ai_config as any;
  const directModel = aiConfig?.[serviceType]?.model;
  if (typeof directModel === 'string' && directModel.trim()) return directModel.trim();

  const activePresetId = aiConfig?.active_preset_ids?.[serviceType];
  const presets = aiConfig?.config_presets?.[serviceType] || [];
  const activePreset = presets.find((preset: any) => preset.id === activePresetId);
  const presetModel = activePreset?.config?.model;
  if (typeof presetModel === 'string' && presetModel.trim()) return presetModel.trim();

  const configuredDefault = modelConfig.default_models?.[serviceType];
  if (typeof configuredDefault === 'string' && configuredDefault.trim()) return configuredDefault.trim();

  return DEFAULT_MODEL;
}

export function getDefaultImageSize(project: Project | null | undefined, context: ImageSizeContext): string {
  const aiConfig = project?.ai_config as any;
  const imageSizes = aiConfig?.global_style_config?.image_sizes || aiConfig?.image_sizes;
  const size = imageSizes?.[context];
  return typeof size === 'string' && size.trim() ? size.trim() : DEFAULT_IMAGE_SIZE;
}

export function parseVideoSpec(value?: string | null): VideoSpec {
  if (!value) return DEFAULT_VIDEO_SPEC;
  const trimmed = String(value).trim();
  if (!trimmed) return DEFAULT_VIDEO_SPEC;

  const legacyMap: Record<string, VideoSpec> = {
    '1280x720': { ratio: '16:9', resolution: '720p' },
    '720x1280': { ratio: '9:16', resolution: '720p' },
    '1920x1080': { ratio: '16:9', resolution: '1080p' },
    '1080x1920': { ratio: '9:16', resolution: '1080p' },
    '21:9-720p': { ratio: '21:9', resolution: '720p' },
  };
  if (legacyMap[trimmed]) return legacyMap[trimmed];

  const match = trimmed.match(/^(\d+:\d+)-(\d+p)$/);
  if (match) return { ratio: match[1], resolution: match[2] };

  if (/^\d+p$/.test(trimmed)) return { ...DEFAULT_VIDEO_SPEC, resolution: trimmed };
  if (/^\d+:\d+$/.test(trimmed)) return { ...DEFAULT_VIDEO_SPEC, ratio: trimmed };

  return DEFAULT_VIDEO_SPEC;
}

export function encodeVideoSpec(spec: VideoSpec): string {
  return `${spec.ratio}-${spec.resolution}`;
}

export function getDefaultVideoSpec(project: Project | null | undefined): VideoSpec {
  const aiConfig = project?.ai_config as any;
  const cfg = aiConfig?.global_style_config || aiConfig;
  if (!cfg) return DEFAULT_VIDEO_SPEC;

  const ratio = typeof cfg.global_video_ratio === 'string' && cfg.global_video_ratio.trim()
    ? cfg.global_video_ratio.trim()
    : undefined;
  const resolution = typeof cfg.global_video_resolution === 'string' && cfg.global_video_resolution.trim()
    ? cfg.global_video_resolution.trim()
    : undefined;
  if (ratio || resolution) {
    return {
      ratio: ratio || DEFAULT_VIDEO_SPEC.ratio,
      resolution: resolution || DEFAULT_VIDEO_SPEC.resolution,
    };
  }

  return parseVideoSpec(cfg.global_resolution);
}
