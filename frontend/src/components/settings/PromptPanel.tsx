import { useState, useEffect } from 'react';
import { generationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface PromptPanelProps {
  projectId: string;
}

// 模板类型定义
type TemplateType = 'image' | 'video' | 'video_reverse' | 'storyboard' | 'storyboard_image' | 'storyboard_image_edit' | 'image_edit' | 'triple_grid' | 'vlm' | 'multi_scene_video';

interface TemplateData {
  name: string;
  description: string;
  content: string;
  is_preset?: boolean;
  variables?: string[];
}

interface TemplateTypeData {
  presets: Record<string, TemplateData>;
  custom: Record<string, TemplateData>;
  active: string;
  templates: Record<string, TemplateData>;
}

interface TemplatesResponse {
  [key: string]: TemplateTypeData | boolean | undefined;
  is_custom: boolean;
  is_legacy?: boolean;
}

export function PromptPanel({ projectId }: PromptPanelProps) {
  const { toast } = useToast();
  const [promptTab, setPromptTab] = useState<TemplateType>('image');
  const [templatesData, setTemplatesData] = useState<TemplatesResponse | null>(null);
  const [promptSaving, setPromptSaving] = useState(false);
  const [editingContent, setEditingContent] = useState<string>('');

  useEffect(() => {
    loadPromptTemplates();
  }, [projectId]);

  const loadPromptTemplates = async () => {
    if (!projectId) return;
    try {
      const response = await generationApi.getPromptTemplates(projectId);
      setTemplatesData(response.data);

      // 初始化编辑内容
      const currentType = response.data[promptTab] as TemplateTypeData;
      if (currentType) {
        const activeTemplate = currentType.templates[currentType.active];
        if (activeTemplate) {
          setEditingContent(activeTemplate.content || '');
        }
      }

      // 显示旧格式提示
      if (response.data.is_legacy) {
        toast('检测到旧格式模板，切换或编辑后将自动升级', 'info');
      }
    } catch (error) {
      console.error('Failed to load prompt templates:', error);
      toast('加载模板失败', 'error');
    }
  };

  // 切换tab时更新编辑内容
  useEffect(() => {
    if (templatesData && templatesData[promptTab]) {
      const currentType = templatesData[promptTab] as TemplateTypeData;
      const activeTemplate = currentType.templates[currentType.active];
      if (activeTemplate) {
        setEditingContent(activeTemplate.content || '');
      }
    }
  }, [promptTab, templatesData]);

  const handleSwitchTemplate = async (newActiveId: string) => {
    if (!projectId || !templatesData) return;

    const currentType = templatesData[promptTab] as TemplateTypeData;

    setPromptSaving(true);
    try {
      await generationApi.updatePromptTemplates(projectId, {
        [promptTab]: {
          ...currentType,
          active: newActiveId
        }
      });

      await loadPromptTemplates();
      toast('已切换模板', 'success');
    } catch (error: any) {
      toast(`切换失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setPromptSaving(false);
    }
  };

  const handleCreateCustom = async () => {
    if (!projectId || !templatesData) return;

    const currentType = templatesData[promptTab] as TemplateTypeData;
    const customCount = Object.keys(currentType.custom || {}).length;
    const newId = `custom_${Date.now()}`;
    const currentActive = currentType.templates[currentType.active];

    const newTemplate: TemplateData = {
      name: `自定义${customCount + 1}`,
      description: `基于 "${currentActive?.name || '默认'}" 创建`,
      content: editingContent || currentActive?.content || '',
      is_preset: false
    };

    setPromptSaving(true);
    try {
      await generationApi.updatePromptTemplates(projectId, {
        [promptTab]: {
          ...currentType,
          custom: {
            ...currentType.custom,
            [newId]: newTemplate
          },
          active: newId  // 切换到新创建的模板
        }
      });

      await loadPromptTemplates();
      toast('已创建自定义模板', 'success');
    } catch (error: any) {
      toast(`创建失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setPromptSaving(false);
    }
  };

  const handleSaveCustom = async () => {
    if (!projectId || !templatesData) return;

    const currentType = templatesData[promptTab] as TemplateTypeData;
    const activeId = currentType.active;

    // 只能保存自定义模板
    if (!activeId.startsWith('custom_') && activeId !== 'legacy') {
      toast('预设模板不可修改，请先创建自定义模板', 'info');
      return;
    }

    const updatedTemplate: TemplateData = {
      ...(activeId === 'legacy' ? currentType.custom['legacy'] : currentType.custom[activeId]),
      content: editingContent
    };

    setPromptSaving(true);
    try {
      await generationApi.updatePromptTemplates(projectId, {
        [promptTab]: {
          ...currentType,
          custom: {
            ...currentType.custom,
            [activeId]: updatedTemplate
          }
        }
      });

      await loadPromptTemplates();
      toast('已保存模板内容', 'success');
    } catch (error: any) {
      toast(`保存失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setPromptSaving(false);
    }
  };

  const handleDeleteCustom = async (templateId: string) => {
    if (!confirm('确定要删除此自定义模板吗？')) return;
    if (!projectId || !templatesData) return;

    const currentType = templatesData[promptTab] as TemplateTypeData;

    // 只能删除自定义模板
    if (!templateId.startsWith('custom_') && templateId !== 'legacy') {
      toast('预设模板不可删除', 'error');
      return;
    }

    const newCustom = { ...currentType.custom };
    delete newCustom[templateId];

    setPromptSaving(true);
    try {
      await generationApi.updatePromptTemplates(projectId, {
        [promptTab]: {
          ...currentType,
          custom: newCustom,
          active: 'default'  // 删除后切换回default
        }
      });

      await loadPromptTemplates();
      toast('已删除自定义模板', 'success');
    } catch (error: any) {
      toast(`删除失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setPromptSaving(false);
    }
  };

  const handleResetPromptTemplates = async () => {
    if (!confirm('确定要恢复默认提示词模板吗？这将删除所有自定义模板。')) return;
    if (!projectId) return;

    setPromptSaving(true);
    try {
      await generationApi.resetPromptTemplates(projectId);
      await loadPromptTemplates();
      toast('已恢复默认模板', 'success');
    } catch (error: any) {
      toast(`恢复失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setPromptSaving(false);
    }
  };

  if (!templatesData) {
    return <div className="flex items-center justify-center h-full"><div className="text-gray-400">加载中...</div></div>;
  }

  const currentType = templatesData[promptTab] as TemplateTypeData;
  const activeId = currentType?.active || 'default';
  const activeTemplate = currentType?.templates?.[activeId];
  const isPreset = activeTemplate?.is_preset !== false;

  // Tab名称映射
  const tabNames: Record<TemplateType, string> = {
    image: '资产',
    video: '视频',
    video_reverse: '反推',
    storyboard: '分镜格',
    storyboard_image: '分镜图',
    storyboard_image_edit: '分镜编辑',
    image_edit: '图片编辑',
    triple_grid: '三宫格',
    vlm: 'VLM',
    multi_scene_video: '多分镜融合',
  };

  return (
    <>
      {/* 旧格式提示 */}
      {templatesData.is_legacy && (
        <div className="px-6 py-2 bg-yellow-900 bg-opacity-20 border-b border-yellow-700">
          <p className="text-xs text-yellow-300">
            ℹ️ 检测到旧格式模板，切换或编辑后将自动升级到新版本
          </p>
        </div>
      )}

      {/* 子功能tab栏 */}
      <div className="flex border-b border-gray-700 overflow-x-auto">
        {(['image', 'video', 'video_reverse', 'storyboard', 'storyboard_image', 'storyboard_image_edit', 'image_edit', 'triple_grid', 'vlm', 'multi_scene_video'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setPromptTab(tab)}
            className={`px-4 py-3 font-medium text-sm transition whitespace-nowrap ${
              promptTab === tab
                ? 'border-b-2 border-purple-500 text-purple-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tabNames[tab]}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0 flex flex-col">
        {/* 紧凑式标签选择区 */}
        <div className="mb-4">
          <label className="text-sm text-gray-400 mb-2 block">模板:</label>
          <div className="flex gap-2 flex-wrap items-center">
            {/* 预设模板 - 蓝色边框 */}
            {Object.entries(currentType?.presets || {}).map(([id, tpl]) => (
              <button
                key={id}
                onClick={() => handleSwitchTemplate(id)}
                disabled={promptSaving}
                className={`px-3 py-1.5 rounded text-sm transition ${
                  activeId === id
                    ? 'bg-blue-600 text-white border-2 border-blue-500'
                    : 'bg-gray-800 text-gray-300 border-2 border-blue-500 border-opacity-50 hover:border-opacity-100'
                }`}
              >
                {tpl.name}
              </button>
            ))}

            {/* 自定义模板 - 紫色边框 */}
            {Object.entries(currentType?.custom || {}).map(([id, tpl]) => (
              <div key={id} className="relative group">
                <button
                  onClick={() => handleSwitchTemplate(id)}
                  disabled={promptSaving}
                  className={`px-3 py-1.5 rounded text-sm transition ${
                    activeId === id
                      ? 'bg-purple-600 text-white border-2 border-purple-500'
                      : 'bg-gray-800 text-gray-300 border-2 border-purple-500 border-opacity-50 hover:border-opacity-100'
                  }`}
                >
                  {tpl.name}
                </button>
                {/* 删除按钮（悬停显示） */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteCustom(id);
                  }}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                  title="删除"
                >
                  ×
                </button>
              </div>
            ))}

            {/* 新建按钮 */}
            <button
              onClick={handleCreateCustom}
              disabled={promptSaving}
              className="px-3 py-1.5 rounded text-sm bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
            >
              + 新建
            </button>
          </div>
        </div>

        {/* 模板信息 */}
        <div className="mb-3 p-3 bg-gray-800 bg-opacity-50 rounded border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-300">
              {activeTemplate?.name || '未知模板'}
              {isPreset ? (
                <span className="ml-2 text-xs px-2 py-0.5 bg-blue-600 bg-opacity-30 border border-blue-500 rounded">预设</span>
              ) : (
                <span className="ml-2 text-xs px-2 py-0.5 bg-purple-600 bg-opacity-30 border border-purple-500 rounded">自定义</span>
              )}
            </h3>
            {isPreset && (
              <span className="text-xs text-yellow-400">只读 - 点击"新建"以创建可编辑版本</span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {activeTemplate?.description || '暂无描述'}
          </p>
        </div>

        {/* 模板内容编辑区 */}
        <div className="flex-1 flex flex-col min-h-0">
          <textarea
            value={editingContent}
            onChange={(e) => setEditingContent(e.target.value)}
            className={`flex-1 w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm text-gray-100 font-mono resize-none ${
              isPreset ? 'opacity-60 cursor-not-allowed' : ''
            }`}
            placeholder="模板内容..."
            disabled={isPreset}
          />

          {isPreset && (
            <p className="text-xs text-yellow-400 mt-2">
              ℹ️ 预设模板不可直接修改，请点击"+ 新建"来创建可编辑的自定义版本
            </p>
          )}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="flex justify-between items-center px-4 py-3 border-t border-gray-700">
        <button
          onClick={handleResetPromptTemplates}
          className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition disabled:opacity-50"
          disabled={promptSaving}
        >
          恢复所有默认
        </button>

        {!isPreset && (
          <button
            onClick={handleSaveCustom}
            className="flex items-center gap-1 px-4 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-sm transition disabled:opacity-50"
            disabled={promptSaving}
          >
            {promptSaving ? (
              <>
                <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded"></div>
                保存中...
              </>
            ) : (
              '💾 保存当前模板'
            )}
          </button>
        )}
      </div>
    </>
  );
}
