import { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, X, Plus, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { validationApi, authApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import type { ApiConfig, ImageSizes, ApiConfigPresetsMap, ApiConfigPreset } from '@/types';

interface ApiConfigPanelProps {
  llm: ApiConfig;
  vlm: ApiConfig;
  image: ApiConfig;
  video: ApiConfig;
  tts: ApiConfig;
  onConfigChange: (type: 'llm' | 'vlm' | 'image' | 'video' | 'tts', config: ApiConfig) => void;
  imageSizes?: ImageSizes;
  onImageSizesChange?: (sizes: ImageSizes) => void;
  configPresets: ApiConfigPresetsMap;
  onPresetsChange: (presets: ApiConfigPresetsMap) => void;
  onSwitchTag: (type: 'llm' | 'vlm' | 'image' | 'video' | 'tts', tagId: string) => void;
  activePresetIds: {
    llm: string | null;
    vlm: string | null;
    image: string | null;
    video: string | null;
    tts: string | null;
  };
}

const API_TYPE_OPTIONS = [
  { value: 'createnow', label: 'CreateNow 官方接口' },
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'dashscope', label: '阿里百炼 DashScope' },
  { value: 'byteseed', label: '字节 Seed' },
  { value: 'local', label: '本地API' }
];

export function ApiConfigPanel({
  llm,
  vlm,
  image,
  video,
  tts,
  onConfigChange,
  imageSizes,
  onImageSizesChange,
  configPresets,
  onPresetsChange,
  onSwitchTag,
  activePresetIds
}: ApiConfigPanelProps) {
  const { toast } = useToast();
  const [apiSubTab, setApiSubTab] = useState<'llm' | 'vlm' | 'image' | 'video' | 'tts' | 'sizes'>('llm');

  // API Key 明文显示状态（每个服务类型独立）
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const toggleShowKey = (type: string) =>
    setShowKeys(prev => ({ ...prev, [type]: !prev[type] }));

  // 本地预设副本，用于解决 props 更新延迟问题
  const [localPresets, setLocalPresets] = useState<ApiConfigPresetsMap>(configPresets);

  // 同步 props 的预设到本地副本
  useEffect(() => {
    setLocalPresets(configPresets);
  }, [configPresets]);

  // 保存预设对话框状态
  const [savePresetDialog, setSavePresetDialog] = useState<{
    show: boolean;
    type: 'llm' | 'vlm' | 'image' | 'video' | 'tts' | null;
    name: string;
  }>({
    show: false,
    type: null,
    name: ''
  });

  // 删除确认对话框状态
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    show: boolean;
    type: 'llm' | 'vlm' | 'image' | 'video' | 'tts' | null;
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
    tts: boolean;
  }>({
    llm: false,
    vlm: false,
    image: false,
    video: false,
    tts: false
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
    tts?: { valid: boolean; message: string };
  }>({});

  // 本地状态管理配置
  const [localConfig, setLocalConfig] = useState<{
    llm: ApiConfig;
    vlm: ApiConfig;
    image: ApiConfig;
    video: ApiConfig;
    tts: ApiConfig;
  }>({
    llm: { ...llm, api_type: llm.api_type || 'openai' },
    vlm: { ...vlm, api_type: vlm.api_type || 'openai' },
    image: { ...image, api_type: image.api_type || 'openai' },
    video: { ...video, api_type: video.api_type || 'openai' },
    tts: { ...tts, api_type: tts.api_type || 'openai' }
  });

  // 当props变化时更新本地状态
  useEffect(() => {
    setLocalConfig({
      llm: { ...llm, api_type: llm.api_type || 'openai' },
      vlm: { ...vlm, api_type: vlm.api_type || 'openai' },
      image: { ...image, api_type: image.api_type || 'openai' },
      video: { ...video, api_type: video.api_type || 'openai' },
      tts: { ...tts, api_type: tts.api_type || 'openai' }
    });
  }, [llm, vlm, image, video, tts]);

  const handleConfigChange = (
    type: 'llm' | 'vlm' | 'image' | 'video' | 'tts',
    field: keyof ApiConfig,
    value: string | boolean | number
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
    type: 'llm' | 'vlm' | 'image' | 'video' | 'tts',
    apiType: 'openai' | 'dashscope' | 'local' | 'byteseed' | 'createnow'
  ) => {
    const config = localConfig[type];

    // 阿里百炼的默认 API URL
    const dashscopeUrls = {
      llm: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      vlm: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      image: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      video: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
      tts: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/speech-synthesis'
    };

    const createnowUrl = 'http://47.117.182.216:8003/v1';

    const newConfig: ApiConfig = {
      ...config,
      api_type: apiType,
      // 自动设置对应接口的正确 URL
      api_url: apiType === 'dashscope' ? dashscopeUrls[type]
             : apiType === 'createnow' ? createnowUrl
             : config.api_url,
      // createnow 默认模型
      model: apiType === 'createnow' ? 'nova-pro' : config.model,
      // 特殊处理：OpenAI 不需要 image_edit_model
      image_edit_model: apiType === 'openai' ? undefined : config.image_edit_model,
      // createnow 视频默认开启生成音频和全能参考（其他服务类型不注入视频专用字段）
      ...(apiType === 'createnow' && type === 'video' ? { generate_audio: true, multimodal_reference: true } : {})
    };

    setLocalConfig({ ...localConfig, [type]: newConfig });
    onConfigChange(type, newConfig);
  };

  const handleValidateAPI = async (type: 'llm' | 'image' | 'video' | 'tts') => {
    // ✅ 检查是否选中预设
    if (activePresetIds[type] === null) {
      toast('请先创建或选择一个配置预设', 'error');
      return;
    }

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
      } else if (type === 'video') {
        result = await validationApi.validateVideo(config);
      } else if (type === 'tts') {
        result = await validationApi.validateTTS(config);
      }

      if (result) {
        setValidationResults({
          ...validationResults,
          [type]: { valid: result.data.valid, message: result.data.message }
        });
      }
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
  const openSavePresetDialog = (type: 'llm' | 'vlm' | 'image' | 'video' | 'tts') => {
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

    // ✅ 移除验证 - 允许保存空白配置
    // 用户可以先创建预设，再填写配置

    const newPreset: ApiConfigPreset = {
      id: uuidv4(),
      name: name.trim(),
      config: { ...config },
      created_at: new Date().toISOString()
    };

    const updatedPresets = {
      ...localPresets,
      [type]: [...(localPresets[type] || []), newPreset]
    };

    // 更新本地副本
    setLocalPresets(updatedPresets);
    // 更新父组件状态
    onPresetsChange(updatedPresets);

    // 自动切换到新建的预设
    onSwitchTag(type, newPreset.id);

    setSavePresetDialog({ show: false, type: null, name: '' });
    toast('配置预设已创建，请填写完整后保存', 'success');
  };

  // 切换标签
  const handleSwitchTag = (type: 'llm' | 'vlm' | 'image' | 'video' | 'tts', tagId: string) => {
    const tag = (localPresets[type] || []).find(p => p.id === tagId);
    if (tag) {
      onSwitchTag(type, tagId);
      toast(`已切换到标签: ${tag.name}（请点击"保存配置"按钮保存）`, 'success');
    }
  };

  // 打开删除确认对话框
  const openDeleteConfirmDialog = (
    type: 'llm' | 'vlm' | 'image' | 'video' | 'tts',
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
      [type]: (localPresets[type] || []).filter(p => p.id !== presetId)
    };

    // 更新本地副本
    setLocalPresets(updatedPresets);
    // 更新父组件状态
    onPresetsChange(updatedPresets);

    setDeleteConfirmDialog({ show: false, type: null, presetId: null, presetName: '' });
    toast('预设已删除（请点击"保存配置"按钮保存）', 'success');
  };

  const renderApiForm = (
    type: 'llm' | 'vlm' | 'image' | 'video' | 'tts',
    title: string,
    config: ApiConfig
  ) => {
    const isDashscope = config.api_type === 'dashscope';
    const isLocal = config.api_type === 'local';
    const isByteSeed = config.api_type === 'byteseed';
    const isCreatenow = config.api_type === 'createnow';
    const showImageEditModel = type === 'image' && isDashscope;
    const showVoiceField = type === 'tts' && !isLocal;  // OpenAI和阿里百炼显示voice
    const showIdField = type === 'tts' && isLocal;  // 本地API显示id
    const showByteSeedVideoOptions = type === 'video' && (isByteSeed || isCreatenow);  // ByteSeed/CreateNow视频特有选项
    const showMultimodalReference = type === 'video' && (isByteSeed || isCreatenow);  // 全能参考：ByteSeed 和 CreateNow 均支持
    const showByteSeedImageOptions = type === 'image' && isByteSeed;  // ByteSeed图像特有选项
    const showVolcengineAkSk = type === 'video' && isByteSeed;  // 仅 byteseed 时显示 AK/SK（createnow 由服务器注入）

    // ✅ 增强判断：不仅检查 null，还检查预设是否真实存在
    const hasNoActiveTag =
      activePresetIds[type] === null ||
      !localPresets[type]?.some(p => p.id === activePresetIds[type]);

    return (
      <div className="space-y-4">
        {/* ✅ 新增：未选中标签时的提示 */}
        {hasNoActiveTag && (
          <div className="bg-yellow-900/30 border border-yellow-600 rounded p-3 text-sm text-yellow-200 mb-4">
            ⚠️ 请先创建或选择一个配置预设，然后再填写API配置
          </div>
        )}

        <div className="flex justify-between items-center mb-2">
          <h3 className="text-base font-semibold">{title}</h3>
          {(type === 'llm' || type === 'image' || type === 'video' || type === 'tts') && (
            <button
              onClick={() => handleValidateAPI(type)}
              disabled={validating}
              className="text-sm bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded disabled:bg-gray-600"
            >
              {validating ? '验证中...' : '验证'}
            </button>
          )}
        </div>
        {(type === 'llm' || type === 'image' || type === 'video' || type === 'tts') && validationResults[type] && (
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
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white disabled:bg-gray-800 disabled:cursor-not-allowed"
              disabled={hasNoActiveTag}
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
            {isCreatenow && (
              <p className="text-xs text-gray-500 mt-1">
                ℹ️ 使用 CreateNow 官方接口，需在主页登录账号
              </p>
            )}
            {hasNoActiveTag && (
              <p className="text-xs text-yellow-500 mt-1">
                请先创建配置预设
              </p>
            )}
          </div>

          {/* API URL：createnow 时完全隐藏 */}
          {!isCreatenow && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">API URL</label>
              <input
                type="text"
                value={config.api_url}
                onChange={(e) => handleConfigChange(type, 'api_url', e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white disabled:bg-gray-800 disabled:cursor-not-allowed"
                disabled={isDashscope || hasNoActiveTag}
              />
              {isDashscope && (
                <p className="text-xs text-gray-500 mt-1">
                  阿里百炼API地址为默认值，不可修改
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">API Key</label>
            <div className="flex gap-2">
              <input
                type={showKeys[type] ? 'text' : 'password'}
                value={config.api_key}
                onChange={(e) => handleConfigChange(type, 'api_key', e.target.value)}
                placeholder="sk-..."
                autoComplete="new-password"
                className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white disabled:bg-gray-800 disabled:cursor-not-allowed"
                disabled={hasNoActiveTag}
              />
              {/* 显示/隐藏 API Key */}
              <button
                type="button"
                onClick={() => toggleShowKey(type)}
                disabled={hasNoActiveTag}
                className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition"
                title={showKeys[type] ? '隐藏密钥' : '显示密钥'}
              >
                {showKeys[type] ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              {isCreatenow && (
                <button
                  onClick={async () => {
                    try {
                      const res = await authApi.getKey();
                      const { logged_in, api_key } = res.data;
                      if (!logged_in || !api_key) {
                        toast('请先在主页登录 CreateNow 账号', 'error');
                        return;
                      }
                      handleConfigChange(type, 'api_key', api_key);
                      toast('已填入登录密钥', 'success');
                    } catch {
                      toast('获取密钥失败', 'error');
                    }
                  }}
                  disabled={hasNoActiveTag}
                  className="px-3 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm whitespace-nowrap disabled:bg-gray-700 disabled:cursor-not-allowed transition"
                >
                  使用登录密钥
                </button>
              )}
            </div>
            {isCreatenow && (
              <p className="text-xs text-gray-500 mt-1">
                点击"使用登录密钥"自动填入，或手动输入
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">模型</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => handleConfigChange(type, 'model', e.target.value)}
              placeholder={type === 'llm' ? 'gpt-4' : type === 'vlm' ? 'gpt-4o' : type === 'image' ? 'dall-e-3' : type === 'tts' ? 'tts-1' : 'sora'}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white disabled:bg-gray-800 disabled:cursor-not-allowed"
              disabled={hasNoActiveTag}
            />
          </div>

          {showVoiceField && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">默认音色 (可选)</label>
              <input
                type="text"
                value={config.voice || ''}
                onChange={(e) => handleConfigChange(type, 'voice', e.target.value)}
                placeholder="alloy"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white disabled:bg-gray-800 disabled:cursor-not-allowed"
                disabled={hasNoActiveTag}
              />
              <p className="text-xs text-gray-500 mt-1">
                OpenAI: alloy, echo, fable, onyx, nova, shimmer | 阿里百炼: zhichu, zhitian等
              </p>
            </div>
          )}

          {showIdField && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Speaker ID (可选)</label>
              <input
                type="text"
                value={config.id || ''}
                onChange={(e) => handleConfigChange(type, 'id', e.target.value)}
                placeholder="0"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white disabled:bg-gray-800 disabled:cursor-not-allowed"
                disabled={hasNoActiveTag}
              />
              <p className="text-xs text-gray-500 mt-1">
                本地API的说话人ID，用于指定音色
              </p>
            </div>
          )}

          {showByteSeedVideoOptions && (
            <>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.generate_audio || false}
                    onChange={(e) => handleConfigChange(type, 'generate_audio', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                    disabled={hasNoActiveTag}
                  />
                  <span className="text-sm text-gray-300">生成音频</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.watermark || false}
                    onChange={(e) => handleConfigChange(type, 'watermark', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                    disabled={hasNoActiveTag}
                  />
                  <span className="text-sm text-gray-300">添加水印</span>
                </label>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                字节Seed特有选项：生成音频需要使用 Seed 1.5 Pro 模型；CreateNow 官方接口同样支持
              </p>
            </>
          )}

          {showMultimodalReference && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.multimodal_reference || false}
                  onChange={(e) => handleConfigChange(type, 'multimodal_reference', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                  disabled={hasNoActiveTag}
                />
                <span className="text-sm text-gray-300">全能参考</span>
              </label>
            </div>
          )}

          {showVolcengineAkSk && (
            <div className="space-y-3 border-t border-gray-700 pt-3">
              <p className="text-xs text-gray-400">Volcengine 素材库（可选，用于提交虚拟人像素材）</p>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Volcengine Access Key</label>
                <input
                  type="text"
                  value={(config as any).volcengine_ak || ''}
                  onChange={(e) => handleConfigChange(type, 'volcengine_ak' as any, e.target.value)}
                  placeholder="AK..."
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white disabled:bg-gray-800 disabled:cursor-not-allowed"
                  disabled={hasNoActiveTag}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Volcengine Secret Key</label>
                <input
                  type="password"
                  value={(config as any).volcengine_sk || ''}
                  onChange={(e) => handleConfigChange(type, 'volcengine_sk' as any, e.target.value)}
                  placeholder="SK..."
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white disabled:bg-gray-800 disabled:cursor-not-allowed"
                  disabled={hasNoActiveTag}
                />
              </div>
            </div>
          )}

          {showByteSeedImageOptions && (
            <>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">生成图片数量（1-4张）</label>
                  <input
                    type="number"
                    min="1"
                    max="4"
                    value={config.max_images || 1}
                    onChange={(e) => handleConfigChange(type, 'max_images', parseInt(e.target.value) || 1)}
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white disabled:bg-gray-800 disabled:cursor-not-allowed"
                    disabled={hasNoActiveTag}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    一次生成多张连贯图片（如四季变化、不同时段）
                  </p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.watermark || false}
                    onChange={(e) => handleConfigChange(type, 'watermark', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                    disabled={hasNoActiveTag}
                  />
                  <span className="text-sm text-gray-300">添加水印</span>
                </label>
              </div>
            </>
          )}

          {/* 配置预设标签区域 */}
          <div className="border-t border-gray-700 pt-3 mt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm text-gray-400">已保存的配置</label>
              {(localPresets[type]?.length || 0) > 5 && (
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
              {(presetsExpanded[type] ? (localPresets[type] || []) : (localPresets[type] || []).slice(0, 5)).map((preset) => {
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
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white disabled:bg-gray-800 disabled:cursor-not-allowed"
                disabled={hasNoActiveTag}
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
        {(['llm', 'vlm', 'image', 'video', 'tts', 'sizes'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setApiSubTab(tab)}
            className={`px-4 py-3 font-medium text-sm transition whitespace-nowrap ${
              apiSubTab === tab
                ? 'border-b-2 border-blue-500 text-blue-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab === 'llm' ? '语言模型' : tab === 'vlm' ? '视觉模型' : tab === 'image' ? '图像生成' : tab === 'video' ? '视频生成' : tab === 'tts' ? '语音合成' : '生图分辨率'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {apiSubTab === 'llm' && renderApiForm('llm', '语言模型 API (对话与分析)', localConfig.llm)}
        {apiSubTab === 'vlm' && renderApiForm('vlm', '视觉语言模型 API (图片理解/反推提示词)', localConfig.vlm)}
        {apiSubTab === 'image' && renderApiForm('image', '图像生成 API', localConfig.image)}
        {apiSubTab === 'video' && renderApiForm('video', '视频生成 API', localConfig.video)}
        {apiSubTab === 'tts' && renderApiForm('tts', '语音合成 API (TTS)', localConfig.tts)}
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
