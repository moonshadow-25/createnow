import { useState, useEffect } from 'react';
import { Settings, Key, Wand2, FolderTree, X, Save, Palette, Globe, RefreshCw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useProjectStore } from '@/store/projectStore';
import { useToast } from '@/components/common/Toast';
import { ApiConfigPanel } from './ApiConfigPanel';
import { PromptPanel } from './PromptPanel';
import { LogsPanel } from './LogsPanel';
import { GlobalStylePanel } from './GlobalStylePanel';
import { GlobalPromptPanel } from './GlobalPromptPanel';
import { UpdatePanel } from './UpdatePanel';
import type { ApiConfig, ImageSizes, ApiConfigPresetsMap } from '@/types';

type SettingsPanel = 'api' | 'global-style' | 'prompts' | 'global-prompts' | 'logs' | 'update';

interface SettingsModalProps {
  projectId: string;
  onClose: () => void;
}

export function SettingsModal({ projectId, onClose }: SettingsModalProps) {
  const { toast } = useToast();
  const { currentProject, updateProject } = useProjectStore();
  const [settingsPanel, setSettingsPanel] = useState<SettingsPanel>('api');
  const [saving, setSaving] = useState(false);

  // 初始化生图分辨率配置
  const [imageSizes, setImageSizes] = useState<ImageSizes>({
    character: '1x1',
    scene: '16x9',
    prop: '1x1',
    storyboard: '16x9'
  });

  // 初始化配置预设
  const [configPresets, setConfigPresets] = useState<ApiConfigPresetsMap>({
    llm: [],
    vlm: [],
    image: [],
    video: [],
    tts: []
  });

  // 初始化当前选中的预设ID
  const [activePresetIds, setActivePresetIds] = useState<{
    llm: string | null;
    vlm: string | null;
    image: string | null;
    video: string | null;
    tts: string | null;
  }>({
    llm: null,
    vlm: null,
    image: null,
    video: null,
    tts: null
  });

  // 计算当前配置（从当前选中的标签读取）
  const getCurrentConfig = (type: 'llm' | 'vlm' | 'image' | 'video' | 'tts'): ApiConfig => {
    const activeTagId = activePresetIds[type];
    if (!activeTagId) {
      // 没有选中标签，返回默认配置
      return {
        api_type: 'openai',
        api_url: '',
        api_key: '',
        model: '',
        image_edit_model: type === 'image' ? '' : undefined,
        voice: type === 'tts' ? '' : undefined,
        id: type === 'tts' ? '' : undefined
      };
    }

    const tag = configPresets[type].find(t => t.id === activeTagId);
    if (!tag) {
      // 标签不存在，返回默认配置
      return {
        api_type: 'openai',
        api_url: '',
        api_key: '',
        model: '',
        image_edit_model: type === 'image' ? '' : undefined,
        voice: type === 'tts' ? '' : undefined,
        id: type === 'tts' ? '' : undefined
      };
    }

    return tag.config;
  };

  // 组件挂载时加载配置
  useEffect(() => {
    if (currentProject?.ai_config) {
      const aiConfig = currentProject.ai_config as any;

      // 加载分辨率配置
      setImageSizes({
        character: aiConfig.image_sizes?.character || '1x1',
        scene: aiConfig.image_sizes?.scene || '16x9',
        prop: aiConfig.image_sizes?.prop || '1x1',
        storyboard: aiConfig.image_sizes?.storyboard || '16x9'
      });

      // 加载当前选中的标签ID
      if (aiConfig.active_preset_ids) {
        setActivePresetIds(aiConfig.active_preset_ids);
      }

      // 加载配置标签或自动创建初始标签
      if (aiConfig.config_presets && Object.keys(aiConfig.config_presets).length > 0) {
        setConfigPresets(aiConfig.config_presets);
      } else {
        // 无标签，为每种已配置的API类型自动创建初始标签
        const initialPresets: ApiConfigPresetsMap = {
          llm: [],
          vlm: [],
          image: [],
          video: [],
          tts: []
        };

        if (aiConfig.llm?.api_key && aiConfig.llm?.model) {
          initialPresets.llm.push({
            id: uuidv4(),
            name: aiConfig.llm.model || 'Default LLM',
            config: {
              api_type: aiConfig.llm.api_type || 'openai',
              api_url: aiConfig.llm.api_url || '',
              api_key: aiConfig.llm.api_key || '',
              model: aiConfig.llm.model || ''
            },
            created_at: new Date().toISOString()
          });
        }

        if (aiConfig.vlm?.api_key && aiConfig.vlm?.model) {
          initialPresets.vlm.push({
            id: uuidv4(),
            name: aiConfig.vlm.model || 'Default VLM',
            config: {
              api_type: aiConfig.vlm.api_type || 'openai',
              api_url: aiConfig.vlm.api_url || '',
              api_key: aiConfig.vlm.api_key || '',
              model: aiConfig.vlm.model || ''
            },
            created_at: new Date().toISOString()
          });
        }

        if (aiConfig.image?.api_key && aiConfig.image?.model) {
          initialPresets.image.push({
            id: uuidv4(),
            name: aiConfig.image.model || 'Default Image',
            config: {
              api_type: aiConfig.image.api_type || 'openai',
              api_url: aiConfig.image.api_url || '',
              api_key: aiConfig.image.api_key || '',
              model: aiConfig.image.model || '',
              image_edit_model: aiConfig.image.image_edit_model || ''
            },
            created_at: new Date().toISOString()
          });
        }

        if (aiConfig.video?.api_key && aiConfig.video?.model) {
          initialPresets.video.push({
            id: uuidv4(),
            name: aiConfig.video.model || 'Default Video',
            config: {
              api_type: aiConfig.video.api_type || 'openai',
              api_url: aiConfig.video.api_url || '',
              api_key: aiConfig.video.api_key || '',
              model: aiConfig.video.model || ''
            },
            created_at: new Date().toISOString()
          });
        }

        if (aiConfig.tts?.api_key && aiConfig.tts?.model) {
          initialPresets.tts.push({
            id: uuidv4(),
            name: aiConfig.tts.model || 'Default TTS',
            config: {
              api_type: aiConfig.tts.api_type || 'openai',
              api_url: aiConfig.tts.api_url || '',
              api_key: aiConfig.tts.api_key || '',
              model: aiConfig.tts.model || '',
              voice: aiConfig.tts.voice || 'alloy'
            },
            created_at: new Date().toISOString()
          });
        }

        setConfigPresets(initialPresets);
      }
    }
  }, [currentProject]);

  const handleConfigChange = (type: 'llm' | 'vlm' | 'image' | 'video' | 'tts', config: ApiConfig) => {
    const activeTagId = activePresetIds[type];

    if (!activeTagId) {
      // 如果没有激活标签，说明是新建配置，暂时不更新（等待保存预设后自动切换）
      return;
    }

    // 🔑 关键：同时更新 configPresets 中对应标签的配置
    setConfigPresets({
      ...configPresets,
      [type]: (configPresets[type] || []).map(tag =>
        tag.id === activeTagId
          ? { ...tag, config: { ...config } }  // 更新当前标签的配置
          : tag
      )
    });
  };

  // 切换标签
  const handleSwitchTag = (type: 'llm' | 'vlm' | 'image' | 'video' | 'tts', tagId: string) => {
    // 直接更新选中ID，丢弃未保存的修改
    setActivePresetIds({
      ...activePresetIds,
      [type]: tagId
    });
  };

  // 统一保存所有配置到后端
  const handleSaveSettings = async () => {
    if (!projectId) return;

    // ✅ 检查是否至少有一个类型有选中的预设
    const hasAnyActivePreset = Object.values(activePresetIds).some(id => id !== null);

    if (!hasAnyActivePreset) {
      toast('请至少为一个API类型创建配置预设', 'error');
      return;
    }

    setSaving(true);
    try {
      // 构建保存数据
      const saveData: any = {
        config_presets: configPresets,
        active_preset_ids: activePresetIds,
        image_sizes: imageSizes
      };

      // 🔑 关键：将每个类型当前高亮标签的配置同步到 ai_config[type]
      (['llm', 'vlm', 'image', 'video', 'tts'] as const).forEach(type => {
        const activeTagId = activePresetIds[type];
        if (activeTagId) {
          const activeTag = configPresets[type].find(t => t.id === activeTagId);
          if (activeTag) {
            saveData[type] = activeTag.config;  // 同步到 ai_config[type]
          }
        }
      });

      await updateProject(projectId, { ai_config: saveData });
      toast('API配置已保存', 'success');
    } catch (error) {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const navItems = [
    { id: 'api' as const, icon: Key, label: 'API设置' },
    { id: 'global-style' as const, icon: Palette, label: '全局风格' },
    { id: 'prompts' as const, icon: Wand2, label: '提示词管理' },
    { id: 'global-prompts' as const, icon: Globe, label: '全局提示词' },
    { id: 'logs' as const, icon: FolderTree, label: 'AI日志' },
    { id: 'update' as const, icon: RefreshCw, label: '检查更新' },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-7xl h-[95vh] overflow-hidden flex flex-col">
        {/* 主内容区 - 左��分栏 */}
        <div className="flex flex-1 min-h-0">
          {/* 左侧导航栏 */}
          <div className="w-48 bg-gray-900 border-r border-gray-700 flex flex-col min-h-0">
            <div className="p-4 border-b border-gray-700 shrink-0">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Settings size={18} />
                设置
              </h2>
            </div>
            <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSettingsPanel(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition ${
                    settingsPanel === item.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <item.icon size={16} />
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          {/* 右侧内容区 */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* 标题栏 */}
            <div className="flex justify-between items-center px-4 py-3 border-b border-gray-700">
              <h2 className="text-lg font-semibold">
                {settingsPanel === 'api' && 'API配置'}
                {settingsPanel === 'global-style' && '全局风格'}
                {settingsPanel === 'prompts' && '提示词管理'}
                {settingsPanel === 'global-prompts' && '全局提示词'}
                {settingsPanel === 'logs' && 'AI日志'}
                {settingsPanel === 'update' && '检查更新'}
              </h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* 面板内容 */}
            {settingsPanel === 'api' && (
              <ApiConfigPanel
                llm={getCurrentConfig('llm')}
                vlm={getCurrentConfig('vlm')}
                image={getCurrentConfig('image')}
                video={getCurrentConfig('video')}
                tts={getCurrentConfig('tts')}
                onConfigChange={handleConfigChange}
                imageSizes={imageSizes}
                onImageSizesChange={setImageSizes}
                configPresets={configPresets}
                onPresetsChange={setConfigPresets}
                onSwitchTag={handleSwitchTag}
                activePresetIds={activePresetIds}
              />
            )}
            {settingsPanel === 'global-style' && (
              <div className="flex-1 overflow-y-auto">
                <GlobalStylePanel projectId={projectId} />
              </div>
            )}
            {settingsPanel === 'prompts' && (
              <PromptPanel projectId={projectId} />
            )}
            {settingsPanel === 'global-prompts' && (
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <GlobalPromptPanel />
              </div>
            )}
            {settingsPanel === 'logs' && (
              <LogsPanel projectId={projectId} />
            )}
            {settingsPanel === 'update' && (
              <div className="flex-1 overflow-y-auto">
                <UpdatePanel />
              </div>
            )}

            {/* 底部操作栏 - 仅 API 面板显示保存按钮 */}
            {settingsPanel === 'api' && (
              <div className="flex justify-end items-center px-4 py-3 border-t border-gray-700">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm mr-2"
                >
                  关闭
                </button>
                <button
                  onClick={handleSaveSettings}
                  className="flex items-center gap-1 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded"></div>
                      保存中...
                    </>
                  ) : (
                    <>
                      <Save size={14} />
                      保存配置
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
