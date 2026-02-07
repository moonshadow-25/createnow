import { useState, useEffect } from 'react';
import { generationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface PromptPanelProps {
  projectId: string;
}

export function PromptPanel({ projectId }: PromptPanelProps) {
  const { toast } = useToast();
  const [promptTab, setPromptTab] = useState<'image' | 'video' | 'video_reverse' | 'storyboard' | 'storyboard_image' | 'storyboard_image_edit' | 'image_edit' | 'triple_grid' | 'vlm'>('image');
  const [promptTemplates, setPromptTemplates] = useState({
    image: '',
    video: '',
    video_reverse: '',
    storyboard: '',
    storyboard_image: '',
    storyboard_image_edit: '',
    image_edit: '',
    triple_grid: '',
    vlm: '',
  });
  const [promptSaving, setPromptSaving] = useState(false);
  const [isCustom, setIsCustom] = useState(false);

  useEffect(() => {
    loadPromptTemplates();
  }, [projectId]);

  const loadPromptTemplates = async () => {
    if (!projectId) return;
    try {
      const response = await generationApi.getPromptTemplates(projectId);
      setPromptTemplates({
        image: response.data.image_prompt_template || '',
        video: response.data.video_prompt_template || '',
        video_reverse: response.data.video_reverse_prompt_template || '',
        storyboard: response.data.storyboard_generation_prompt_template || '',
        storyboard_image: response.data.storyboard_image_prompt_template || '',
        storyboard_image_edit: response.data.storyboard_image_edit_prompt_template || '',
        image_edit: response.data.image_edit_prompt_template || '',
        triple_grid: response.data.triple_grid_prompt_template || '',
        vlm: response.data.vlm_prompt_template || '',
      });
      setIsCustom(response.data.is_custom || false);
    } catch (error) {
      console.error('Failed to load prompt templates:', error);
    }
  };

  const handleSavePromptTemplates = async () => {
    if (!projectId) return;
    setPromptSaving(true);
    try {
      await generationApi.updatePromptTemplates(projectId, {
        image_prompt_template: promptTemplates.image,
        video_prompt_template: promptTemplates.video,
        video_reverse_prompt_template: promptTemplates.video_reverse,
        storyboard_generation_prompt_template: promptTemplates.storyboard,
        storyboard_image_prompt_template: promptTemplates.storyboard_image,
        storyboard_image_edit_prompt_template: promptTemplates.storyboard_image_edit,
        image_edit_prompt_template: promptTemplates.image_edit,
        triple_grid_prompt_template: promptTemplates.triple_grid,
        vlm_prompt_template: promptTemplates.vlm,
      });
      setIsCustom(true);
      toast('提示词模板已保存', 'success');
    } catch (error: any) {
      toast(`保存失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setPromptSaving(false);
    }
  };

  const handleResetPromptTemplates = async () => {
    if (!confirm('确定要恢复默认提示词模板吗？这将覆盖您当前的自定义模板。')) return;
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

  const tabInfo = {
    image: {
      label: '图片提示词',
      description: '此模板用于教AI如何根据角色/场景/道具的描述来生成生图提示词。',
      variables: "可用变量：{asset_type} - 资产类型, {description} - 资产描述",
      value: promptTemplates.image,
      onChange: (v: string) => setPromptTemplates({ ...promptTemplates, image: v }),
    },
    video: {
      label: '视频提示词',
      description: '此模板用于教AI如何根据分镜描述来生成视频提示词。',
      variables: "可用变量：{description} - 描述, {characters} - 角色, {scene} - 场景, {props} - 道具",
      value: promptTemplates.video,
      onChange: (v: string) => setPromptTemplates({ ...promptTemplates, video: v }),
    },
    video_reverse: {
      label: '视频反推',
      description: '此模板用于教VLM如何根据分镜图片反推视频提示词。需要配置VLM（视觉模型）才能使用。',
      variables: "可用变量：{description} - 描述, {characters} - 角色, {scene} - 场景, {props} - 道具, {camera_movement} - 运镜, {duration} - 时长",
      value: promptTemplates.video_reverse,
      onChange: (v: string) => setPromptTemplates({ ...promptTemplates, video_reverse: v }),
    },
    storyboard: {
      label: '分镜生成',
      description: '此模板用于教AI如何根据剧本内容批量生成分镜描述。',
      variables: "可用变量：{script} - 剧本内容",
      value: promptTemplates.storyboard,
      onChange: (v: string) => setPromptTemplates({ ...promptTemplates, storyboard: v }),
    },
    storyboard_image: {
      label: '分镜转图片',
      description: '此模板用于教AI如何根据分镜描述生成用于生图的提示词。',
      variables: "可用变量：{description} - 分镜描述, {shot_type} - 镜头类型",
      value: promptTemplates.storyboard_image,
      onChange: (v: string) => setPromptTemplates({ ...promptTemplates, storyboard_image: v }),
    },
    storyboard_image_edit: {
      label: '分镜图生图',
      description: '此模板用于图生图模式，当用户选择了角色/场景/道具资产时，AI会根据参考图像生成分镜画面。',
      variables: "可用变量：{description} - 包含[Reference Images]和[Storyboard Description]的完整描述, {shot_type} - 镜头类型, {action} - 动作, {camera_angle} - 镜头角度",
      value: promptTemplates.storyboard_image_edit,
      onChange: (v: string) => setPromptTemplates({ ...promptTemplates, storyboard_image_edit: v }),
    },
    image_edit: {
      label: '图片编辑',
      description: '此模板用于教AI如何生成图像编辑提示词，用于基于主角色图片生成子角色的变体形象。',
      variables: "可用变量：{parent_name} - 主角色名称, {child_name} - 子角色名称",
      value: promptTemplates.image_edit,
      onChange: (v: string) => setPromptTemplates({ ...promptTemplates, image_edit: v }),
    },
    triple_grid: {
      label: '三宫格',
      description: '此模板用于教AI如何拆解三宫格图片，识别并分离左中右三个分镜。',
      variables: "可用变量：{storyboard_id} - 分镜ID",
      value: promptTemplates.triple_grid,
      onChange: (v: string) => setPromptTemplates({ ...promptTemplates, triple_grid: v }),
    },
    vlm: {
      label: 'VLM',
      description: '此模板用于VLM图片分析。系统会将用户目标填充到{user_goal}占位符中。需要配置VLM（视觉模型）才能使用。',
      variables: "可用变量：{user_goal} - 用户的分析目标（例如：生成中间过渡帧、融合多张图片等）",
      value: promptTemplates.vlm,
      onChange: (v: string) => setPromptTemplates({ ...promptTemplates, vlm: v }),
    },
  };

  const currentTab = tabInfo[promptTab];

  return (
    <>
      {/* 自定义提示 */}
      {isCustom && (
        <div className="px-6 py-2 bg-blue-900 bg-opacity-20 border-b border-blue-700">
          <p className="text-xs text-blue-300">
            ℹ️ 当前使用的是自定义提示词模板。您可以继续编辑或恢复为默认模板。
          </p>
        </div>
      )}

      {/* 子功能tab栏 */}
      <div className="flex border-b border-gray-700 overflow-x-auto">
        {(['image', 'video', 'video_reverse', 'storyboard', 'storyboard_image', 'storyboard_image_edit', 'image_edit', 'triple_grid', 'vlm'] as const).map((tab) => {
          // 简化的tab名称映射
          const tabNames = {
            image: '资产',
            video: '视频',
            video_reverse: '反推',
            storyboard: '分镜格',
            storyboard_image: '分镜图',
            storyboard_image_edit: '分镜编辑',
            image_edit: '图片编辑',
            triple_grid: '三宫格',
            vlm: 'VLM',
          };

          return (
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
          );
        })}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-400 mb-3">{currentTab.description}</p>
            <p className="text-xs text-gray-500 mb-3">{currentTab.variables}</p>
            <textarea
              value={currentTab.value}
              onChange={(e) => currentTab.onChange(e.target.value)}
              className="w-full h-72 bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm text-gray-100 font-mono resize-y"
              placeholder={`输入${currentTab.label}生成模板...`}
            />
          </div>
        </div>
      </div>

      {/* 底部操作栏 - 恢复默认按钮 */}
      <div className="flex justify-between items-center px-4 py-3 border-t border-gray-700">
        <button
          onClick={handleResetPromptTemplates}
          className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
          disabled={promptSaving}
        >
          恢复默认
        </button>
        <button
          onClick={handleSavePromptTemplates}
          className="flex items-center gap-1 px-4 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-sm transition"
          disabled={promptSaving}
        >
          {promptSaving ? (
            <>
              <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded"></div>
              保存中...
            </>
          ) : (
            '保存模板'
          )}
        </button>
      </div>
    </>
  );
}
