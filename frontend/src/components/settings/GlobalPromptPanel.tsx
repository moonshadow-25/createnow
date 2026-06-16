import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RotateCcw, Save } from 'lucide-react';
import { globalPromptApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface PresetData {
  name: string;
  description?: string;
  variables?: string[];
  content: string;
}

interface PromptEntry {
  label: string;
  category: string;
  presets: Record<string, PresetData>;
}

type PromptsData = Record<string, PromptEntry>;

// 生成模板：默认只显示龙虾对话调用的，其余点"高级"展开
const GENERATION_KEY_ORDER = [
  'image', 'video', 'storyboard', 'storyboard_image_edit', 'storyboard_image',
  'nine_grid_combined_prompts', 'character_sheet', 'multi_scene_video',
  'triple_grid', 'image_edit', 'video_reverse', 'vlm',
];

const BASIC_KEYS = new Set([
  'image', 'video', 'storyboard_image_edit',
]);

// 服务提示词：只显示用户需要编辑的服务模板
const SERVICE_KEYS = new Set([
  'full_script_split_chunk',
  'full_script_split_chunk_boundary',
  'full_script_extract_chunk',
  'full_script_extract_merge',
  'material_look',
  'material_node',
]);

// ── 组件 ──────────────────────────────────────────────────────────────────────

export function GlobalPromptPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [data, setData] = useState<PromptsData | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 当前选中的 category tab
  const [activeCategory, setActiveCategory] = useState<string>('');
  // 当前选中的提示词 key
  const [activeKey, setActiveKey] = useState<string>('');
  // 当前选中的 preset id（用于多 preset 的生成模板）
  const [activePreset, setActivePreset] = useState<string>('default');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await globalPromptApi.get();
      const prompts: PromptsData = res.data;
      setData(prompts);

      // 初始化选中状态
      const categories = getCategories(prompts);
      if (categories.length > 0 && !activeCategory) {
        const firstCat = categories[0];
        setActiveCategory(firstCat);
        const keys = getKeysForCategory(prompts, firstCat, showAdvanced);
        const firstKey = keys[0] ?? '';
        setActiveKey(firstKey);
        setActivePreset(Object.keys(prompts[firstKey]?.presets ?? {})[0] ?? 'default');
      }
    } catch {
      toast('加载全局提示词失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // 切换高级模式时，若当前 key 不在过滤后的列表中，重置为第一个
  useEffect(() => {
    if (!data) return;
    const keys = getKeysForCategory(data, activeCategory, showAdvanced);
    if (activeKey && !keys.includes(activeKey)) {
      const first = keys[0] ?? '';
      setActiveKey(first);
      setActivePreset(Object.keys(data[first]?.presets ?? {})[0] ?? 'default');
    }
  }, [showAdvanced]);

  // 工具函数：从 data 中提取分类列表（按固定顺序）
  const getCategories = (prompts: PromptsData): string[] => {
    const order = ['生成模板', '服务提示词', '系统提示词'];
    const found = new Set(Object.values(prompts).map(p => p.category));
    return order.filter(c => found.has(c));
  };

  // 工具函数：某分类下的所有 key
  const getKeysForCategory = (prompts: PromptsData, category: string, advanced: boolean = false): string[] => {
    let keys = Object.entries(prompts)
      .filter(([, v]) => v.category === category)
      .map(([k]) => k);
    if (category === '生成模板') {
      const filtered = advanced ? keys : keys.filter(k => BASIC_KEYS.has(k));
      return filtered.sort((a, b) => {
        const ai = GENERATION_KEY_ORDER.indexOf(a);
        const bi = GENERATION_KEY_ORDER.indexOf(b);
        return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
      });
    }
    if (category === '服务提示词') {
      keys = keys.filter(k => SERVICE_KEYS.has(k));
    }
    return keys;
  };

  // 切换 category
  const handleCategoryChange = (cat: string) => {
    if (!data) return;
    setActiveCategory(cat);
    const keys = getKeysForCategory(data, cat, showAdvanced);
    const first = keys[0] ?? '';
    setActiveKey(first);
    setActivePreset(Object.keys(data[first]?.presets ?? {})[0] ?? 'default');
  };

  // 切换 key
  const handleKeyChange = (key: string) => {
    if (!data) return;
    setActiveKey(key);
    setActivePreset(Object.keys(data[key]?.presets ?? {})[0] ?? 'default');
  };

  // 编辑内容
  const handleContentChange = (content: string) => {
    if (!data || !activeKey || !activePreset) return;
    setData({
      ...data,
      [activeKey]: {
        ...data[activeKey],
        presets: {
          ...data[activeKey].presets,
          [activePreset]: {
            ...data[activeKey].presets[activePreset],
            content,
          },
        },
      },
    });
  };

  // 保存
  const handleSave = async () => {
    if (!data || !activeKey) return;
    setSaving(true);
    try {
      await globalPromptApi.update({
        [activeKey]: {
          presets: {
            [activePreset]: { content: data[activeKey].presets[activePreset]?.content ?? '' },
          },
        },
      });
      toast('已保存', 'success');
    } catch {
      toast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  // 重置
  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await globalPromptApi.reset();
      setData(res.data);
      setShowResetConfirm(false);
      toast('已恢复全部默认值', 'success');
    } catch {
      toast('重置失败', 'error');
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-gray-400 text-sm">加载中...</div>;
  }
  if (!data) return null;

  const categories = getCategories(data);
  const keysForCategory = getKeysForCategory(data, activeCategory, showAdvanced);
  const currentEntry = data[activeKey];
  const presetIds = currentEntry ? Object.keys(currentEntry.presets) : [];
  const currentContent = currentEntry?.presets[activePreset]?.content ?? '';

  // 二级 tab 样式
  const subTabClass = (active: boolean) =>
    `px-3 py-2 font-medium text-sm transition whitespace-nowrap ${
      active ? 'border-b-2 border-purple-500 text-purple-400' : 'text-gray-400 hover:text-white'
    }`;

  return (
    <div className="flex flex-col h-full">
      {/* 警示栏 */}
      <div className="flex items-center gap-2 px-4 py-2 bg-yellow-900/30 border-b border-yellow-700/40 text-yellow-300 text-xs shrink-0">
        <AlertTriangle size={14} />
        修改此处将影响所有项目的出厂默认值，请谨慎操作
      </div>

      {/* 一级 Tab：分类 + 高级按钮 */}
      <div className="flex items-center border-b border-gray-700 shrink-0 px-4 pt-3 gap-1">
        <div className="flex gap-1 flex-1">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => handleCategoryChange(cat)}
              className={`px-3 py-1.5 text-sm rounded-t ${
                activeCategory === cat ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
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
            {data[key]?.label ?? key}
          </button>
        ))}
      </div>

      {/* 三级 Tab：preset 选择（仅多 preset 时显示） */}
      {presetIds.length > 1 && (
        <div className="flex gap-2 flex-wrap items-center px-4 pt-3 pb-2 shrink-0">
          <label className="text-sm text-gray-400">模板:</label>
          {presetIds.map(id => (
            <button
              key={id}
              onClick={() => setActivePreset(id)}
              className={`px-3 py-1.5 rounded text-sm transition ${
                activePreset === id
                  ? 'bg-blue-600 text-white border-2 border-blue-500'
                  : 'bg-gray-800 text-gray-300 border-2 border-blue-500/50 hover:border-blue-500'
              }`}
            >
              {currentEntry?.presets[id]?.name ?? id}
            </button>
          ))}
        </div>
      )}

      {/* 模板信息 */}
      {currentEntry && (
        <div className="mx-4 mt-3 mb-2 p-3 bg-gray-800/50 rounded border border-gray-700 shrink-0">
          <div className="text-sm font-medium text-gray-300">
            {currentEntry.label}
            {presetIds.length > 1 && (
              <span className="ml-2 text-xs text-gray-500">
                · {currentEntry.presets[activePreset]?.name ?? activePreset}
              </span>
            )}
            <span className="ml-2 text-xs px-2 py-0.5 bg-blue-600/30 border border-blue-500 rounded">预设</span>
          </div>
          {currentEntry.presets[activePreset]?.description && (
            <p className="text-xs text-gray-500 mt-1">{currentEntry.presets[activePreset].description}</p>
          )}
        </div>
      )}

      {/* 编辑区 */}
      <div className="flex-1 flex flex-col px-4 pb-2 min-h-0">
        <textarea
          key={`${activeKey}-${activePreset}`}
          value={currentContent}
          onChange={e => handleContentChange(e.target.value)}
          className="flex-1 w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm text-gray-100 font-mono resize-none focus:outline-none focus:border-purple-500"
          placeholder="模板内容..."
        />
      </div>

      {/* 底部操作 */}
      <div className="flex justify-between items-center px-4 py-3 border-t border-gray-700 shrink-0">
        {showResetConfirm ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-yellow-400">确认恢复所有默认值？</span>
            <button onClick={() => setShowResetConfirm(false)} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded">取消</button>
            <button onClick={handleReset} disabled={resetting} className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded">
              {resetting ? '重置中...' : '确认重置'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
          >
            <RotateCcw size={14} />恢复全部默认
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded text-sm"
        >
          <Save size={14} />{saving ? '保存中...' : '保存当前模板'}
        </button>
      </div>
    </div>
  );
}
