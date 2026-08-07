import React, { useState, useEffect } from 'react';
import { generationApi } from '../../services/api';
import { useToast } from '@/components/common/Toast';
import { useGlobalStyleStore } from '@/store/globalStyleStore';
import { useProjectStore } from '@/store/projectStore';
import type { ImageSizes } from '@/types';
import { parseVideoSpec } from '@/utils/generationDefaults';

interface CustomPreset {
  id: string;
  name: string;
  content: string;
}

interface StyleConfig {
  preset_id: string;
  custom_suffix: string;
  enabled: boolean;
  custom_presets: CustomPreset[];
  active_custom_id: string;
}

interface GlobalStyleConfig {
  prompt_language: string;
  image_style: StyleConfig;
  video_style: StyleConfig;
  global_resolution?: string;
  nine_grid_mode?: boolean;
  storyboard_duration_seconds?: number;
  dialogue_chars_max?: number;
}

const RATIO_OPTIONS = [
  { label: '16:9 横版', value: '16:9' },
  { label: '9:16 竖版', value: '9:16' },
  { label: '21:9 超宽', value: '21:9' },
] as const;

const RESOLUTION_OPTIONS = [
  { label: '480p', value: '480p' },
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' },
] as const;

interface StylePreset {
  id: string;
  name: string;
  name_en: string;
  category: string;
}

interface StylePresetDetail {
  suffix: string;
  suffix_zh: string;
}

interface GlobalStylePanelProps {
  projectId: string;
}

function migrateStyle(raw: any): StyleConfig {
  const result: StyleConfig = {
    custom_presets: [],
    active_custom_id: '',
    ...raw,
  };
  // Migrate old single-custom to new multi-custom format
  if (result.preset_id === 'custom' && result.custom_presets.length === 0 && result.custom_suffix) {
    const id = `custom_${Date.now()}`;
    result.custom_presets = [{ id, name: '自定义1', content: result.custom_suffix }];
    result.active_custom_id = id;
  }
  return result;
}

