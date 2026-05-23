import { useState, useEffect } from 'react';
import { generationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface PromptPanelProps {
  projectId: string;
}

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface TemplateData {
  name: string;
  description?: string;
  content: string;
  is_preset?: boolean;
  variables?: string[];
}

interface PromptTypeData {
  label: string;
  category: string;
  presets: Record<string, TemplateData>;
  custom: Record<string, TemplateData>;
  active: string;
  templates: Record<string, TemplateData>;
}

interface TemplatesResponse {
  [key: string]: PromptTypeData | boolean | undefined;
  is_custom: boolean;
  is_legacy?: boolean;
}

// 分类固定显示顺序
const CATEGORY_ORDER = ['生成模板', '服务提示词', '系统提示词'];

// 工具调用 schema 类模板，不向用户展示
const HIDDEN_KEYS = new Set<string>();

// 生成模板内的 key 显示顺序
const GENERATION_KEY_ORDER = [
  'image', 'video', 'storyboard', 'storyboard_image_edit',
  'nine_grid_combined_prompts', 'character_sheet', 'multi_scene_video',
  'triple_grid', 'storyboard_image', 'image_edit', 'video_reverse', 'vlm',
];

// 普通模式下默认显示的 key（其余需点"高级"展开）
const BASIC_KEYS = new Set(['image', 'video', 'storyboard_image_edit', 'storyboard', 'storyboard_image']);

// ── 主组件 ────────────────────────────────────────────────────────────────────

export function PromptPanel({ projectId }: PromptPanelProps) {
  const { toast } = useToast();
  const [templatesData, setTemplatesData] = useState<TemplatesResponse | null>(null);
  const [promptSaving, setPromptSaving] = useState(false);
  const [editingContent, setEditingContent] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 当前选中的分类、提示词 key
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [activeKey, setActiveKey] = useState<string>('');

  useEffect(() => {
    loadPromptTemplates();
  }, [projectId]);

  const loadPromptTemplates = async () => {
    if (!projectId) return;
    try {
      const response = await generationApi.getPromptTemplates(projectId);
      const data: TemplatesResponse = response.data;
      setTemplatesData(data);

      // 初始化选中（用当前 showAdvanced 状态过滤）
      const cats = getCategories(data, showAdvanced);
      if (cats.length > 0) {
        const firstCat = activeCategory && cats.includes(activeCategory) ? activeCategory : cats[0];
        const keysForCat = getKeysForCategory(data, firstCat, showAdvanced);
        const firstKey = activeKey && keysForCat.includes(activeKey) ? activeKey : keysForCat[0] ?? '';
        setActiveCategory(firstCat);
        setActiveKey(firstKey);
        initEditingContent(data, firstKey);
      }

      if (data.is_legacy) {
        toast('检测到旧格式模板，切换或编辑后将自动升级', 'info');
      }
    } catch (error) {
      console.error('Failed to load prompt templates:', error);
      toast('加载模板失败', 'error');
    }
  };

  const initEditingContent = (data: TemplatesResponse, key: string) => {
    const typeData = data[key] as PromptTypeData | undefined;
    if (typeData) {
      const activeTemplate = typeData.templates?.[typeData.active];
      setEditingContent(activeTemplate?.content ?? '');
    }
  };

  // 切换高级模式
  const handleToggleAdvanced = () => {
    if (!templatesData) return;
    const next = !showAdvanced;
    setShowAdvanced(next);
    const cats = getCategories(templatesData, next);
    const firstCat = cats[0] ?? '';
    setActiveCategory(firstCat);
    const keys = getKeysForCategory(templatesData, firstCat, next);
    const firstKey = keys[0] ?? '';
    setActiveKey(firstKey);
    initEditingContent(templatesData, firstKey);
  };

  // 切换分类
  const handleCategoryChange = (cat: string) => {
    if (!templatesData) return;
    setActiveCategory(cat);
    const keys = getKeysForCategory(templatesData, cat, showAdvanced);
    const first = keys[0] ?? '';
    setActiveKey(first);
    initEditingContent(templatesData, first);
  };

  // 切换提示词 key
  const handleKeyChange = (key: string) => {
    if (!templatesData) return;
    setActiveKey(key);
    initEditingContent(templatesData, key);
  };

  // 切换 tab 更新编辑内容
  useEffect(() => {
    if (templatesData && activeKey) {
      initEditingContent(templatesData, activeKey);
    }
  }, [activeKey, templatesData]);

  const handleSwitchTemplate = async (newActiveId: string) => {
    if (!projectId || !templatesData || !activeKey) return;
    const currentType = templatesData[activeKey] as PromptTypeData;
    setPromptSaving(true);
    try {
      await generationApi.updatePromptTemplates(projectId, {
        [activeKey]: { ...currentType, active: newActiveId },
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
    if (!projectId || !templatesData || !activeKey) return;
    const currentType = templatesData[activeKey] as PromptTypeData;
    const customCount = Object.keys(currentType.custom || {}).length;
    const newId = `custom_${Date.now()}`;
    const currentActive = currentType.templates?.[currentType.active];
    const newTemplate: TemplateData = {
      name: `自定义${customCount + 1}`,
      description: `基于 "${currentActive?.name || '默认'}" 创建`,
      content: editingContent || currentActive?.content || '',
      is_preset: false,
    };
    setPromptSaving(true);
    try {
      await generationApi.updatePromptTemplates(projectId, {
        [activeKey]: {
          ...currentType,
          custom: { ...currentType.custom, [newId]: newTemplate },
          active: newId,
        },
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
    if (!projectId || !templatesData || !activeKey) return;
    const currentType = templatesData[activeKey] as PromptTypeData;
    const activeId = currentType.active;
    if (!activeId.startsWith('custom_') && activeId !== 'legacy') {
      toast('预设模板不可修改，请先创建自定义模板', 'info');
      return;
    }
    const updatedTemplate: TemplateData = {
      ...(currentType.custom[activeId] ?? currentType.custom['legacy']),
      content: editingContent,
    };
    setPromptSaving(true);
    try {
      await generationApi.updatePromptTemplates(projectId, {
        [activeKey]: {
          ...currentType,
          custom: { ...currentType.custom, [activeId]: updatedTemplate },
        },
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
    if (!projectId || !templatesData || !activeKey) return;
    const currentType = templatesData[activeKey] as PromptTypeData;
    if (!templateId.startsWith('custom_') && templateId !== 'legacy') {
      toast('预设模板不可删除', 'error');
      return;
    }
    const newCustom = { ...currentType.custom };
    delete newCustom[templateId];
    setPromptSaving(true);
    try {
      await generationApi.updatePromptTemplates(projectId, {
        [activeKey]: { ...currentType, custom: newCustom, active: 'default_ai' },
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

  const categories = getCategories(templatesData, showAdvanced);
  const keysForCategory = getKeysForCategory(templatesData, activeCategory, showAdvanced);
  const currentType = activeKey ? (templatesData[activeKey] as PromptTypeData) : null;
  const activeId = currentType?.active ?? 'default_ai';
  const activeTemplate = currentType?.templates?.[activeId];
  const isPreset = activeTemplate?.is_preset !== false;

  // 二级 tab 样式
  const subTabClass = (active: boolean) =>
    `px-3 py-2 font-medium text-xs transition whitespace-nowrap ${
      active ? 'border-b-2 border-purple-500 text-purple-400' : 'text-gray-400 hover:text-white'
    }`;

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

      {/* 一级 Tab：分类 + 高级按钮 */}
      <div className="flex items-center border-b border-gray-700 shrink-0 px-4 pt-2 gap-1">
        <div className="flex gap-1 flex-1">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => handleCategoryChange(cat)}
              className={`px-3 py-1.5 text-sm rounded-t ${
                activeCategory === cat ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <button
          onClick={handleToggleAdvanced}
          className={`px-2 py-1 text-xs rounded transition mb-0.5 ${
            showAdvanced
              ? 'text-purple-400 hover:text-purple-300'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          {showAdvanced ? '收起 ▴' : '高级 ▾'}
        </button>
      </div>

      {/* 二级 Tab：该分类下的提示词 */}
      <div className="flex border-b border-gray-700 overflow-x-auto shrink-0">
        {keysForCategory.map(key => (
          <button
            key={key}
            onClick={() => handleKeyChange(key)}
            className={subTabClass(activeKey === key)}
          >
            {(templatesData[key] as PromptTypeData)?.label ?? key}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0 flex flex-col">
        {/* 模板选择 */}
        {currentType && (
          <div className="mb-4">
            <label className="text-sm text-gray-400 mb-2 block">模板:</label>
            <div className="flex gap-2 flex-wrap items-center">
              {/* 预设模板 - 蓝色边框 */}
              {Object.entries(currentType.presets || {}).map(([id, tpl]) => (
                <button
                  key={id}
                  onClick={() => handleSwitchTemplate(id)}
                  disabled={promptSaving}
                  className={`px-3 py-1.5 rounded text-sm transition ${
                    activeId === id
                      ? 'bg-blue-600 text-white border-2 border-blue-500'
                      : 'bg-gray-800 text-gray-300 border-2 border-blue-500/50 hover:border-blue-500'
                  }`}
                >
                  {tpl.name}
                </button>
              ))}

              {/* 自定义模板 - 紫色边框 */}
              {Object.entries(currentType.custom || {}).map(([id, tpl]) => (
                <div key={id} className="relative group">
                  <button
                    onClick={() => handleSwitchTemplate(id)}
                    disabled={promptSaving}
                    className={`px-3 py-1.5 rounded text-sm transition ${
                      activeId === id
                        ? 'bg-purple-600 text-white border-2 border-purple-500'
                        : 'bg-gray-800 text-gray-300 border-2 border-purple-500/50 hover:border-purple-500'
                    }`}
                  >
                    {tpl.name}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteCustom(id); }}
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
        )}

        {/* 模板信息 */}
        {currentType && (
          <div className="mb-3 p-3 bg-gray-100 dark:bg-gray-800/50 rounded border border-gray-300 dark:border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {activeTemplate?.name || '未知模板'}
                {isPreset ? (
                  <span className="ml-2 text-xs px-2 py-0.5 bg-blue-600/30 border border-blue-500 rounded">预设</span>
                ) : (
                  <span className="ml-2 text-xs px-2 py-0.5 bg-purple-600/30 border border-purple-500 rounded">自定义</span>
                )}
              </h3>
              {isPreset && (
                <span className="text-xs text-orange-600 dark:text-yellow-400">只读 - 点击"新建"以创建可编辑版本</span>
              )}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400">{activeTemplate?.description || '暂无描述'}</p>
          </div>
        )}

        {/* 模板内容编辑区 */}
        <div className="flex-1 flex flex-col min-h-0">
          <textarea
            value={editingContent}
            onChange={e => setEditingContent(e.target.value)}
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
                <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded" />
                保存中...
              </>
            ) : (
              '保存当前模板'
            )}
          </button>
        )}
      </div>
    </>
  );
}

// ── 工具函数（模块级，供组件调用）────────────────────────────────────────────

function getCategories(data: TemplatesResponse, showAdvanced: boolean): string[] {
  if (!showAdvanced) return ['生成模板'];
  const found = new Set<string>();
  for (const [key, val] of Object.entries(data)) {
    if (key === 'is_custom' || key === 'is_legacy') continue;
    if (val && typeof val === 'object' && 'category' in val) {
      found.add((val as PromptTypeData).category);
    }
  }
  return CATEGORY_ORDER.filter(c => found.has(c));
}

function getKeysForCategory(data: TemplatesResponse, category: string, showAdvanced: boolean): string[] {
  // 非高级模式下，只显示生成模板分类中的 BASIC_KEYS
  const keys = Object.entries(data)
    .filter(([key, val]) => {
      if (key === 'is_custom' || key === 'is_legacy') return false;
      if (HIDDEN_KEYS.has(key)) return false;
      if (!showAdvanced && category === '生成模板' && !BASIC_KEYS.has(key)) return false;
      return val && typeof val === 'object' && (val as PromptTypeData).category === category;
    })
    .map(([key]) => key);

  if (category === '生成模板') {
    return keys.sort((a, b) => {
      const ai = GENERATION_KEY_ORDER.indexOf(a);
      const bi = GENERATION_KEY_ORDER.indexOf(b);
      const aIdx = ai === -1 ? Infinity : ai;
      const bIdx = bi === -1 ? Infinity : bi;
      return aIdx - bIdx;
    });
  }
  return keys;
}
