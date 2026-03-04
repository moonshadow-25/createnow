import { useState, useEffect } from 'react';
import { X, Sparkles, Wand2, Zap, Plus, Layers, Grid, Film, Download } from 'lucide-react';
import { generationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface StoryboardPromptDialogProps {
  isOpen: boolean;
  type: 'insert' | 'inbetween' | 'multi_fusion' | 'first_last_video' | 'multi_scene_video';
  selectedStoryboards: any[];
  projectId: string;
  onConfirm: (prompt: string) => void;
  onClose: () => void;
}

// 预设的VLM分析目标
const VLM_GOALS = {
  insert: "请分析这张分镜图片，为紧接着的下一个分镜生成创意描述（延续当前画面的故事发展）",
  inbetween: "请分析这两张分镜图片，生成中间过渡帧的详细描述（确保动作流畅、画面自然衔接）",
  multi_fusion: "请分析这些分镜图片，生成一个融合所有元素的场景描述（将这些角色、场景、道具融合在同一个画面中）",
  first_last_video: "请分析首帧和尾帧图片，生成视频运动的详细描述（描述从首帧到尾帧的运动过程、镜头变化）",
  multi_scene_video: "请分析这些分镜图片，为每个分镜生成视频运动描述，形成连贯的多分镜视频（每个分镜单独描述其运动过程和时长）"
};

export function StoryboardPromptDialog({
  isOpen,
  type,
  selectedStoryboards,
  projectId,
  onConfirm,
  onClose
}: StoryboardPromptDialogProps) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // 打开对话框时，预填充"目标"或默认提示词
  useEffect(() => {
    if (isOpen) {
      if (type === 'multi_scene_video') {
        // 为多分镜视频生成特殊的默认提示词
        const defaultPrompt = selectedStoryboards
          .map((sb, index) => {
            const duration = sb.duration || 3;
            const videoPrompt = sb.video_prompt || sb.description || `分镜${index + 1}`;
            let line = `分镜${index + 1}：（时长${duration}秒）${videoPrompt}`;
            if (sb.dialogue) line += `；对白：${sb.dialogue}`;
            if (sb.shot_type) line += `；镜头：${sb.shot_type}`;
            if (sb.camera_angle) line += `；角度：${sb.camera_angle}`;
            if (sb.action) line += `；动作：${sb.action}`;
            return line;
          })
          .join('；\n');
        setPrompt(defaultPrompt);
      } else {
        const goal = VLM_GOALS[type];
        setPrompt(goal);
      }
    } else {
      // 关闭时清空
      setPrompt('');
      setIsAnalyzing(false);
    }
  }, [isOpen, type, selectedStoryboards]);

  // 动态配置
  const config = {
    insert: {
      title: '插入分镜',
      icon: <Plus size={20} />,
      color: 'blue',
      info: `将在分镜 ${selectedStoryboards[0]?.sequence} 之后插入新分镜`
    },
    inbetween: {
      title: '插入中间分镜',
      icon: <Layers size={20} />,
      color: 'purple',
      info: `在分镜 ${selectedStoryboards[0]?.sequence} 和 ${selectedStoryboards[1]?.sequence} 之间插入过渡分镜`
    },
    multi_fusion: {
      title: '多图融合',
      icon: <Grid size={20} />,
      color: 'orange',
      info: `将使用 ${selectedStoryboards.length} 张图片进行融合（分镜 ${selectedStoryboards.map(sb => sb.sequence).join(', ')}）`
    },
    first_last_video: {
      title: '插入首尾帧视频',
      icon: <Film size={20} />,
      color: 'green',
      info: `首帧（分镜 ${selectedStoryboards[0]?.sequence}） → 尾帧（分镜 ${selectedStoryboards[1]?.sequence}）`
    },
    multi_scene_video: {
      title: '多分镜视频',
      icon: <Film size={20} />,
      color: 'indigo',
      info: `将 ${selectedStoryboards.length} 个分镜合成为连续视频（分镜 ${selectedStoryboards.map(sb => sb.sequence).join(', ')}）`
    }
  }[type];

  // 按钮1：AI生成提示词（分析 → 显示 → 不执行）
  const handleAIGenerate = async () => {
    if (type === 'multi_scene_video') {
      // 多分镜融合视频：使用LLM生成
      setIsAnalyzing(true);
      try {
        const response = await generationApi.generateMultiSceneVideoPrompt(
          projectId,
          selectedStoryboards.map(sb => sb.asset_id)
        );

        // 将结果填充到输入框
        setPrompt(response.data.prompt);
        toast('AI提示词已生成，您可以修改后再生成', 'success');
      } catch (error: any) {
        console.error('AI生成提示词失败:', error);
        toast(`AI生成提示词失败: ${error.response?.data?.detail || error.message}`, 'error');
      } finally {
        setIsAnalyzing(false);
      }
    } else {
      // 其他类型：使用VLM分析图片
      // 检查是否所有分镜都有主图
      const missingImages = selectedStoryboards.filter(sb => !sb.image_id);
      if (missingImages.length > 0) {
        toast('选中的分镜必须都有主图才能进行AI分析', 'error');
        return;
      }

      setIsAnalyzing(true);
      try {
        const imageIds = selectedStoryboards.map(sb => sb.image_id);
        const response = await generationApi.analyzeWithVLM(projectId, {
          image_ids: imageIds,
          user_goal: prompt,
          descriptions: selectedStoryboards.map(sb => sb.description || ''),
          shot_types: selectedStoryboards.map(sb => sb.shot_type || ''),
          camera_angles: selectedStoryboards.map(sb => sb.camera_angle || ''),
          actions: selectedStoryboards.map(sb => sb.action || ''),
          dialogues: selectedStoryboards.map(sb => sb.dialogue || ''),
        });

        // 将结果填充到输入框
        setPrompt(response.data.prompt);
        toast('AI提示词已生成，您可以修改后再生成', 'success');
      } catch (error: any) {
        console.error('AI分析失败:', error);
        toast(`AI分析失败: ${error.response?.data?.detail || error.message}`, 'error');
      } finally {
        setIsAnalyzing(false);
      }
    }
  };

  // 按钮2：直接生成（使用输入框内容）
  const handleDirectGenerate = () => {
    if (!prompt.trim()) {
      toast('请输入提示词或点击AI生成', 'error');
      return;
    }

    // 立即调用父组件，不设置本地状态
    onConfirm(prompt.trim());
  };

  // 按钮3：智能生成（VLM分析 → 直接执行）
  const handleSmartGenerate = () => {
    // 检查是否所有分镜都有主图
    const missingImages = selectedStoryboards.filter(sb => !sb.image_id);
    if (missingImages.length > 0) {
      toast('选中的分镜必须都有主图才能进行智能生成', 'error');
      return;
    }

    // 立即调用 onConfirm，传递 VLM 参数的 JSON 字符串
    const vlmParams = {
      __needVLM: true,
      userGoal: prompt.trim(),
      imageIds: selectedStoryboards.map(sb => sb.image_id),
      descriptions: selectedStoryboards.map(sb => sb.description || ''),
      shot_types: selectedStoryboards.map(sb => sb.shot_type || ''),
      camera_angles: selectedStoryboards.map(sb => sb.camera_angle || ''),
      actions: selectedStoryboards.map(sb => sb.action || ''),
      dialogues: selectedStoryboards.map(sb => sb.dialogue || ''),
    };

    onConfirm(JSON.stringify(vlmParams));
  };

  // 按钮4：导出分镜图和提示词
  const handleExport = async () => {
    // 检查是否有分镜选中
    if (selectedStoryboards.length === 0) {
      toast('没有选中的分镜', 'error');
      return;
    }

    setIsExporting(true);
    try {
      const storyboardIds = selectedStoryboards.map(sb => sb.asset_id);
      const response = await generationApi.exportStoryboards(projectId, storyboardIds, prompt);

      // 复制提示词到剪贴板
      if (navigator.clipboard && response.data.prompt) {
        await navigator.clipboard.writeText(response.data.prompt);
        toast(`导出成功！已复制提示词到剪贴板。导出路径：${response.data.export_path}`, 'success');
      } else {
        toast(`导出成功！导出路径：${response.data.export_path}`, 'success');
      }
    } catch (error: any) {
      console.error('导出失败:', error);
      toast(`导出失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-5xl max-h-[85vh] flex flex-col">
        {/* 标题 */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <span className={`text-${config.color}-400`}>{config.icon}</span>
            <h3 className="text-lg font-semibold">{config.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-4 flex-1 overflow-y-auto min-h-0">
          <p className="text-sm text-gray-400 mb-4">{config.info}</p>

          <label className="block text-sm font-medium mb-2">
            分镜描述提示词 <span className="text-gray-500">(可修改)</span>
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="请输入分镜描述，或点击下方按钮AI生成"
            className={`w-full h-96 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm resize-y focus:outline-none focus:border-${config.color}-500`}
            disabled={isAnalyzing}
          />

          {/* 按钮1：AI生成提示词 */}
          <button
            onClick={handleAIGenerate}
            disabled={isAnalyzing}
            className="mt-3 flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isAnalyzing ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                AI分析中...
              </>
            ) : (
              <>
                <Wand2 size={16} />
                AI生成提示词
              </>
            )}
          </button>

          <div className={`bg-${config.color}-900 bg-opacity-30 border border-${config.color}-700 rounded p-3 mt-3`}>
            <p className="text-sm text-gray-300">
              💡 提示：可以手动修改提示词，或点击"AI生成提示词"让系统分析图片
            </p>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-between p-4 border-t border-gray-700">
          {/* 左侧：导出按钮（仅在多分镜视频模式显示） */}
          <div>
            {type === 'multi_scene_video' && (
              <button
                onClick={handleExport}
                disabled={isExporting || isAnalyzing}
                className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed transition"
                title="导出分镜图和提示词到 data/output 目录"
              >
                {isExporting ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                    导出中...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    导出
                  </>
                )}
              </button>
            )}
          </div>

          {/* 右侧：生成按钮 */}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isAnalyzing}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              取消
            </button>

            {/* 按钮3：智能生成 */}
            <button
              onClick={handleSmartGenerate}
              disabled={isAnalyzing}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <Zap size={16} />
              智能生成
            </button>

            {/* 按钮2：直接生成 */}
            <button
              onClick={handleDirectGenerate}
              disabled={isAnalyzing || !prompt.trim()}
              className={`flex items-center gap-2 px-4 py-2 bg-${config.color}-600 hover:bg-${config.color}-700 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed transition`}
            >
              <Sparkles size={16} />
              直接生成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