export const GlobalStylePanel: React.FC<GlobalStylePanelProps> = ({ projectId }) => {
  const { toast } = useToast();
  const setGlobalStyleConfig = useGlobalStyleStore(s => s.setConfig);
  const { currentProject, updateProject } = useProjectStore();
  const [config, setConfig] = useState<GlobalStyleConfig | null>(null);
  const [imagePresets, setImagePresets] = useState<StylePreset[]>([]);
  const [videoPresets, setVideoPresets] = useState<StylePreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [imageDetail, setImageDetail] = useState<StylePresetDetail | null>(null);
  const [videoDetail, setVideoDetail] = useState<StylePresetDetail | null>(null);
  const [globalRatio, setGlobalRatio] = useState('16:9');
  const [globalResolution, setGlobalResolution] = useState('720p');
  // 分镜时长/字数输入框：自由输入（不即时 clamp），保存时统一校验
  const [durationInput, setDurationInput] = useState('15');
  const [charsInput, setCharsInput] = useState('65');

  const defaultImageSizes: ImageSizes = { character: '16x9', scene: '16x9', prop: '1x1', storyboard: '16x9' };
  const [imageSizes, setImageSizes] = useState<ImageSizes>(defaultImageSizes);

  useEffect(() => {
    loadConfig();
    loadPresets();
  }, [projectId]);

  // 从项目配置加载分辨率
  useEffect(() => {
    const sizes = (currentProject?.ai_config as any)?.image_sizes;
    if (sizes) setImageSizes({ ...defaultImageSizes, ...sizes });
  }, [currentProject]);

  useEffect(() => {
    if (!config) return;
    const pid = config.image_style.preset_id;
    if (pid && pid !== 'custom' && pid !== 'none') {
      generationApi.getStylePresetDetail(projectId, 'image', pid)
        .then(r => setImageDetail(r.data))
        .catch(() => setImageDetail(null));
    } else {
      setImageDetail(null);
    }
  }, [config?.image_style.preset_id]);

  useEffect(() => {
    if (!config) return;
    const pid = config.video_style.preset_id;
    if (pid && pid !== 'custom' && pid !== 'none') {
      generationApi.getStylePresetDetail(projectId, 'video', pid)
        .then(r => setVideoDetail(r.data))
        .catch(() => setVideoDetail(null));
    } else {
      setVideoDetail(null);
    }
  }, [config?.video_style.preset_id]);

  const loadConfig = async () => {
    try {
      const response = await generationApi.getGlobalStyleConfig(projectId);
      const data = response.data;
      setConfig({
        ...data,
        image_style: migrateStyle(data.image_style),
        video_style: migrateStyle(data.video_style),
      });
      setDurationInput(String(data.storyboard_duration_seconds ?? 15));
      setCharsInput(String(data.dialogue_chars_max ?? 65));
      const parsedGlobalResolution = parseVideoSpec((data as any).global_video_ratio && (data as any).global_video_resolution
        ? `${(data as any).global_video_ratio}-${(data as any).global_video_resolution}`
        : data.global_resolution);
      setGlobalRatio(parsedGlobalResolution.ratio);
      setGlobalResolution(parsedGlobalResolution.resolution);
      setGlobalStyleConfig({
        global_video_ratio: parsedGlobalResolution.ratio,
        global_video_resolution: parsedGlobalResolution.resolution,
        nine_grid_mode: data.nine_grid_mode || false,
      });
    } catch (e) {
      console.error('加载全局风格配置失败', e);
    }
  };

  const loadPresets = async () => {
    try {
      const response = await generationApi.getStylePresets(projectId);
      setImagePresets(response.data.image_presets);
      setVideoPresets(response.data.video_presets);
    } catch (e) {
      console.error('加载风格预设失败', e);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      // 保存时统一校验：时长 clamp 4-30，字数 ≥1
      const durationVal = Math.min(30, Math.max(4, parseInt(durationInput) || 15));
      const charsVal = Math.max(1, parseInt(charsInput) || 65);
      // 新版独立字段保存（不再写旧版组合字段 global_resolution）
      const configToSave = {
        ...config,
        storyboard_duration_seconds: durationVal,
        dialogue_chars_max: charsVal,
        global_video_ratio: globalRatio,
        global_video_resolution: globalResolution,
      };
      await Promise.all([
        generationApi.updateGlobalStyleConfig(projectId, configToSave),
        updateProject(projectId, { ai_config: { image_sizes: imageSizes } }),
      ]);
      setConfig(configToSave);
      setDurationInput(String(durationVal));
      setCharsInput(String(charsVal));
      setGlobalStyleConfig({
        global_video_ratio: globalRatio,
        global_video_resolution: globalResolution,
        nine_grid_mode: configToSave.nine_grid_mode || false,
      });
      toast('全局风格配置已保存', 'success');
    } catch (e) {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateStyle = (type: 'image' | 'video', updates: Partial<StyleConfig>) => {
    if (!config) return;
    if (type === 'image') {
      setConfig({ ...config, image_style: { ...config.image_style, ...updates } });
    } else {
      setConfig({ ...config, video_style: { ...config.video_style, ...updates } });
    }
  };

  // 修改分镜时长上限时，自动按公式重新计算对白字数（round(65 × s / 15)），可再手动调整。
  // 输入过程自由（不即时 clamp），只在字数联动时对有效数字做归一
  const handleDurationChange = (raw: string) => {
    if (!config) return;
    setDurationInput(raw);
    const s = parseInt(raw);
    if (Number.isFinite(s) && s >= 1) {
      const clamped = Math.min(30, Math.max(4, s));
      setConfig({ ...config, dialogue_chars_max: Math.max(1, Math.round(65 * clamped / 15)) });
    }
  };

  const addCustomPreset = (type: 'image' | 'video') => {
    if (!config) return;
    const styleConfig = type === 'image' ? config.image_style : config.video_style;
    const id = `custom_${Date.now()}`;
    const n = styleConfig.custom_presets.length + 1;
    const newPreset: CustomPreset = { id, name: `自定义${n}`, content: '' };
    updateStyle(type, {
      custom_presets: [...styleConfig.custom_presets, newPreset],
      preset_id: 'custom',
      active_custom_id: id,
      custom_suffix: '',
    });
  };

  const deleteCustomPreset = (type: 'image' | 'video', presetId: string) => {
    if (!config) return;
    const styleConfig = type === 'image' ? config.image_style : config.video_style;
    const remaining = styleConfig.custom_presets.filter(p => p.id !== presetId);
    const wasActive = styleConfig.active_custom_id === presetId;
    const updates: Partial<StyleConfig> = { custom_presets: remaining };
    if (wasActive) {
      if (remaining.length > 0) {
        updates.active_custom_id = remaining[0].id;
        updates.custom_suffix = remaining[0].content;
      } else {
        updates.preset_id = 'none';
        updates.active_custom_id = '';
        updates.custom_suffix = '';
      }
    }
    updateStyle(type, updates);
  };

  const selectCustomPreset = (type: 'image' | 'video', preset: CustomPreset) => {
    updateStyle(type, {
      preset_id: 'custom',
      active_custom_id: preset.id,
      custom_suffix: preset.content,
    });
  };

  const editCustomContent = (type: 'image' | 'video', presetId: string, content: string) => {
    if (!config) return;
    const styleConfig = type === 'image' ? config.image_style : config.video_style;
    const updated = styleConfig.custom_presets.map(p =>
      p.id === presetId ? { ...p, content } : p
    );
    updateStyle(type, { custom_presets: updated, custom_suffix: content });
  };

  if (!config) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  const getSuffix = (detail: StylePresetDetail | null) => {
    if (!detail) return '';
    return config.prompt_language === 'zh' ? detail.suffix_zh : detail.suffix;
  };

  const renderSection = (
    type: 'image' | 'video',
    styleConfig: StyleConfig,
    presets: StylePreset[],
    detail: StylePresetDetail | null,
  ) => {
    const title = type === 'image' ? '图片风格' : '视频风格';
    const accent = type === 'image' ? 'bg-blue-600' : 'bg-green-600';
    const isCustomActive = styleConfig.preset_id === 'custom';
    const activeCustom = isCustomActive
      ? styleConfig.custom_presets.find(p => p.id === styleConfig.active_custom_id)
      : null;
    const systemSuffix = !isCustomActive ? getSuffix(detail) : '';

    return (
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-gray-100 text-sm">{title}</h4>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={styleConfig.enabled}
              onChange={e => updateStyle(type, { enabled: e.target.checked })}
              className="w-3.5 h-3.5 accent-purple-500"
            />
            <span className="text-xs text-gray-400">启用</span>
          </label>
        </div>

        {styleConfig.enabled && (
          <>
            {/* System presets */}
            <div className="flex flex-wrap gap-1.5">
              {presets.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => updateStyle(type, { preset_id: preset.id, custom_suffix: '', active_custom_id: '' })}
                  className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
                    styleConfig.preset_id === preset.id
                      ? `${accent} text-white border-transparent`
                      : 'bg-gray-700 text-gray-300 border-gray-600 hover:border-gray-400 hover:text-gray-100'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            {/* Custom presets */}
            <div className="flex flex-wrap gap-1.5 items-center">
              {styleConfig.custom_presets.map(preset => (
                <div key={preset.id} className="relative group">
                  <button
                    onClick={() => selectCustomPreset(type, preset)}
                    className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
                      isCustomActive && styleConfig.active_custom_id === preset.id
                        ? 'bg-purple-600 text-white border-transparent'
                        : 'bg-gray-700 text-gray-300 border-purple-500/50 hover:border-purple-400'
                    }`}
                  >
                    {preset.name}
                  </button>
                  <button
                    onClick={() => deleteCustomPreset(type, preset.id)}
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-600 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                    title="删除"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => addCustomPreset(type)}
                className="px-2.5 py-0.5 text-xs rounded-full border border-dashed border-gray-500 text-gray-400 hover:border-purple-400 hover:text-purple-400 transition-colors"
              >
                + 自定义
              </button>
            </div>

            {/* Content area: editable for custom, read-only for system */}
            {isCustomActive && activeCustom ? (
              <textarea
                value={activeCustom.content}
                onChange={e => editCustomContent(type, activeCustom.id, e.target.value)}
                rows={4}
                placeholder="输入自定义风格提示词..."
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-xs text-gray-100 font-mono resize-none focus:outline-none focus:border-purple-500"
              />
            ) : systemSuffix ? (
              <div className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-xs font-mono text-gray-300">
                {systemSuffix}
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 flex flex-col gap-4 h-full overflow-y-auto">
      {/* Language selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-300 whitespace-nowrap">提示词语言</label>
        <select
          value={config.prompt_language}
          onChange={e => setConfig({ ...config, prompt_language: e.target.value })}
          className="px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        >
          <option value="zh">中文</option>
          <option value="en">英文</option>
          <option value="auto">自动检测</option>
        </select>
      </div>

      {/* Global resolution */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-300 whitespace-nowrap">全局分辨率</label>
        <div className="flex items-center gap-2">
          <select
            value={globalRatio}
            onChange={e => setGlobalRatio(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          >
            {RATIO_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={globalResolution}
            onChange={e => setGlobalResolution(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          >
            {RESOLUTION_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>


      {/* 分镜生成参数 */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h4 className="font-medium text-gray-100 text-sm mb-3">分镜生成</h4>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-gray-400 mb-1">分镜时长上限（秒）</span>
            <input
              type="number"
              min={4}
              max={30}
              value={durationInput}
              onChange={e => handleDurationChange(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
            />
            <span className="block text-xs text-gray-500 mt-1">4-30 秒上限，默认 15 秒；实际时长按各段对白内容自动适配</span>
          </label>
          <label className="block">
            <span className="block text-xs text-gray-400 mb-1">单镜对白字数（建议）</span>
            <input
              type="number"
              min={1}
              value={charsInput}
              onChange={e => setCharsInput(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
            />
            <span className="block text-xs text-gray-500 mt-1">修改时长后自动按公式计算，可手动调整</span>
          </label>
        </div>
      </div>


      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-4">
        {renderSection('image', config.image_style, imagePresets, imageDetail)}
        {renderSection('video', config.video_style, videoPresets, videoDetail)}
      </div>

      {/* 生图分辨率 */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h4 className="font-medium text-gray-100 text-sm mb-3">生图分辨率</h4>
        <p className="text-xs text-gray-400 mb-3">支持比例格式（如 1x1、16x9）或具体像素（如 1024x1024）</p>
        <div className="grid grid-cols-2 gap-3">
          {(['character', 'scene', 'prop', 'storyboard'] as const).map((key) => {
            const labels = { character: '角色', scene: '场景', prop: '道具', storyboard: '分镜' };
            const defaults = { character: '16x9', scene: '16x9', prop: '1x1', storyboard: '16x9' };
            return (
              <div key={key}>
                <label className="block text-xs text-gray-400 mb-1">{labels[key]}分辨率</label>
                <input
                  type="text"
                  value={imageSizes[key] || defaults[key]}
                  onChange={e => setImageSizes({ ...imageSizes, [key]: e.target.value })}
                  placeholder={defaults[key]}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm transition disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving && <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded" />}
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
};
