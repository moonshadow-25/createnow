import React, { useState, useEffect } from 'react';
import { generationApi } from '../../services/api';
import { useToast } from '@/components/common/Toast';
import { useGlobalStyleStore } from '@/store/globalStyleStore';

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
}

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
  const [config, setConfig] = useState<GlobalStyleConfig | null>(null);
  const [imagePresets, setImagePresets] = useState<StylePreset[]>([]);
  const [videoPresets, setVideoPresets] = useState<StylePreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [imageDetail, setImageDetail] = useState<StylePresetDetail | null>(null);
  const [videoDetail, setVideoDetail] = useState<StylePresetDetail | null>(null);

  useEffect(() => {
    loadConfig();
    loadPresets();
  }, [projectId]);

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
      setGlobalStyleConfig({
        global_resolution: data.global_resolution || '1280x720',
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
      await generationApi.updateGlobalStyleConfig(projectId, config);
      setGlobalStyleConfig({
        global_resolution: config.global_resolution || '1280x720',
        nine_grid_mode: config.nine_grid_mode || false,
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
                  onClick={() => updateStyle(type, { preset_id: preset.id })}
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
              <div className="px-3 py-2 bg-gray-900/60 border border-gray-700 rounded text-xs text-gray-400 font-mono">
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
        <select
          value={config.global_resolution || '1280x720'}
          onChange={e => setConfig({ ...config, global_resolution: e.target.value })}
          className="px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
        >
          <option value="1920x1080">1920x1080（横屏 FHD）</option>
          <option value="1280x720">1280x720（横屏 HD）</option>
          <option value="1080x1920">1080x1920（竖屏 FHD）</option>
          <option value="720x1280">720x1280（竖屏 HD）</option>
        </select>
      </div>

      {/* Nine-grid mode */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-300 whitespace-nowrap">九宫格模式</label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={config.nine_grid_mode || false}
            onChange={e => setConfig({ ...config, nine_grid_mode: e.target.checked })}
            className="w-3.5 h-3.5 accent-purple-500"
          />
          <span className="text-xs text-gray-400">启用后调整提示词面板标签名称</span>
        </label>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-4">
        {renderSection('image', config.image_style, imagePresets, imageDetail)}
        {renderSection('video', config.video_style, videoPresets, videoDetail)}
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
