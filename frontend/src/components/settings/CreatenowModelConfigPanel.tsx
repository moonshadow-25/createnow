import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import {
  useCreatenowModelConfigStore,
  type CreatenowModelConfig,
  type CreatenowServiceType,
} from '@/store/createnowModelConfigStore';

const SERVICE_LABELS: Record<CreatenowServiceType, string> = {
  llm: 'LLM',
  vlm: 'VLM',
  image: '图片',
  video: '视频',
  tts: 'TTS',
};

const SERVICE_TYPES: CreatenowServiceType[] = ['llm', 'vlm', 'image', 'video', 'tts'];

function cloneConfig(config: CreatenowModelConfig): CreatenowModelConfig {
  return {
    suggestions: {
      llm: config.suggestions.llm.map(item => ({ ...item })),
      vlm: config.suggestions.vlm.map(item => ({ ...item })),
      image: config.suggestions.image.map(item => ({ ...item })),
      video: config.suggestions.video.map(item => ({ ...item })),
      tts: config.suggestions.tts.map(item => ({ ...item })),
    },
    default_models: { ...config.default_models },
  };
}

export function CreatenowModelConfigPanel() {
  const { toast } = useToast();
  const config = useCreatenowModelConfigStore(state => state.config);
  const fetchConfig = useCreatenowModelConfigStore(state => state.fetchConfig);
  const saveConfig = useCreatenowModelConfigStore(state => state.saveConfig);
  const [draft, setDraft] = useState<CreatenowModelConfig>(() => cloneConfig(config));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    setDraft(cloneConfig(config));
  }, [config]);

  const updateDefaultModel = (type: CreatenowServiceType, model: string) => {
    setDraft(prev => ({
      ...prev,
      default_models: { ...prev.default_models, [type]: model },
    }));
  };

  const updateSuggestion = (type: CreatenowServiceType, index: number, field: 'label' | 'model', value: string) => {
    setDraft(prev => ({
      ...prev,
      suggestions: {
        ...prev.suggestions,
        [type]: prev.suggestions[type].map((item, i) => i === index ? { ...item, [field]: value } : item),
      },
    }));
  };

  const addSuggestion = (type: CreatenowServiceType) => {
    setDraft(prev => ({
      ...prev,
      suggestions: {
        ...prev.suggestions,
        [type]: [...prev.suggestions[type], { label: '', model: '' }],
      },
    }));
  };

  const removeSuggestion = (type: CreatenowServiceType, index: number) => {
    setDraft(prev => ({
      ...prev,
      suggestions: {
        ...prev.suggestions,
        [type]: prev.suggestions[type].filter((_, i) => i !== index),
      },
    }));
  };

  const handleSave = async () => {
    for (const type of SERVICE_TYPES) {
      if (!draft.default_models[type].trim()) {
        toast(`${SERVICE_LABELS[type]} 默认模型不能为空`, 'error');
        return;
      }
    }

    setSaving(true);
    try {
      await saveConfig(draft);
      toast('模型标签配置已保存', 'success');
    } catch (error: any) {
      toast(error?.response?.data?.detail || '保存模型标签失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 text-sm text-blue-200">
        这些标签会同时用于 API 设置中的快捷填写和广场生成模型下拉；默认模型会用于之后新建项目的 CreateNow 配置。
      </div>

      {SERVICE_TYPES.map(type => (
        <section key={type} className="bg-gray-900/60 border border-gray-700 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-white">{SERVICE_LABELS[type]}</h3>
            <button
              type="button"
              onClick={() => addSuggestion(type)}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              <Plus size={14} />
              添加标签
            </button>
          </div>

          <label className="block">
            <span className="block text-xs text-gray-400 mb-1">新建项目默认模型</span>
            <input
              value={draft.default_models[type]}
              onChange={(e) => updateDefaultModel(type, e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="例如 nova-pro"
            />
          </label>

          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_40px] gap-2 text-xs text-gray-500 px-1">
              <span>显示标签</span>
              <span>实际模型名</span>
              <span></span>
            </div>
            {draft.suggestions[type].length === 0 ? (
              <div className="text-sm text-gray-500 border border-dashed border-gray-700 rounded p-3">暂无快捷标签</div>
            ) : draft.suggestions[type].map((item, index) => (
              <div key={`${type}-${index}`} className="grid grid-cols-[1fr_1fr_40px] gap-2">
                <input
                  value={item.label}
                  onChange={(e) => updateSuggestion(type, index, 'label', e.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="例如 sd2"
                />
                <input
                  value={item.model}
                  onChange={(e) => updateSuggestion(type, index, 'model', e.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="例如 nova-pro"
                />
                <button
                  type="button"
                  onClick={() => removeSuggestion(type, index)}
                  className="flex items-center justify-center rounded bg-gray-800 hover:bg-red-900/50 text-gray-400 hover:text-red-200"
                  title="删除标签"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-0 bg-gray-800 border-t border-gray-700 py-4 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded text-sm"
        >
          <Save size={15} />
          {saving ? '保存中...' : '保存模型标签'}
        </button>
      </div>
    </div>
  );
}
