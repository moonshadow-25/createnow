import React, { useState, useEffect } from 'react';
import { generationApi } from '../../services/api';

interface StyleConfig {
  preset_id: string;
  custom_suffix: string;
  enabled: boolean;
}

interface GlobalStyleConfig {
  prompt_language: string;
  image_style: StyleConfig;
  video_style: StyleConfig;
}

interface StylePreset {
  id: string;
  name: string;
  name_en: string;
  category: string;
}

interface StylePresetDetail {
  name: string;
  name_en: string;
  category: string;
  suffix: string;
  suffix_zh: string;
}

interface GlobalStylePanelProps {
  projectId: string;
}

export const GlobalStylePanel: React.FC<GlobalStylePanelProps> = ({ projectId }) => {
  const [config, setConfig] = useState<GlobalStyleConfig | null>(null);
  const [imagePresets, setImagePresets] = useState<StylePreset[]>([]);
  const [videoPresets, setVideoPresets] = useState<StylePreset[]>([]);
  const [saving, setSaving] = useState(false);

  // 选中预设的详细信息（用于预览）
  const [imagePresetDetail, setImagePresetDetail] = useState<StylePresetDetail | null>(null);
  const [videoPresetDetail, setVideoPresetDetail] = useState<StylePresetDetail | null>(null);

  useEffect(() => {
    loadConfig();
    loadPresets();
  }, [projectId]);

  // 当选中的预设改变时，加载详情
  useEffect(() => {
    if (config && config.image_style.preset_id && config.image_style.preset_id !== 'custom') {
      loadImagePresetDetail(config.image_style.preset_id);
    } else {
      setImagePresetDetail(null);
    }
  }, [config?.image_style.preset_id, projectId]);

  useEffect(() => {
    if (config && config.video_style.preset_id && config.video_style.preset_id !== 'custom') {
      loadVideoPresetDetail(config.video_style.preset_id);
    } else {
      setVideoPresetDetail(null);
    }
  }, [config?.video_style.preset_id, projectId]);

  const loadConfig = async () => {
    try {
      const response = await generationApi.getGlobalStyleConfig(projectId);
      setConfig(response.data);
    } catch (error) {
      console.error('加载全局风格配置失败', error);
    }
  };

  const loadPresets = async () => {
    try {
      const response = await generationApi.getStylePresets(projectId);
      setImagePresets(response.data.image_presets);
      setVideoPresets(response.data.video_presets);
    } catch (error) {
      console.error('加载风格预设失败', error);
    }
  };

  const loadImagePresetDetail = async (presetId: string) => {
    try {
      const response = await generationApi.getStylePresetDetail(projectId, 'image', presetId);
      setImagePresetDetail(response.data);
    } catch (error) {
      console.error('加载图片预设详情失败', error);
    }
  };

  const loadVideoPresetDetail = async (presetId: string) => {
    try {
      const response = await generationApi.getStylePresetDetail(projectId, 'video', presetId);
      setVideoPresetDetail(response.data);
    } catch (error) {
      console.error('加载视频预设详情失败', error);
    }
  };

  const handleSave = async () => {
    if (!config) return;

    setSaving(true);
    try {
      await generationApi.updateGlobalStyleConfig(projectId, config);
      alert('全局风格配置已保存');
    } catch (error) {
      console.error('保存失败', error);
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <div className="p-4">加载中...</div>;
  }

  // 获取当前风格后缀（用于预览）
  const getCurrentImageStyleSuffix = () => {
    if (!config.image_style.enabled) return '';
    if (config.image_style.preset_id === 'custom') {
      return config.image_style.custom_suffix;
    }
    if (imagePresetDetail) {
      return config.prompt_language === 'zh' ? imagePresetDetail.suffix_zh : imagePresetDetail.suffix;
    }
    return '';
  };

  const getCurrentVideoStyleSuffix = () => {
    if (!config.video_style.enabled) return '';
    if (config.video_style.preset_id === 'custom') {
      return config.video_style.custom_suffix;
    }
    if (videoPresetDetail) {
      return config.prompt_language === 'zh' ? videoPresetDetail.suffix_zh : videoPresetDetail.suffix;
    }
    return '';
  };

  return (
    <div className="p-6 max-w-4xl">
      <h3 className="text-lg font-semibold mb-2">全局风格设置</h3>
      <p className="text-gray-500 text-sm mb-6">
        统一全剧的视觉风格。全局风格会在LLM生成提示词时被融入，用户可以在生成后手动编辑提示词进行微调。
      </p>

      {/* 提示词语言选择 */}
      <div className="mb-6">
        <label className="block mb-2 font-medium text-sm">提示词生成语言</label>
        <select
          value={config.prompt_language}
          onChange={(e) => setConfig({ ...config, prompt_language: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="zh">中文</option>
          <option value="en">英文</option>
          <option value="auto">自动检测</option>
        </select>
        <p className="text-xs text-gray-500 mt-1">
          LLM生成提示词时使用的语言（全局风格后缀会自动切换到对应语言）
        </p>
      </div>

      {/* 图片风格配置 */}
      <div className="mb-6 border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium">图片风格</h4>
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.image_style.enabled}
              onChange={(e) => setConfig({
                ...config,
                image_style: { ...config.image_style, enabled: e.target.checked }
              })}
              className="mr-2"
            />
            <span className="text-sm">启用</span>
          </label>
        </div>

        {config.image_style.enabled && (
          <>
            {/* 标签式预设选择 - 所有预设平铺 */}
            <div className="mb-4">
              <label className="block mb-2 text-sm font-medium">风格预设</label>
              <div className="flex flex-wrap gap-2">
                {imagePresets.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => setConfig({
                      ...config,
                      image_style: { ...config.image_style, preset_id: preset.id }
                    })}
                    className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                      config.image_style.preset_id === preset.id
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
                {/* 自定义选项 */}
                <button
                  onClick={() => setConfig({
                    ...config,
                    image_style: { ...config.image_style, preset_id: 'custom' }
                  })}
                  className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                    config.image_style.preset_id === 'custom'
                      ? 'bg-purple-500 text-white border-purple-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'
                  }`}
                >
                  自定义
                </button>
              </div>
            </div>

            {/* 风格后缀预览 */}
            {getCurrentImageStyleSuffix() && (
              <div className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
                <label className="block mb-1 text-xs font-medium text-gray-600">当前风格后缀：</label>
                <p className="text-sm text-gray-800">{getCurrentImageStyleSuffix()}</p>
              </div>
            )}

            {/* 自定义后缀输入 */}
            {config.image_style.preset_id === 'custom' && (
              <div className="mb-4">
                <label className="block mb-2 text-sm font-medium">自定义风格后缀</label>
                <textarea
                  value={config.image_style.custom_suffix}
                  onChange={(e) => setConfig({
                    ...config,
                    image_style: {
                      ...config.image_style,
                      custom_suffix: e.target.value
                    }
                  })}
                  rows={3}
                  placeholder="输入自定义的图片风格提示词后缀..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* 视频风格配置 */}
      <div className="mb-6 border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium">视频风格</h4>
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.video_style.enabled}
              onChange={(e) => setConfig({
                ...config,
                video_style: { ...config.video_style, enabled: e.target.checked }
              })}
              className="mr-2"
            />
            <span className="text-sm">启用</span>
          </label>
        </div>

        {config.video_style.enabled && (
          <>
            {/* 标签式预设选择 - 所有预设平铺 */}
            <div className="mb-4">
              <label className="block mb-2 text-sm font-medium">风格预设</label>
              <div className="flex flex-wrap gap-2">
                {videoPresets.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => setConfig({
                      ...config,
                      video_style: { ...config.video_style, preset_id: preset.id }
                    })}
                    className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                      config.video_style.preset_id === preset.id
                        ? 'bg-green-500 text-white border-green-500'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
                {/* 自定义选项 */}
                <button
                  onClick={() => setConfig({
                    ...config,
                    video_style: { ...config.video_style, preset_id: 'custom' }
                  })}
                  className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                    config.video_style.preset_id === 'custom'
                      ? 'bg-purple-500 text-white border-purple-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'
                  }`}
                >
                  自定义
                </button>
              </div>
            </div>

            {/* 风格后缀预览 */}
            {getCurrentVideoStyleSuffix() && (
              <div className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
                <label className="block mb-1 text-xs font-medium text-gray-600">当前风格后缀：</label>
                <p className="text-sm text-gray-800">{getCurrentVideoStyleSuffix()}</p>
              </div>
            )}

            {/* 自定义后缀输入 */}
            {config.video_style.preset_id === 'custom' && (
              <div className="mb-4">
                <label className="block mb-2 text-sm font-medium">自定义风格后缀</label>
                <textarea
                  value={config.video_style.custom_suffix}
                  onChange={(e) => setConfig({
                    ...config,
                    video_style: {
                      ...config.video_style,
                      custom_suffix: e.target.value
                    }
                  })}
                  rows={3}
                  placeholder="输入自定义的视频风格提示词后缀..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? '保存中...' : '保存全局风格配置'}
        </button>
      </div>

      {/* 使用说明 */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
        <h5 className="font-medium mb-2 text-sm">使用说明：</h5>
        <ul className="text-sm space-y-1 list-disc list-inside text-gray-700">
          <li>全局风格会在LLM生成提示词时被融入，形成完整的提示词</li>
          <li>LLM生成的提示词会显示在界面上，用户可以手动编辑后再生成</li>
          <li>这样的设计让用户能看到完整的提示词，适合混合风格等特殊场景</li>
          <li>如果不需要全局风格，选择"无"预设或关闭对应的开关</li>
          <li>自定义风格适合特定项目的独特需求</li>
        </ul>
      </div>
    </div>
  );
};
