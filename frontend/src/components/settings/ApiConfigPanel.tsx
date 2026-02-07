import { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, X, Plus, ChevronDown } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { validationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import type { ApiConfig, ImageSizes, ApiConfigPresetsMap, ApiConfigPreset } from '@/types';

interface ApiConfigPanelProps {
  llm: ApiConfig;
  vlm: ApiConfig;
  image: ApiConfig;
  video: ApiConfig;
  onConfigChange: (type: 'llm' | 'vlm' | 'image' | 'video', config: ApiConfig) => void;
  imageSizes?: ImageSizes;
  onImageSizesChange?: (sizes: ImageSizes) => void;
  configPresets: ApiConfigPresetsMap;
  onPresetsChange: (presets: ApiConfigPresetsMap) => void;
  onSwitchTag: (type: 'llm' | 'vlm' | 'image' | 'video', tagId: string) => void;
  activePresetIds: {
    llm: string | null;
    vlm: string | null;
    image: string | null;
    video: string | null;
  };
}

const API_TYPE_OPTIONS = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'dashscope', label: '阿里百炼 DashScope' },
  { value: 'local', label: '本地API' }
];

export function ApiConfigPanel({
  llm,
  vlm,
  image,
  video,
  onConfigChange,
  imageSizes,
  onImageSizesChange,
  configPresets,
  onPresetsChange,
  onSwitchTag,
  activePresetIds
}: ApiConfigPanelProps) {
  const { toast } = useToast();
  const [apiSubTab, setApiSubTab] = useState<'llm' | 'vlm' | 'image' | 'video' | 'sizes'>('llm');

  // 本地预设副本，用于解决 props 更新延迟问题
  const [localPresets, setLocalPresets] = useState<ApiConfigPresetsMap>(configPresets);

  // 同步 props 的预设到本地副本
  useEffect(() => {
    setLocalPresets(configPresets);
  }, [configPresets]);

  // 保存预设对话框状态
  const [savePresetDialog, setSavePresetDialog] = useState<{
    show: boolean;
    type: 'llm' | 'vlm' | 'image' | 'video' | null;
    name: string;
  }>({
    show: false,
    type: null,
    name: ''
  });

  // 删除确认对话框状态
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    show: boolean;
    type: 'llm' | 'vlm' | 'image' | 'video' | null;
    presetId: string | null;
    presetName: string;
  }>({
    show: false,
    type: null,
    presetId: null,
    presetName: ''
  });

  // 预设展开状态
  const [presetsExpanded, setPresetsExpanded] = useState<{
    llm: boolean;
    vlm: boolean;
    image: boolean;
    video: boolean;
  }>({
    llm: false,
    vlm: false,
    image: false,
    video: false
  });

  // 默认分辨率配置
  const defaultImageSizes: ImageSizes = {
    character: '1x1',
    scene: '16x9',
    prop: '1x1',
    storyboard: '16x9'
  };

  // 本地分辨率配置状态
  const [localImageSizes, setLocalImageSizes] = useState<ImageSizes>(
    imageSizes || defaultImageSizes
  );

  // 当props变化时更新本地状态
  useEffect(() => {
    setLocalImageSizes(imageSizes || defaultImageSizes);
  }, [imageSizes]);

  const handleImageSizeChange = (assetType: keyof ImageSizes, value: string) => {
    const newSizes = { ...localImageSizes, [assetType]: value || undefined };
    setLocalImageSizes(newSizes);
    onImageSizesChange?.(newSizes);
  };
  const [validating, setValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<{
    llm?: { valid: boolean; message: string };
    vlm?: { valid: boolean; message: string };
    image?: { valid: boolean; message: string };
    video?: { valid: boolean; message: string };
  }>({});

  // 本地状态管理配置
  const [localConfig, setLocalConfig] = useState<{
    llm: ApiConfig;
    vlm: ApiConfig;
    image: ApiConfig;
    video: ApiConfig;
  }>({
    llm: { ...llm, api_type: llm.api_type || 'openai' },
    vlm: { ...vlm, api_type: vlm.api_type || 'openai' },
    image: { ...image, api_type: image.api_type || 'openai' },
    video: { ...video, api_type: video.api_type || 'openai' }
  });

  // 当props变化时更新本地状态
  useEffect(() => {
    setLocalConfig({
      llm: { ...llm, api_type: llm.api_type || 'openai' },
      vlm: { ...vlm, api_type: vlm.api_type || 'openai' },
      image: { ...image, api_type: image.api_type || 'openai' },
      video: { ...video, api_type: video.api_type || 'openai' }
    });
  }, [llm, vlm, image, video]);

  const handleConfigChange = (
    type: 'llm' | 'vlm' | 'image' | 'video',
    field: keyof ApiConfig,
    value: string | boolean
  ) => {
    const currentConfig = localConfig[type];

    // ✅ 确保 api_type 字段始终存在
    const newConfig = {
      ...currentConfig,
      api_type: currentConfig.api_type || 'openai',  // 保留现有值或使用默认值
      [field]: value
    };

    setLocalConfig({ ...localConfig, [type]: newConfig });
    onConfigChange(type, newConfig);
  };

  const handleApiTypeChange = (
    type: 'llm' | 'vlm' | 'image' | 'video',
    apiType: 'openai' | 'dashscope' | 'local'
  ) => {
    const config = localConfig[type];

    // 阿里百炼的默认 API URL
    const dashscopeUrls = {
      llm: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      vlm: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      image: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      video: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis'
    };

    const newConfig: ApiConfig = {
      ...config,
      api_type: apiType,
      // 自动设置阿里百炼的正确 URL
      api_url: apiType === 'dashscope' ? dashscopeUrls[type] : config.api_url,
      // 特殊处理：OpenAI 不需要 image_edit_model
      image_edit_model: apiType === 'openai' ? undefined : config.image_edit_model
    };

    setLocalConfig({ ...localConfig, [type]: newConfig });
    onConfigChange(type, newConfig);
  };

  const handleValidateAPI = async (type: 'llm' | 'image' | 'video') => {
    const config = localConfig[type];
    if (!config.api_key) {
      toast('请先输入API密钥', 'error');
      return;
    }

    setValidating(true);
    setValidationResults({ ...validationResults, [type]: undefined });

    try {
      let result;
      if (type === 'llm') {
        result = await validationApi.validateLLM(config);
      } else if (type === 'image') {
        result = await validationApi.validateImage(config);
      } else {
        result = await validationApi.validateVideo(config);
      }

      setValidationResults({
        ...validationResults,
        [type]: { valid: result.data.valid, message: result.data.message }
      });
    } catch (error: any) {
      setValidationResults({
        ...validationResults,
        [type]: { valid: false, message: `验证失败: ${error.message}` }
      });
    } finally {
      setValidating(false);
    }
  };

  // ===== 预设管理函数 =====

  // 打开保存预设对话框
  const openSavePresetDialog = (type: 'llm' | 'vlm' | 'image' | 'video') => {
    const config = localConfig[type];
    setSavePresetDialog({
      show: true,
      type,
      name: config.model || ''  // 默认使用模型名
    });
  };

  // 保存新预设（只更新前端state，不保存后端）
  const handleSavePreset = () => {
    const { type, name } = savePresetDialog;
    if (!type || !name.trim()) {
      toast('请输入预设名称', 'error');
      return;
    }

    const config = localConfig[type];

    // 检查是否所有必填字段都已填写
    if (!config.api_key || !config.model) {
      toast('请先完整填写API配置', 'error');
      return;
    }

    const newPreset: ApiConfigPreset = {
      id: uuidv4(),
      name: name.trim(),
      config: { ...config },
      created_at: new Date().toISOString()
    };

    const updatedPresets = {
      ...localPresets,
      [type]: [...localPresets[type], newPreset]
    };

    // 更新本地副本
    setLocalPresets(updatedPresets);
    // 更新父组件状态
    onPresetsChange(updatedPresets);

    setSavePresetDialog({ show: false, type: null, name: '' });
    toast('预设已创建（请点击"保存配置"按钮保存）', 'success');
  };

  // 切换标签
  const handleSwitchTag = (type: 'llm' | 'vlm' | 'image' | 'video', tagId: string) => {
    const tag = localPresets[type].find(p => p.id === tagId);
    if (tag) {
      onSwitchTag(type, tagId);
      toast(`已切换到标签: ${tag.name}（请点击"保存配置"按钮保存）`, 'success');
    }
  };

  // 打开删除确认对话框
  const openDeleteConfirmDialog = (
    type: 'llm' | 'vlm' | 'image' | 'video',
    presetId: string,
    presetName: string
  ) => {
    setDeleteConfirmDialog({
      show: true,
      type,
      presetId,
      presetName
    });
  };

  // 删除预设（只更新前端state，不保存后端）
  const handleDeletePreset = () => {
    const { type, presetId } = deleteConfirmDialog;
    if (!type || !presetId) return;

    const updatedPresets = {
      ...localPresets,
      [type]: localPresets[type].filter(p => p.id !== presetId)
    };

    // 更新本地副本
    setLocalPresets(updatedPresets);
    // 更新父组件状态
    onPresetsChange(updatedPresets);

    setDeleteConfirmDialog({ show: false, type: null, presetId: null, presetName: '' });
    toast('预设已删除（请点击"保存配置"按钮保存）', 'success');
  };

  const renderApiForm = (
    type: 'llm' | 'vlm' | 'image' | 'video',
    title: string,
    config: ApiConfig
  ) => {
    const isDashscope = config.api_type === 'dashscope';
    const showImageEditModel = type === 'image' && isDashscope;

    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-base font-semibold">{title}</h3>
          {(type === 'llm' || type === 'image' || type === 'video') && (
            <button
              onClick={() => handleValidateAPI(type)}
              disabled={validating}
              className="text-sm bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded disabled:bg-gray-600"
            >
              {validating ? '验证中...' : '验证'}
            </button>
          )}
        </div>
        {(type === 'llm' || type === 'image' || type === 'video') && validationResults[type] && (
          <div className={`text-sm p-2 rounded flex items-center gap-2 ${
            validationResults[type]!.valid ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
          }`}>
            {validationResults[type]!.valid ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {validationResults[type]!.message}
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">API 类型</label>
            <select
              value={config.api_type}
              onChange={(e) => handleApiTypeChange(type, e.target.value as 'openai' | 'dashscope')}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            >
              {API_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {isDashscope && (
              <p className="text-xs text-gray-500 mt-1">
                ℹ️ 使用阿里百炼平台，API地址和模型已自动配置
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">API URL</label>
            <input
              type="text"
              value={config.api_url}
              onChange={(e) => handleConfigChange(type, 'api_url', e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              disabled={isDashscope}
            />
            {isDashscope && (
              <p className="text-xs text-gray-500 mt-1">
                阿里百炼API地址为默认值，不可修改
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">API Key</label>
            <input
              type="password"
              value={config.api_key}
              onChange={(e) => handleConfigChange(type, 'api_key', e.target.value)}
              placeholder="sk-..."
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">模型</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => handleConfigChange(type, 'model', e.target.value)}
              placeholder={type === 'llm' ? 'gpt-4' : type === 'vlm' ? 'gpt-4o' : type === 'image' ? 'dall-e-3' : 'sora'}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            />
          </div>

          {/* 配置预设标签区域 */}
          <div className="border-t border-gray-700 pt-3 mt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm text-gray-400">已保存的配置</label>
              {localPresets[type].length > 5 && (
                <button
                  onClick={() => setPresetsExpanded({ ...presetsExpanded, [type]: !presetsExpanded[type] })}
                  className="text-xs text-gray-400 hover:text-gray-300 flex items-center gap-1"
                >
                  {presetsExpanded[type] ? '收起' : '更多'}
                  <ChevronDown size={12} className={`transition-transform ${presetsExpanded[type] ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {/* 显示预设标签 */}
              {(presetsExpanded[type] ? localPresets[type] : localPresets[type].slice(0, 5)).map((preset) => {
                // 通过预设ID判断是否高亮
                const isActive = activePresetIds[type] === preset.id;
                return (
                  <div
                    key={preset.id}
                    className={`group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition cursor-pointer ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600'
                    }`}
                    onClick={() => handleSwitchTag(type, preset.id)}
                  >
                    <span>{preset.name}</span>
                    {isActive && <CheckCircle2 size={14} />}
                    {/* 删除按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openDeleteConfirmDialog(type, preset.id, preset.name);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition ml-1 text-red-400 hover:text-red-300"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
              {/* 新建预设按钮 */}
              <button
                onClick={() => openSavePresetDialog(type)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm border-2 border-dashed border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300 transition"
              >
                <Plus size={14} />
                新建
              </button>
            </div>
          </div>

          {showImageEditModel && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">图像编辑模型 (图生图)</label>
              <input
                type="text"
                value={config.image_edit_model || ''}
                onChange={(e) => handleConfigChange(type, 'image_edit_model', e.target.value)}
                placeholder="wan2.6-image"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              />
              <p className="text-xs text-gray-500 mt-1">
                用于图像编辑/多图参考功能
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="flex border-b border-gray-700 overflow-x-auto">
        {(['llm', 'vlm', 'image', 'video', 'sizes'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setApiSubTab(tab)}
            className={`px-4 py-3 font-medium text-sm transition whitespace-nowrap ${
              apiSubTab === tab
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab === 'llm' ? '语言模型' : tab === 'vlm' ? '视觉模型' : tab === 'image' ? '图像生成' : tab === 'video' ? '视频生成' : '生图分辨率'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {apiSubTab === 'llm' && renderApiForm('llm', '语言模型 API (对话与分析)', localConfig.llm)}
        {apiSubTab === 'vlm' && renderApiForm('vlm', '视觉语言模型 API (图片理解/反推提示词)', localConfig.vlm)}
        {apiSubTab === 'image' && renderApiForm('image', '图像生成 API', localConfig.image)}
        {apiSubTab === 'video' && renderApiForm('video', '视频生成 API', localConfig.video)}
        {apiSubTab === 'sizes' && (
          <div className="space-y-4">
            <h3 className="text-base font-semibold mb-4">生图分辨率设置</h3>
            <p className="text-sm text-gray-400 mb-4">
              为不同类型的资产设置图像生成的分辨率。支持比例格式（如 1x1、16x9）或具��像素（如 1024x1024）。
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">角色分辨率</label>
                <input
                  type="text"
                  value={localImageSizes.character || '1x1'}
                  onChange={(e) => handleImageSizeChange('character', e.target.value)}
                  placeholder="1x1"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                />
                <p className="text-xs text-gray-500 mt-1">默认: 1x1（正方形）</p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">场景分辨率</label>
                <input
                  type="text"
                  value={localImageSizes.scene || '16x9'}
                  onChange={(e) => handleImageSizeChange('scene', e.target.value)}
                  placeholder="16x9"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                />
                <p className="text-xs text-gray-500 mt-1">默认: 16x9（横向）</p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">道具分辨率</label>
                <input
                  type="text"
                  value={localImageSizes.prop || '1x1'}
                  onChange={(e) => handleImageSizeChange('prop', e.target.value)}
                  placeholder="1x1"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                />
                <p className="text-xs text-gray-500 mt-1">默认: 1x1（正方形）</p>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">分镜分辨率</label>
                <input
                  type="text"
                  value={localImageSizes.storyboard || '16x9'}
                  onChange={(e) => handleImageSizeChange('storyboard', e.target.value)}
                  placeholder="16x9"
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                />
                <p className="text-xs text-gray-500 mt-1">默认: 16x9（横向）</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 保存预设对话框 */}
      {savePresetDialog.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">保存为配置预设</h3>
            <div className="mb-4">
              <label className="block text-sm text-gray-400 mb-2">预设名称</label>
              <input
                type="text"
                value={savePresetDialog.name}
                onChange={(e) => setSavePresetDialog({ ...savePresetDialog, name: e.target.value })}
                placeholder="请输入预设名称"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSavePreset();
                  }
                }}
              />
              <p className="text-xs text-gray-500 mt-1">
                默认使用模型名，也可自定义（如"生产环境"、"测试环境"等）
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSavePresetDialog({ show: false, type: null, name: '' })}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                取消
              </button>
              <button
                onClick={handleSavePreset}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认对话框 */}
      {deleteConfirmDialog.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">确认删除</h3>
            <p className="text-gray-300 mb-4">
              确定删除预设 <span className="text-blue-400 font-medium">"{deleteConfirmDialog.presetName}"</span> 吗？
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirmDialog({ show: false, type: null, presetId: null, presetName: '' })}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                取消
              </button>
              <button
                onClick={handleDeletePreset}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
