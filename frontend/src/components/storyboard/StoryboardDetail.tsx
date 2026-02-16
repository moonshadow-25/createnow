import { useState, useEffect, useRef } from 'react';
import { assetApi, generationApi, storyboardApi } from '@/services/api';
import { useStoryboardGenerationStore } from '@/store/storyboardGenerationStore';
import { Edit, Trash2, Film, Plus, Sparkles, Play, RefreshCcw, Zap, Loader2 } from 'lucide-react';
import { VideoGallery } from './VideoGallery';
import { VideoGenerateDialog } from './VideoGenerateDialog';
import { ImageGallery } from '@/components/assets/ImageGallery';
import { useToast } from '@/components/common/Toast';
import { ImageEditDialog } from '@/components/common/ImageEditDialog';
import { getImageUrl } from './utils/mediaUtils';
import { useStoryboardContentEdit } from './hooks/useStoryboardContentEdit';
import { useStoryboardBatchOperations } from './hooks/useStoryboardBatchOperations';
import { useStoryboardImageManagement } from './hooks/useStoryboardImageManagement';
import { useTripleGridOperations } from './hooks/useTripleGridOperations';
import TripleGridPromptDialog from './TripleGridPromptDialog';
import { SortableStoryboardCard } from './StoryboardCard';
import { ScriptEditDialog } from './ScriptEditDialog';
import { StoryboardEditDialog } from './StoryboardEditDialog';
import { AssetSelectorDialog } from './AssetSelectorDialog';
import { StoryboardBatchActions } from './StoryboardBatchActions';
import { StoryboardPromptDialog } from './StoryboardPromptDialog';
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { runWithConcurrency } from './utils/concurrencyControl';

interface StoryboardDetailProps {
  projectId: string;
  episodes: any[];
  characters: any[];
  scenes: any[];
  props: any[];
  onUpdated: () => void;
}

export function StoryboardDetail({
  projectId,
  episodes,
  characters,
  scenes,
  props,
  onUpdated
}: StoryboardDetailProps) {
  const { toast } = useToast();
  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  const [storyboards, setStoryboards] = useState<any[]>([]);
  const [storyboardPrimaryImages, setStoryboardPrimaryImages] = useState<Map<string, string>>(new Map());
  const [showVideoGallery, setShowVideoGallery] = useState(false);

  // 使用 store 管理生成状态
  const { startTask, completeTask, failTask, hasRunningTask } = useStoryboardGenerationStore();

  // 剧本编辑相关状态
  const [showScriptEdit, setShowScriptEdit] = useState(false);
  const [editingScript, setEditingScript] = useState('');

  // 分镜编辑相关状态
  const [showStoryboardEdit, setShowStoryboardEdit] = useState(false);
  const [editingStoryboard, setEditingStoryboard] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false); // 区分创建/编辑模式
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [selectedScene, setSelectedScene] = useState('');
  const [selectedProps, setSelectedProps] = useState<string[]>([]);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [showAssetSelector, setShowAssetSelector] = useState(false);

  // 从 store 获取任务状态方法
  const getTaskStatus = useStoryboardGenerationStore(state => state.getTaskStatus);
  const [storyboardImages, setStoryboardImages] = useState<any[]>([]);
  const [showStoryboardImageGallery, setShowStoryboardImageGallery] = useState(false);
  const [imageGalleryStoryboard, setImageGalleryStoryboard] = useState<any>(null);

  // 分镜内容编辑状态（使用 hook）
  const contentEdit = useStoryboardContentEdit();
  const {
    contentExpanded,
    setContentExpanded,
    editDescription,
    setEditDescription,
    editDialogue,
    setEditDialogue,
    editAction,
    setEditAction,
    editShotType,
    setEditShotType,
    editCameraAngle,
    setEditCameraAngle,
    resetEditState
  } = contentEdit;

  // 图像编辑对话框状态
  const [showImageEditDialog, setShowImageEditDialog] = useState(false);
  // 视频生成弹框状态
  const [showVideoGenerateDialog, setShowVideoGenerateDialog] = useState(false);
  const [videoGenerateStoryboard, setVideoGenerateStoryboard] = useState<any>(null);
  // 保存成功提示状态
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 图片编辑弹框状态（用于分镜卡片按钮）
  const [showCardImageEditDialog, setShowCardImageEditDialog] = useState(false);
  const [cardImageEditStoryboard, setCardImageEditStoryboard] = useState<any>(null);
  const [cardImageEditImages, setCardImageEditImages] = useState<any[]>([]);
  // 自动匹配资产加载状态
  const [isAutoMatching, setIsAutoMatching] = useState(false);
  // 隐藏图片状态
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(new Set());

  // 三宫格对话框状态
  const [showTripleGridDialog, setShowTripleGridDialog] = useState(false);

  // 状态隔离：跟踪当前编辑的分镜ID，防止异步响应污染其他分镜
  const editingStoryboardIdRef = useRef<string | null>(null);

  // 多选状态
  const [selectedStoryboardIds, setSelectedStoryboardIds] = useState<Set<string>>(new Set());
  const [selectedHasCompletedVideo, setSelectedHasCompletedVideo] = useState(false);

  // 统一的提示词对话框状态
  const [dialogType, setDialogType] = useState<'insert' | 'inbetween' | 'multi_fusion' | 'first_last_video' | 'multi_scene_video' | null>(null);
  const [dialogStoryboards, setDialogStoryboards] = useState<any[]>([]);

  // 一键生成分镜图状态
  const [isOneClickGenerating, setIsOneClickGenerating] = useState(false);
  const [oneClickPhase, setOneClickPhase] = useState<'assets' | 'prompts' | 'images' | null>(null);
  const [oneClickProgress, setOneClickProgress] = useState({ current: 0, total: 0 });
  const [oneClickFailures, setOneClickFailures] = useState<Array<{ sequence: number; phase: string; error: string }>>([]);
  const oneClickAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // 组件卸载时清理
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (oneClickAbortRef.current) {
        oneClickAbortRef.current.abort();
      }
    };
  }, []);

  // 切换分镜选中状态
  const handleToggleSelect = (storyboardId: string) => {
    setSelectedStoryboardIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(storyboardId)) {
        newSet.delete(storyboardId);
      } else {
        newSet.add(storyboardId);
      }
      return newSet;
    });
  };

  // 清空选择
  const handleClearSelection = () => {
    setSelectedStoryboardIds(new Set());
  };

  // 统一的对话框打开处理
  const handleOpenDialog = (type: 'insert' | 'inbetween' | 'multi_fusion' | 'first_last_video' | 'multi_scene_video') => {
    const selectedArray = storyboards
      .filter(sb => selectedStoryboardIds.has(sb.asset_id))
      .sort((a, b) => a.sequence - b.sequence);

    setDialogType(type);
    setDialogStoryboards(selectedArray);
  };

  // 统一的对话框确认处理（非阻塞模式）
  const handleDialogConfirm = (finalPrompt: string) => {
    if (!dialogType) return;

    // 立即关闭对话框和清空选择
    const currentType = dialogType;
    const currentStoryboards = [...dialogStoryboards];
    setDialogType(null);
    handleClearSelection();

    // 后台执行任务
    (async () => {
      try {
        switch (currentType) {
          case 'insert':
            await executeInsertStoryboard(currentStoryboards[0], finalPrompt);
            break;
          case 'inbetween':
            await executeInsertInbetween(currentStoryboards[0], currentStoryboards[1], finalPrompt);
            break;
          case 'multi_fusion':
            await executeMultiImageFusion(currentStoryboards, finalPrompt);
            break;
          case 'first_last_video':
            await executeFirstLastVideo(currentStoryboards[0], currentStoryboards[1], finalPrompt);
            break;
          case 'multi_scene_video':
            await executeMultiSceneVideo(currentStoryboards, finalPrompt);
            break;
        }
      } catch (error: any) {
        console.error(`${currentType} failed:`, error);
        // 错误已在execute函数中处理
      }
    })();
  };

  // 旧的插入首尾帧视频函数（已废弃，保留注释供参考）
  /*
  const handleInsertFirstLastVideoOld = async () => {
    if (!selectedEpisode) return;

    const selectedArray = storyboards
      .filter(sb => selectedStoryboardIds.has(sb.asset_id))
      .sort((a, b) => a.sequence - b.sequence);

    if (selectedArray.length !== 2) {
      toast('请选择恰好2个分镜', 'error');
      return;
    }

    const firstStoryboard = selectedArray[0];
    const secondStoryboard = selectedArray[1];

    // 检查是否有主图
    if (!firstStoryboard.image_id || !secondStoryboard.image_id) {
      toast('选中的分镜必须都有主图', 'error');
      return;
    }

    const taskId = `first_last_video_${Date.now()}`;
    startTask(taskId, 'insert_first_last_video');

    try {
      // 1. 获取或生成第一个分镜的视频提示词
      let videoPrompt = firstStoryboard.video_prompt;

      if (!videoPrompt) {
        toast('正在生成视频提示词...', 'info');
        const promptResponse = await generationApi.generateVideoPrompt(projectId, {
          storyboard_id: firstStoryboard.asset_id,
          description: firstStoryboard.description || '',
          dialogue: firstStoryboard.dialogue || '',
          action: firstStoryboard.action || '',
          shot_type: firstStoryboard.shot_type || '',
          camera_angle: firstStoryboard.camera_angle || '',
          characters: firstStoryboard.character_ids || [],
          scene: firstStoryboard.scene_id || '',
          props: firstStoryboard.prop_ids || [],
          duration: 6
        });

        videoPrompt = promptResponse.data.prompt;
      }

      toast('正在生成首尾帧视频...', 'success');

      // 2. 调用首尾帧视频生成API
      const videoResponse = await generationApi.generateVideoMultiImage(projectId, {
        storyboard_id: firstStoryboard.asset_id,
        episode_id: selectedEpisode.asset_id,
        image_ids: [firstStoryboard.image_id, secondStoryboard.image_id],
        prompt: videoPrompt,
        duration: 6,
        resolution: '1920x1080'
      });

      if (videoResponse.data) {
        toast('首尾帧视频任务已创建，请在视频库中查看生成进度', 'success');
        handleClearSelection();
      }

      completeTask(taskId, 'insert_first_last_video');
    } catch (error: any) {
      console.error('Insert first-last video failed:', error);
      toast(`生成首尾帧视频失败: ${error.response?.data?.detail || error.message}`, 'error');
      failTask(taskId, 'insert_first_last_video', error.message);
    }
  };
  */

  // 初始化时默认选中最新集
  useEffect(() => {
    if (episodes.length > 0 && !selectedEpisode) {
      // 按 episode_number 倒序排列，选中第一集（最新的）
      const sortedEpisodes = [...episodes].sort((a, b) => (b.episode_number || 0) - (a.episode_number || 0));
      setSelectedEpisode(sortedEpisodes[0]);
    }
  }, [episodes, selectedEpisode]);

  useEffect(() => {
    if (selectedEpisode) {
      loadStoryboards();
    }
  }, [selectedEpisode]);

  // 检查选中的分镜是否有已保存的视频
  useEffect(() => {
    const checkCompletedVideo = async () => {
      if (selectedStoryboardIds.size === 1 && selectedEpisode) {
        const selectedId = Array.from(selectedStoryboardIds)[0];
        try {
          const response = await generationApi.listVideos(projectId, selectedEpisode.asset_id);
          const videos = response.data || [];

          // 只要有已保存的视频（有 local_path）就显示按钮
          const hasVideo = videos.some((v: any) =>
            v.storyboard_id === selectedId &&
            v.local_path
          );

          setSelectedHasCompletedVideo(hasVideo);
        } catch (error) {
          setSelectedHasCompletedVideo(false);
        }
      } else {
        setSelectedHasCompletedVideo(false);
      }
    };

    checkCompletedVideo();
  }, [selectedStoryboardIds, selectedEpisode, projectId]);

  const loadStoryboards = async () => {
    if (!selectedEpisode) return [];

    try {
      // 使用 API 调用获取该剧集的所有分镜（后端已聚合主图URL）
      const response = await storyboardApi.list(projectId, selectedEpisode.asset_id);
      const data = response.data || [];
      // 按sequence排序
      const sortedData = data.sort((a: any, b: any) => a.sequence - b.sequence);
      setStoryboards(sortedData);

      // 从返回数据中直接提取主图URL（无需额外请求）
      const imageMap = new Map<string, string>();
      for (const sb of sortedData) {
        if (sb.primary_image_url) {
          imageMap.set(sb.asset_id, sb.primary_image_url);
        }
      }
      setStoryboardPrimaryImages(imageMap);

      return sortedData;  // ✅ 返回最新数据供调用者使用
    } catch (error) {
      console.error('Failed to load storyboards:', error);
      setStoryboards([]);
      setStoryboardPrimaryImages(new Map());
      return [];  // 错误时返回空数组
    }
  };

  // 刷新分镜数据（手动刷新按钮）
  const handleRefreshStoryboards = async () => {
    try {
      // 刷新当前分镜列表
      await loadStoryboards();

      // 刷新所有资产数据（分镜界面会显示角色、场景、道具的图片）
      onUpdated();

      toast('分镜数据已刷新', 'success');
    } catch (error) {
      console.error('Failed to refresh storyboards:', error);
      toast('刷新失败，请重试', 'error');
    }
  };

  // 使用批量操作 hook
  const batchOps = useStoryboardBatchOperations({
    projectId,
    selectedEpisode,
    toast,
    startTask,
    completeTask,
    failTask,
    loadStoryboards
  });
  const { executeInsertStoryboard, executeMultiImageFusion, executeInsertInbetween, executeFirstLastVideo, executeCreateEndFrame, executeMultiSceneVideo } = batchOps;

  // 使用图片管理 hook
  const imageManagement = useStoryboardImageManagement({
    projectId,
    toast,
    startTask,
    completeTask,
    failTask,
    loadStoryboards
  });
  const {
    setEditingStoryboardId,
    handleEditImage: handleEditImageBase,
    handleSetPrimaryStoryboardImage: handleSetPrimaryStoryboardImageBase,
    handleGeneratePrompt: handleGeneratePromptBase,
    handleGenerateImageFromEdit: handleGenerateImageFromEditBase
  } = imageManagement;

  // 包装函数以适配现有调用方式
  const handleEditImage = (storyboard: any) => {
    return handleEditImageBase(storyboard, setCardImageEditStoryboard, setCardImageEditImages, setShowCardImageEditDialog);
  };

  const handleSetPrimaryStoryboardImage = (imageId: string) => {
    return handleSetPrimaryStoryboardImageBase(editingStoryboard, imageId, setStoryboardImages);
  };

  const handleGeneratePrompt = () => {
    return handleGeneratePromptBase(
      editingStoryboard,
      selectedCharacters,
      selectedScene,
      selectedProps,
      characters,
      scenes,
      props,
      setGeneratedPrompt
    );
  };

  const handleGenerateImageFromEdit = () => {
    return handleGenerateImageFromEditBase(
      editingStoryboard,
      generatedPrompt,
      selectedCharacters,
      selectedScene,
      selectedProps,
      characters,
      scenes,
      props,
      setStoryboardImages
    );
  };

  // 使用三宫格操作 hook
  const tripleGridOps = useTripleGridOperations({
    projectId,
    toast,
    startTask,
    completeTask,
    failTask,
    loadStoryboards,
    onUpdated,
    editingStoryboardIdRef
  });
  const {
    tripleGridPromptTemplate,
    isSplittingTripleGrid,
    handleGenerateTripleGrid: handleGenerateTripleGridBase,
    handleSplitTripleGrid: handleSplitTripleGridBase
  } = tripleGridOps;

  // 包装函数以适配现有调用方式
  const handleGenerateTripleGrid = (prompt: string) => {
    return handleGenerateTripleGridBase(
      editingStoryboard,
      storyboardImages,
      prompt,
      setStoryboardImages,
      setShowTripleGridDialog
    );
  };

  const handleSplitTripleGrid = () => {
    return handleSplitTripleGridBase(
      editingStoryboard,
      storyboardImages,
      setShowStoryboardEdit,
      setEditingStoryboard,
      setEditingStoryboardId
    );
  };

  const handleAutoGenerateStoryboards = async () => {
    if (!selectedEpisode?.script) {
      toast('该剧集没有剧本内容', 'error');
      return;
    }

    // 检查是否已有分镜
    if (storyboards.length > 0) {
      const input = prompt(`重新生成分镜警告\n\n该剧集已有 ${storyboards.length} 个分镜，重新生成将覆盖现有分镜！\n\n请输入 'confirm' 确认重新生成：`);
      if (input !== 'confirm') {
        if (input !== null) {
          toast('输入不正确，已取消生成', 'error');
        }
        return;
      }
    }

    const taskId = `auto_${selectedEpisode.asset_id}`;
    startTask(taskId, 'auto_generate');
    try {
      const response = await storyboardApi.generate(projectId, {
        episode_id: selectedEpisode.asset_id,
        script: selectedEpisode.script,
      });

      toast(`成功生成 ${response.data?.storyboards?.length || 0} 个分镜`, 'success');
      loadStoryboards();
      onUpdated();
      completeTask(taskId, 'auto_generate');
    } catch (error: any) {
      toast(`生成失败: ${error.response?.data?.detail || error.message || '未知错误'}`, 'error');
      failTask(taskId, 'auto_generate', error.message || '未知错误');
    }
  };

  /**
   * 一键生成分镜图：自动匹配资产、生成提示词、生成图片
   */
  const handleOneClickGenerateStoryboardImages = async () => {
    // 0. 预检查
    if (storyboards.length === 0) {
      toast('当前没有分镜，请先生成或创建分镜', 'error');
      return;
    }

    // 统计各阶段需要处理的分镜数量
    // 关键：如果已经有图片了，就认为该分镜已完成，不再处理
    const needAssets = storyboards.filter(sb =>
      !sb.primary_image_url && // 没有图片才处理
      !sb.scene_id &&
      (!sb.character_ids || sb.character_ids.length === 0)
    );
    const needPrompts = storyboards.filter(sb =>
      !sb.primary_image_url && // 没有图片才处理
      !sb.image_prompt
    );
    const needImages = storyboards.filter(sb => !sb.primary_image_url);

    // 检查是否有提示词但无资产的情况
    // 关键：如果已经有图片了，就认为该分镜已完成，不再处理
    const hasPromptNoAssets = storyboards.filter(sb =>
      !sb.primary_image_url && // 没有图片才处理
      sb.image_prompt &&
      !sb.scene_id &&
      (!sb.character_ids || sb.character_ids.length === 0)
    );

    if (needAssets.length === 0 && needPrompts.length === 0 && needImages.length === 0) {
      toast('所有分镜已完成生成', 'info');
      return;
    }

    // 确认对话框
    let confirmMessage = `即将执行一键生成分镜图（最多10个并发）：\n`;
    if (needAssets.length > 0) confirmMessage += `- 匹配资产：${needAssets.length}个分镜\n`;
    if (needPrompts.length > 0) confirmMessage += `- 生成提示词：${needPrompts.length}个分镜\n`;
    if (needImages.length > 0) confirmMessage += `- 生成图片：${needImages.length}个分镜\n`;
    if (hasPromptNoAssets.length > 0) {
      confirmMessage += `\n注意：检测到${hasPromptNoAssets.length}个分镜有提示词但无资产，将先匹配资产后重新生成提示词\n`;
    }
    confirmMessage += `\n此操作可能需要一定时间，确认继续？`;

    if (!confirm(confirmMessage)) {
      return;
    }

    // 创建 AbortController
    oneClickAbortRef.current = new AbortController();
    setIsOneClickGenerating(true);
    setOneClickFailures([]);

    try {
      // 清空有提示词但无资产的分镜的提示词
      if (hasPromptNoAssets.length > 0) {
        await Promise.all(
          hasPromptNoAssets.map(sb =>
            storyboardApi.update(projectId, sb.asset_id, { image_prompt: null })
          )
        );
        // 刷新分镜列表
        await loadStoryboards();
      }

      const failedAssetMatches = new Set<string>();
      const failedPromptGenerations = new Set<string>();

      // 阶段1：自动匹配资产（并发）
      // 关键：如果已经有图片了，就认为该分镜已完成，不再处理
      const storyboardsNeedAssets = storyboards.filter(sb =>
        !sb.primary_image_url && // 没有图片才处理
        !sb.scene_id &&
        (!sb.character_ids || sb.character_ids.length === 0)
      );

      if (storyboardsNeedAssets.length > 0 && isMountedRef.current) {
        setOneClickPhase('assets');
        setOneClickProgress({ current: 0, total: storyboardsNeedAssets.length });

        const assetResults = await runWithConcurrency(
          storyboardsNeedAssets,
          async (sb: any) => {
            const response = await storyboardApi.autoMatchAssets(projectId, sb.asset_id);
            return response.data;
          },
          10,
          (completed, total) => {
            if (isMountedRef.current) {
              setOneClickProgress({ current: completed, total });
            }
          },
          isMountedRef
        );

        // 统计失败
        const assetFailures = assetResults.filter(r => !r.success && r.error !== 'Aborted');
        assetFailures.forEach(r => {
          failedAssetMatches.add((r.task as any).asset_id);
          setOneClickFailures(prev => [...prev, {
            sequence: (r.task as any).sequence,
            phase: '资产匹配',
            error: r.error?.message || '未知错误'
          }]);
        });

        if (!isMountedRef.current) return;

        const successCount = assetResults.filter(r => r.success).length;
        if (assetFailures.length > 0) {
          const failedSeqs = assetFailures.map(r => `#${(r.task as any).sequence}`).slice(0, 3).join(', ');
          toast(
            `资产匹配完成: ${successCount}/${storyboardsNeedAssets.length}\n失败: ${failedSeqs}${assetFailures.length > 3 ? '...' : ''}`,
            'info'
          );
        } else if (successCount > 0) {
          toast(`资产匹配完成: ${successCount}个`, 'success');
        }

        // 刷新分镜列表获取最新的资产匹配结果
        await loadStoryboards();
      }

      // 阶段2：生成提示词（并发）
      if (isMountedRef.current) {
        // ✅ 重新从API获取最新数据（包含阶段1匹配的资产）
        const updatedStoryboards = await loadStoryboards();

        // 筛选需要生成提示词的分镜
        // 关键：如果已经有图片了，就认为该分镜已完成，不再处理
        const storyboardsNeedPrompts = updatedStoryboards.filter((sb: any) => {
          if (sb.primary_image_url) return false; // 已有图片，跳过
          if (sb.image_prompt) return false; // 已有提示词，跳过

          const hasAssets = sb.scene_id || (sb.character_ids && sb.character_ids.length > 0);
          const assetMatchFailed = failedAssetMatches.has(sb.asset_id);

          // 有资产 或者 资产匹配失败（尝试无资产生成）
          return hasAssets || assetMatchFailed;
        });

        if (storyboardsNeedPrompts.length > 0 && isMountedRef.current) {
          setOneClickPhase('prompts');
          setOneClickProgress({ current: 0, total: storyboardsNeedPrompts.length });

          const promptResults = await runWithConcurrency(
            storyboardsNeedPrompts,
            async (sb: any) => {
              // 收集资产信息
              const charObjs = (sb.character_ids || [])
                .map((id: string) => characters.find(c => c.asset_id === id))
                .filter(Boolean);
              const sceneObj = scenes.find(s => s.asset_id === sb.scene_id);
              const propObjs = (sb.prop_ids || [])
                .map((id: string) => props.find(p => p.asset_id === id))
                .filter(Boolean);

              // 判断是否使用图生图模式
              const hasAssets = charObjs.length > 0 || sceneObj || propObjs.length > 0;

              let enhancedDescription = sb.description || '';

              if (hasAssets) {
                // 图生图模式：构建参考图像描述
                const referenceImages = [];
                let imageIndex = 1;

                charObjs.forEach((c: any) => {
                  const genderEn = c.gender === '男' ? 'man' : 'woman';
                  const agePart = c.age ? `${c.age}-year-old ` : '';
                  referenceImages.push(`image${imageIndex}: the ${agePart}${genderEn}`);
                  imageIndex++;
                });

                if (sceneObj) {
                  referenceImages.push(`image${imageIndex}: the ${sceneObj.name} scene`);
                  imageIndex++;
                }

                propObjs.forEach((p: any) => {
                  referenceImages.push(`image${imageIndex}: the ${p.name}`);
                  imageIndex++;
                });

                enhancedDescription = referenceImages.join('\n') + '\n\n' + sb.description;
                if (sb.shot_type) enhancedDescription += `\n镜头类型: ${sb.shot_type}`;
                if (sb.camera_angle) enhancedDescription += `\n机位角度: ${sb.camera_angle}`;
                if (sb.action) enhancedDescription += `\n动作: ${sb.action}`;
                if (sb.dialogue) enhancedDescription += `\n对白: ${sb.dialogue}`;
              } else {
                // 纯文生图模式
                enhancedDescription = sb.description || '';
                if (sb.shot_type) enhancedDescription += `\n镜头类型: ${sb.shot_type}`;
                if (sb.camera_angle) enhancedDescription += `\n机位角度: ${sb.camera_angle}`;
                if (sb.action) enhancedDescription += `\n动作: ${sb.action}`;
                if (sb.dialogue) enhancedDescription += `\n对白: ${sb.dialogue}`;
              }

              // 生成提示词
              await generationApi.generateImagePrompt(projectId, {
                asset_type: 'storyboard',
                description: enhancedDescription,
                shot_type: sb.shot_type || '',
                action: sb.action || '',
                camera_angle: sb.camera_angle || '',
                use_image_edit: hasAssets,  // ✅ 根据是否有资产选择模板（图生图/文生图）
                asset_id: sb.asset_id,  // 传入 storyboard ID，后端会自动保存
              });

              // 后端已自动保存，不需要手动保存
              return { hasAssets };
            },
            10,
            (completed, total) => {
              if (isMountedRef.current) {
                setOneClickProgress({ current: completed, total });
              }
            },
            isMountedRef
          );

          // 统计失败
          const promptFailures = promptResults.filter(r => !r.success && r.error !== 'Aborted');
          promptFailures.forEach(r => {
            failedPromptGenerations.add((r.task as any).asset_id);
            setOneClickFailures(prev => [...prev, {
              sequence: (r.task as any).sequence,
              phase: '提示词生成',
              error: r.error?.message || '未知错误'
            }]);
          });

          if (!isMountedRef.current) return;

          const successCount = promptResults.filter(r => r.success).length;
          if (promptFailures.length > 0) {
            const failedSeqs = promptFailures.map(r => `#${(r.task as any).sequence}`).slice(0, 3).join(', ');
            toast(
              `提示词生成完成: ${successCount}/${storyboardsNeedPrompts.length}\n失败: ${failedSeqs}${promptFailures.length > 3 ? '...' : ''}`,
              'info'
            );
          } else if (successCount > 0) {
            toast(`提示词生成完成: ${successCount}个`, 'success');
          }

          // 刷新分镜列表获取最新的提示词
          await loadStoryboards();
        }
      }

      // 阶段3：生成图片（并发）
      if (isMountedRef.current) {
        // ✅ 重新从API获取最新数据（包含阶段2生成的提示词）
        const finalStoryboards = await loadStoryboards();

        // 筛选需要生成图片的分镜
        const storyboardsNeedImages = finalStoryboards.filter((sb: any) =>
          !sb.primary_image_url &&
          sb.image_prompt &&
          !failedPromptGenerations.has(sb.asset_id)
        );

        if (storyboardsNeedImages.length > 0 && isMountedRef.current) {
          setOneClickPhase('images');
          setOneClickProgress({ current: 0, total: storyboardsNeedImages.length });

          const imageResults = await runWithConcurrency(
            storyboardsNeedImages,
            async (sb: any) => {
              // 收集资产的image_id（用于图生图）
              const referenceImageIds = [];

              if (sb.character_ids && sb.character_ids.length > 0) {
                for (const charId of sb.character_ids) {
                  const char = characters.find(c => c.asset_id === charId);
                  if (char?.image_id) {
                    referenceImageIds.push(char.image_id);
                  }
                }
              }

              if (sb.scene_id) {
                const scene = scenes.find(s => s.asset_id === sb.scene_id);
                if (scene?.image_id) {
                  referenceImageIds.push(scene.image_id);
                }
              }

              if (sb.prop_ids && sb.prop_ids.length > 0) {
                for (const propId of sb.prop_ids) {
                  const prop = props.find(p => p.asset_id === propId);
                  if (prop?.image_id) {
                    referenceImageIds.push(prop.image_id);
                  }
                }
              }

              // 判断使用哪个API
              if (referenceImageIds.length > 0) {
                // 图生图模式（image-edit）
                // ✅ 不传递 size 参数，使用后端配置的全局比例格式（如 16x9）
                await generationApi.editImage(projectId, {
                  assetId: sb.asset_id,
                  assetType: 'storyboard',
                  prompt: sb.image_prompt,
                  referenceImageIds
                });
              } else {
                // 纯文生图模式
                // ✅ 使用分镜标准分辨率 1920x1080
                await generationApi.generateImage(projectId, {
                  asset_id: sb.asset_id,
                  asset_type: 'storyboard',
                  prompt: sb.image_prompt,
                  negative_prompt: '',
                  width: 1920,
                  height: 1080,
                });
              }

              return { referenceImageIds };
            },
            10,
            (completed, total) => {
              if (isMountedRef.current) {
                setOneClickProgress({ current: completed, total });
              }
            },
            isMountedRef
          );

          // 统计失败
          const imageFailures = imageResults.filter(r => !r.success && r.error !== 'Aborted');
          imageFailures.forEach(r => {
            setOneClickFailures(prev => [...prev, {
              sequence: (r.task as any).sequence,
              phase: '图片生成',
              error: r.error?.message || '未知错误'
            }]);
          });

          if (!isMountedRef.current) return;

          const successCount = imageResults.filter(r => r.success).length;
          if (imageFailures.length > 0) {
            const failedSeqs = imageFailures.map(r => `#${(r.task as any).sequence}`).slice(0, 3).join(', ');
            toast(
              `图片生成完成: ${successCount}/${storyboardsNeedImages.length}\n失败: ${failedSeqs}${imageFailures.length > 3 ? '...' : ''}`,
              'info'
            );
          } else if (successCount > 0) {
            toast(`图片生成完成: ${successCount}个`, 'success');
          }

          // 刷新分镜列表获取最新的图片
          await loadStoryboards();
        }
      }

      // 完成
      if (isMountedRef.current) {
        toast('一键生成分镜图完成！', 'success');
        await loadStoryboards();
        onUpdated();
      }

    } catch (error: any) {
      if (isMountedRef.current) {
        console.error('一键生成分镜图失败:', error);
        // 忽略中止错误
        if (error.name !== 'AbortError') {
          toast('一键生成失败: ' + (error.message || '未知错误'), 'error');
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsOneClickGenerating(false);
        setOneClickPhase(null);
        setOneClickProgress({ current: 0, total: 0 });
        oneClickAbortRef.current = null;
      }
    }
  };

  const handleDeleteEpisode = async () => {
    if (!selectedEpisode) return;

    const input = prompt(`删除剧集警告\n\n此操作将删除第${selectedEpisode.episode_number}集及其所有关联的分镜，且无法恢复！\n\n请输入 'delete' 确认删除：`);
    if (input !== 'delete') {
      if (input !== null) {
        toast('输入不正确，已取消删除', 'error');
      }
      return;
    }

    try {
      await assetApi.delete(projectId, 'episode', selectedEpisode.asset_id);
      onUpdated();
      setSelectedEpisode(null);
      setStoryboards([]);
      toast('剧集已删除', 'success');
    } catch (error: any) {
      toast(`删除失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  const handleAddEpisode = async () => {
    try {
      // 计算下一集的编号
      const maxEpisodeNumber = episodes.length > 0
        ? Math.max(...episodes.map(ep => ep.episode_number || 0))
        : 0;
      const nextEpisodeNumber = maxEpisodeNumber + 1;

      // 创建新剧集
      await assetApi.create(projectId, {
        asset_type: 'episode',
        episode_number: nextEpisodeNumber,
        name: `第${nextEpisodeNumber}集`,
        description: '',
        script: ''
      });

      toast(`已创建第${nextEpisodeNumber}集`, 'success');
      onUpdated(); // 刷新剧集列表
    } catch (error: any) {
      toast(`创建剧集失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  const handleOpenImageGallery = async (storyboard: any) => {
    try {
      // 加载分镜的图片集
      const response = await generationApi.listImages(projectId, storyboard.asset_id);
      const sortedImages = (response.data || []).sort((a: any, b: any) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setImageGalleryStoryboard(storyboard);
      setStoryboardImages(sortedImages);
      setShowStoryboardImageGallery(true);
    } catch (error) {
      console.error('Failed to load storyboard images:', error);
      toast('加载图片失败', 'error');
    }
  };

  const handleDeleteStoryboard = async (storyboardId: string) => {
    if (!confirm('确定删除此分镜吗？')) return;

    try {
      await storyboardApi.delete(projectId, storyboardId);
      loadStoryboards();
      onUpdated();
    } catch (error: any) {
      toast(`删除失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  const handleRenumber = async () => {
    if (!selectedEpisode) return;

    try {
      const response = await storyboardApi.renumber(projectId, selectedEpisode.asset_id);
      const data = response.data;
      if (data.updated > 0) {
        toast(`分镜序号已重新排序，共更新 ${data.updated} 个分镜`, 'success');
      } else {
        toast('分镜序号已是连续的，无需调整', 'info');
      }
      loadStoryboards();
    } catch (error: any) {
      toast(`重排序失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  const handleEditScript = () => {
    setEditingScript(selectedEpisode?.script || '');
    setShowScriptEdit(true);
  };

  const handleSaveScript = async () => {
    if (!selectedEpisode) return;

    try {
      await assetApi.update(projectId, 'episode', selectedEpisode.asset_id, {
        script: editingScript,
      });
      setSelectedEpisode({ ...selectedEpisode, script: editingScript });
      setShowScriptEdit(false);
      onUpdated();
      toast('剧本已保存', 'success');
    } catch (error: any) {
      toast(`保存失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  const handleAddStoryboard = () => {
    if (!selectedEpisode) {
      toast('请先选择剧集', 'error');
      return;
    }
    // 设置为创建模式
    setIsCreating(true);
    setEditingStoryboard(null);
    setEditingStoryboardId(null); // 状态隔离：创建模式无ID
    editingStoryboardIdRef.current = null; // 保持兼容性
    // 重置表单
    setSelectedCharacters([]);
    setSelectedScene('');
    setSelectedProps([]);
    setGeneratedPrompt('');
    resetEditState(); // 使用 hook 的重置函数
    setStoryboardImages([]);
    setShowStoryboardEdit(true);
  };

  const handleEditStoryboard = async (storyboard: any) => {
    setIsCreating(false); // 设置为编辑模式
    setEditingStoryboardId(storyboard.asset_id); // 状态隔离：记录当前编辑的分镜ID
    editingStoryboardIdRef.current = storyboard.asset_id; // 保持兼容性

    // 从后端获取最新的分镜数据，确保提示词等字段是最新的
    let latestStoryboard = storyboard;
    try {
      const response = await assetApi.get(projectId, 'storyboard', storyboard.asset_id);
      if (response.data) {
        latestStoryboard = response.data;
      }
    } catch (error) {
      console.error('Failed to fetch latest storyboard data:', error);
      // 失败时使用传入的 storyboard 数据
    }

    setEditingStoryboard(latestStoryboard);
    setSelectedCharacters(latestStoryboard.character_ids || []);
    setSelectedScene(latestStoryboard.scene_id || '');
    setSelectedProps(latestStoryboard.prop_ids || []);
    setGeneratedPrompt(latestStoryboard.image_prompt || '');
    // 初始化分镜内容编辑状态
    resetEditState(latestStoryboard); // 使用 hook 的重置函数

    // 加载分镜的图片集
    try {
      const response = await generationApi.listImages(projectId, storyboard.asset_id);
      const sortedImages = (response.data || []).sort((a: any, b: any) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setStoryboardImages(sortedImages);

      // 读取隐藏图片状态
      const storageKey = `hidden_images_${storyboard.asset_id}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const hiddenIds = JSON.parse(stored);
          setHiddenImageIds(new Set(hiddenIds));
        } catch (e) {
          console.error('Failed to parse hidden images:', e);
        }
      } else {
        setHiddenImageIds(new Set());
      }
    } catch (error) {
      console.error('Failed to load storyboard images:', error);
      setStoryboardImages([]);
    }

    setShowStoryboardEdit(true);
  };

  const handleAutoMatchAssets = async () => {
    if (!editingStoryboard) {
      toast('请先保存分镜再使用自动匹配', 'info');
      return;
    }

    setIsAutoMatching(true);
    try {
      const response = await storyboardApi.autoMatchAssets(projectId, editingStoryboard.asset_id);
      const matched = response.data;

      // 更新选中的资产
      setSelectedScene(matched.scene_id || '');
      setSelectedCharacters(matched.character_ids || []);
      setSelectedProps(matched.prop_ids || []);

      // 显示匹配说明
      if (matched.explanation) {
        toast(`已自动匹配资产：${matched.explanation}`, 'success');
      } else {
        toast('已自动匹配资产', 'success');
      }
    } catch (error: any) {
      console.error('Failed to auto-match assets:', error);
      toast(error.response?.data?.detail || '自动匹配失败', 'error');
    } finally {
      setIsAutoMatching(false);
    }
  };

  const handleSaveStoryboard = async () => {
    if (!selectedEpisode) return;

    // 验证必填字段
    if (!editDescription.trim()) {
      toast('请填写画面描述', 'error');
      return;
    }

    try {
      // 构建基础数据
      const baseData: any = {
        description: editDescription.trim(),
        shot_type: editShotType,
        camera_angle: editCameraAngle,
      };

      // 只添加有值的可选字段（dialogue, action, image_prompt 可以为空）
      if (editDialogue.trim()) baseData.dialogue = editDialogue.trim();
      if (editAction.trim()) baseData.action = editAction.trim();
      // 资产字段需要始终传递，即使为空数组，以便支持删除操作
      baseData.character_ids = selectedCharacters;
      baseData.scene_id = selectedScene;
      baseData.prop_ids = selectedProps;
      if (generatedPrompt.trim()) baseData.image_prompt = generatedPrompt.trim();

      if (isCreating) {
        // 创建模式 - 使用专门的分镜API
        const newSequence = storyboards.length + 1;
        const data = {
          episode_id: selectedEpisode.asset_id,
          sequence: newSequence,
          ...baseData,
        };
        await storyboardApi.create(projectId, data);
        toast('分镜已创建', 'success');
      } else {
        // 编辑模式 - 使用专门的分镜API
        if (!editingStoryboard) return;
        await storyboardApi.update(projectId, editingStoryboard.asset_id, baseData);
        toast('分镜已更新', 'success');
      }

      loadStoryboards();
      // 显示成功提示，但不关闭弹框
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      onUpdated();
    } catch (error: any) {
      toast(`保存失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  const handleGenerateVideo = async (storyboard: any) => {
    // 检查是否有图片
    const imagesResponse = await generationApi.listImages(projectId, storyboard.asset_id);
    const images = imagesResponse.data || [];

    if (images.length === 0) {
      toast('请先生成分镜图', 'error');
      return;
    }

    // 打开视频生成弹框
    setVideoGenerateStoryboard(storyboard);
    setShowVideoGenerateDialog(true);
  };

  // 拖拽结束处理
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = storyboards.findIndex(sb => sb.asset_id === active.id);
    const newIndex = storyboards.findIndex(sb => sb.asset_id === over.id);

    // 乐观更新 UI
    const newStoryboards = arrayMove(storyboards, oldIndex, newIndex);
    setStoryboards(newStoryboards);

    // 调用 API 更新后端
    try {
      await storyboardApi.reorder(projectId, {
        episode_id: selectedEpisode.asset_id,
        old_sequence: oldIndex + 1,
        new_sequence: newIndex + 1,
      });
      // 刷新数据以确保序号正确
      loadStoryboards();
    } catch (error) {
      console.error('Failed to reorder storyboards:', error);
      // 失败时恢复原状
      loadStoryboards();
    }
  };

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* 左侧：剧集数字按钮 */}
      <div className="bg-gray-800 rounded-lg p-2 overflow-y-auto flex-shrink-0">
        <div className="flex flex-col gap-2">
          {[...episodes].sort((a, b) => (b.episode_number || 0) - (a.episode_number || 0)).map((episode) => (
            <button
              key={episode.asset_id}
              onClick={() => setSelectedEpisode(episode)}
              className={`w-10 h-10 rounded flex items-center justify-center font-semibold transition ${
                selectedEpisode?.asset_id === episode.asset_id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              title={`第${episode.episode_number}集`}
            >
              {episode.episode_number}
            </button>
          ))}
          {/* 新增剧集按钮 */}
          <button
            onClick={handleAddEpisode}
            className="w-10 h-10 rounded flex items-center justify-center font-semibold transition bg-green-600 hover:bg-green-700 text-white text-xl"
            title="新增剧集"
          >
            +
          </button>
          {episodes.length === 0 && (
            <div className="text-gray-500 text-xs p-2 text-center w-10">
              空
            </div>
          )}
        </div>
      </div>

      {/* 右侧：分镜详情 */}
      <div className="flex-1 bg-gray-800 rounded-lg flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4 pb-8">
          {selectedEpisode ? (
          <>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-xl font-semibold">第{selectedEpisode.episode_number}集</h3>
                <p className="text-sm text-gray-400 mt-1">{selectedEpisode.description || ''}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAutoGenerateStoryboards}
                  className={`flex items-center gap-1 text-sm px-3 py-2 rounded ${hasRunningTask(`auto_${selectedEpisode?.asset_id}`)
                      ? 'bg-gray-600 cursor-not-allowed opacity-70'
                      : 'bg-purple-600 hover:bg-purple-700'
                    }`}
                  disabled={hasRunningTask(`auto_${selectedEpisode?.asset_id}`)}
                >
                  {hasRunningTask(`auto_${selectedEpisode?.asset_id}`) ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                      生成中...
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} />
                      AI生成分镜
                    </>
                  )}
                </button>
                {/* 一键生成分镜图按钮 */}
                <button
                  onClick={handleOneClickGenerateStoryboardImages}
                  disabled={isOneClickGenerating || storyboards.length === 0}
                  className={`flex items-center gap-1 text-sm px-3 py-2 rounded font-medium ${
                    isOneClickGenerating || storyboards.length === 0
                      ? 'bg-gray-600 cursor-not-allowed opacity-70'
                      : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700'
                  }`}
                  title="自动匹配资产、生成提示词和分镜图"
                >
                  {isOneClickGenerating ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      {oneClickPhase === 'assets' && `匹配资产 ${oneClickProgress.current}/${oneClickProgress.total}`}
                      {oneClickPhase === 'prompts' && `生成提示词 ${oneClickProgress.current}/${oneClickProgress.total}`}
                      {oneClickPhase === 'images' && `生成图片 ${oneClickProgress.current}/${oneClickProgress.total}`}
                    </>
                  ) : (
                    <>
                      <Zap size={14} />
                      一键生成分镜图
                    </>
                  )}
                </button>
                <button
                  onClick={handleRenumber}
                  className="flex items-center gap-1 text-sm bg-yellow-600 hover:bg-yellow-700 px-3 py-2 rounded"
                  title="重新排序分镜序号，消除间隙"
                  disabled={storyboards.length === 0}
                >
                  <RefreshCcw size={14} />
                  重新排序
                </button>
                <button
                  onClick={handleRefreshStoryboards}
                  className="flex items-center gap-1 text-sm bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded"
                  title="刷新分镜数据"
                >
                  <RefreshCcw size={14} />
                  刷新
                </button>
                <button
                  onClick={handleAddStoryboard}
                  className="flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded"
                >
                  <Plus size={14} />
                  添加分镜
                </button>
                <button
                  onClick={() => setShowVideoGallery(true)}
                  className="flex items-center gap-1 text-sm bg-green-600 hover:bg-green-700 px-3 py-2 rounded"
                >
                  <Play size={14} />
                  视频库
                </button>
                <button
                  onClick={handleDeleteEpisode}
                  className="flex items-center gap-1 text-sm bg-red-600 hover:bg-red-700 px-3 py-2 rounded"
                >
                  <Trash2 size={14} />
                  删除剧集
                </button>
              </div>
            </div>

            {/* 一键生成进度显示 */}
            {isOneClickGenerating && (
              <div className="mb-4 bg-gradient-to-r from-purple-900/30 to-pink-900/30 border border-purple-700/50 rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-purple-200 font-medium">
                    {oneClickPhase === 'assets' && '正在匹配资产...'}
                    {oneClickPhase === 'prompts' && '正在生成提示词...'}
                    {oneClickPhase === 'images' && '正在生成分镜图...'}
                  </span>
                  <span className="text-sm text-purple-200">
                    {oneClickProgress.current} / {oneClickProgress.total}
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${oneClickProgress.total > 0 ? (oneClickProgress.current / oneClickProgress.total) * 100 : 0}%`
                    }}
                  />
                </div>
                <div className="mt-2 text-xs text-purple-300">
                  {oneClickPhase === 'assets' && '匹配完成后将自动生成提示词'}
                  {oneClickPhase === 'prompts' && '提示词生成完成后将自动生成图片'}
                  {oneClickPhase === 'images' && '图片生成中，请耐心等待...'}
                </div>
                {oneClickFailures.length > 0 && (
                  <div className="mt-2 text-xs text-red-400">
                    部分分镜处理失败: {oneClickFailures.slice(0, 3).map(f => `#${f.sequence}`).join(', ')}
                    {oneClickFailures.length > 3 && '...'}
                  </div>
                )}
              </div>
            )}

            {/* 剧本内容 */}
            <div className="mb-4 p-3 bg-gray-700 rounded">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-semibold text-gray-400">剧本内容</h4>
                <button
                  onClick={handleEditScript}
                  className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
                >
                  <Edit size={14} />
                  编辑
                </button>
              </div>
              {selectedEpisode.script ? (
                <p className="text-sm text-gray-200 line-clamp-3">
                  {selectedEpisode.script}
                </p>
              ) : (
                <p className="text-sm text-gray-500 italic">暂无剧本内容</p>
              )}
            </div>

            {/* 剧集资产统计 */}
            {storyboards.length > 0 && (
              <div className="mb-4 p-3 bg-gray-700 rounded">
                <h4 className="text-sm font-semibold text-gray-400 mb-2">使用资产</h4>
                <div className="flex flex-wrap gap-3 text-sm">
                  {/* 收集所有分镜的角色 */}
                  {(() => {
                    const uniqueCharacterIds = new Set<string>();
                    storyboards.forEach(sb => {
                      (sb.character_ids || []).forEach((id: string) => uniqueCharacterIds.add(id));
                    });
                    const uniqueCharacters = Array.from(uniqueCharacterIds)
                      .map(id => characters.find(c => c.asset_id === id))
                      .filter(Boolean);
                    return uniqueCharacters.length > 0 ? (
                      <div>
                        <span className="text-gray-400">角色:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {uniqueCharacters.map((char: any) => (
                            <span key={char.asset_id} className="bg-blue-900 text-blue-300 px-2 py-1 rounded text-xs">
                              {char.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* 收集所有分镜的场景 */}
                  {(() => {
                    const uniqueSceneIds = new Set<string>();
                    storyboards.forEach(sb => {
                      if (sb.scene_id) uniqueSceneIds.add(sb.scene_id);
                    });
                    const uniqueScenes = Array.from(uniqueSceneIds)
                      .map(id => scenes.find(s => s.asset_id === id))
                      .filter(Boolean);
                    return uniqueScenes.length > 0 ? (
                      <div>
                        <span className="text-gray-400">场景:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {uniqueScenes.map((scene: any) => (
                            <span key={scene.asset_id} className="bg-green-900 text-green-300 px-2 py-1 rounded text-xs">
                              {scene.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* 收集所有分镜的道具 */}
                  {(() => {
                    const uniquePropIds = new Set<string>();
                    storyboards.forEach(sb => {
                      (sb.prop_ids || []).forEach((id: string) => uniquePropIds.add(id));
                    });
                    const uniqueProps = Array.from(uniquePropIds)
                      .map(id => props.find(p => p.asset_id === id))
                      .filter(Boolean);
                    return uniqueProps.length > 0 ? (
                      <div>
                        <span className="text-gray-400">道具:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {uniqueProps.map((prop: any) => (
                            <span key={prop.asset_id} className="bg-purple-900 text-purple-300 px-2 py-1 rounded text-xs">
                              {prop.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              </div>
            )}

            {/* 分镜列表 */}
            <h4 className="text-md font-semibold mb-3">分镜 ({storyboards.length}) - 拖拽可调整顺序</h4>
            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={storyboards.map(sb => sb.asset_id)} strategy={verticalListSortingStrategy}>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {storyboards.map((sb) => (
                    <SortableStoryboardCard
                      key={sb.asset_id}
                      storyboard={sb}
                      storyboardPrimaryImages={storyboardPrimaryImages}
                      onEdit={handleEditStoryboard}
                      onEditImage={handleEditImage}
                      onGenerateVideo={handleGenerateVideo}
                      onDelete={handleDeleteStoryboard}
                      onOpenImageGallery={handleOpenImageGallery}
                      hasRunningTask={hasRunningTask}
                      isSelected={selectedStoryboardIds.has(sb.asset_id)}
                      onToggleSelect={handleToggleSelect}
                    />
                  ))}
                  {storyboards.length === 0 && (
                    <div className="col-span-full text-gray-500 text-sm p-4 text-center">
                      暂无分镜，点击上方按钮添加或让AI自动生成
                    </div>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <Film size={48} className="mx-auto mb-4 opacity-50" />
              <p>请从左侧选择一集</p>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* 视频库 */}
      {showVideoGallery && (
        <VideoGallery
          projectId={projectId}
          episodeId={selectedEpisode?.asset_id}
          onClose={() => setShowVideoGallery(false)}
          storyboardCount={storyboards.length}
          loadStoryboards={loadStoryboards}
          storyboardPrimaryImages={storyboardPrimaryImages}
        />
      )}

      {/* 视频生成弹框 */}
      {showVideoGenerateDialog && videoGenerateStoryboard && selectedEpisode && (
        <VideoGenerateDialog
          projectId={projectId}
          storyboard={videoGenerateStoryboard}
          episodeId={selectedEpisode.asset_id}
          onClose={() => {
            setShowVideoGenerateDialog(false);
            setVideoGenerateStoryboard(null);
          }}
          onSuccess={() => {
            loadStoryboards();
          }}
        />
      )}

      {/* 剧本编辑弹框 */}
      <ScriptEditDialog
        show={showScriptEdit}
        editingScript={editingScript}
        onScriptChange={setEditingScript}
        onSave={handleSaveScript}
        onClose={() => setShowScriptEdit(false)}
      />

      {/* 分镜编辑/创建弹框 */}
      <StoryboardEditDialog
        show={showStoryboardEdit}
        isCreating={isCreating}
        storyboardsCount={storyboards.length}
        editingStoryboard={editingStoryboard}
        projectId={projectId}
        saveSuccess={saveSuccess}
        contentExpanded={contentExpanded}
        setContentExpanded={setContentExpanded}
        editDescription={editDescription}
        setEditDescription={setEditDescription}
        editDialogue={editDialogue}
        setEditDialogue={setEditDialogue}
        editAction={editAction}
        setEditAction={setEditAction}
        editShotType={editShotType}
        setEditShotType={setEditShotType}
        editCameraAngle={editCameraAngle}
        setEditCameraAngle={setEditCameraAngle}
        selectedCharacters={selectedCharacters}
        setSelectedCharacters={setSelectedCharacters}
        selectedProps={selectedProps}
        setSelectedProps={setSelectedProps}
        selectedScene={selectedScene}
        setSelectedScene={setSelectedScene}
        characters={characters}
        scenes={scenes}
        props={props}
        onOpenAssetSelector={() => setShowAssetSelector(true)}
        onAutoMatchAssets={handleAutoMatchAssets}
        isAutoMatching={isAutoMatching}
        generatedPrompt={generatedPrompt}
        setGeneratedPrompt={setGeneratedPrompt}
        onGeneratePrompt={handleGeneratePrompt}
        storyboardImages={storyboardImages}
        hiddenImageIds={hiddenImageIds}
        getImageUrl={(img) => getImageUrl(img, projectId)}
        onOpenImageGallery={() => setShowStoryboardImageGallery(true)}
        getTaskStatus={getTaskStatus}
        hasRunningTask={hasRunningTask}
        onSave={handleSaveStoryboard}
        onGenerateImage={handleGenerateImageFromEdit}
        onOpenImageEdit={() => setShowImageEditDialog(true)}
        onOpenTripleGridDialog={() => setShowTripleGridDialog(true)}
        isSplittingTripleGrid={isSplittingTripleGrid}
        onSplitTripleGrid={handleSplitTripleGrid}
        onClose={() => {
          setShowStoryboardEdit(false);
          setEditingStoryboardId(null); // 状态隔离：清空
          editingStoryboardIdRef.current = null; // 保持兼容性
        }}
      />

      {/* 统一资产选择弹框 */}
      <AssetSelectorDialog
        show={showAssetSelector}
        characters={characters}
        scenes={scenes}
        props={props}
        selectedCharacters={selectedCharacters}
        setSelectedCharacters={setSelectedCharacters}
        selectedScene={selectedScene}
        setSelectedScene={setSelectedScene}
        selectedProps={selectedProps}
        setSelectedProps={setSelectedProps}
        onClose={() => setShowAssetSelector(false)}
      />

      {/* 分镜图片库 */}
      {showStoryboardImageGallery && (imageGalleryStoryboard || editingStoryboard) && (
        <ImageGallery
          images={storyboardImages}
          assetName={`分镜 ${(imageGalleryStoryboard || editingStoryboard).sequence}`}
          assetId={(imageGalleryStoryboard || editingStoryboard).asset_id}
          projectId={projectId}
          assetType="storyboard"
          onSelectPrimary={async (imageId) => {
            const targetStoryboard = imageGalleryStoryboard || editingStoryboard;
            if (imageGalleryStoryboard) {
              // 从卡片图片点击打开的，直接设置主图
              await generationApi.setPrimaryImage(projectId, targetStoryboard.asset_id, imageId);
              await loadStoryboards();
              toast('主图已设置', 'success');
            } else {
              // 从编辑对话框打开的，使用原有逻辑
              await handleSetPrimaryStoryboardImage(imageId);
            }
            setShowStoryboardImageGallery(false);
            setImageGalleryStoryboard(null);
          }}
          onClose={() => {
            setShowStoryboardImageGallery(false);
            setImageGalleryStoryboard(null);
          }}
          onImagesUpdated={async () => {
            // 重新加载分镜图片列表
            const targetStoryboard = imageGalleryStoryboard || editingStoryboard;
            if (targetStoryboard) {
              const response = await generationApi.listImages(projectId, targetStoryboard.asset_id);
              const sortedImages = (response.data || []).sort((a: any, b: any) => {
                if (a.is_primary && !b.is_primary) return -1;
                if (!a.is_primary && b.is_primary) return 1;
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              });
              setStoryboardImages(sortedImages);

              // 如果是从卡片点击打开的，同时刷新分镜列表
              if (imageGalleryStoryboard) {
                await loadStoryboards();
              }
            }
          }}
        />
      )}

      {/* 图像编辑对话框 */}
      {showImageEditDialog && editingStoryboard && (
        <ImageEditDialog
          projectId={projectId}
          assetId={editingStoryboard.asset_id}
          assetType="storyboard"
          assetName={`分镜 ${editingStoryboard.sequence}`}
          images={storyboardImages}
          onCompleted={async () => {
            await loadStoryboards();
            // 重新加载当前分镜的图片集
            const imagesResponse = await generationApi.listImages(projectId, editingStoryboard.asset_id);
            const sortedImages = (imagesResponse.data || []).sort((a: any, b: any) => {
              if (a.is_primary && !b.is_primary) return -1;
              if (!a.is_primary && b.is_primary) return 1;
              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });
            setStoryboardImages(sortedImages);
          }}
          onClose={() => setShowImageEditDialog(false)}
        />
      )}

      {/* 图片编辑对话框（分镜卡片按钮触发） */}
      {showCardImageEditDialog && cardImageEditStoryboard && (
        <ImageEditDialog
          projectId={projectId}
          assetId={cardImageEditStoryboard.asset_id}
          assetType="storyboard"
          assetName={`分镜 ${cardImageEditStoryboard.sequence}`}
          images={cardImageEditImages}
          onCompleted={async () => {
            await loadStoryboards();
          }}
          onClose={() => {
            setShowCardImageEditDialog(false);
            setCardImageEditStoryboard(null);
          }}
        />
      )}

      {/* 三宫格提示词弹框 */}
      {showTripleGridDialog && editingStoryboard && (
        <TripleGridPromptDialog
          isOpen={showTripleGridDialog}
          defaultPrompt={tripleGridPromptTemplate.replace('{description}', editDescription || editingStoryboard.description || '')}
          isGenerating={getTaskStatus(editingStoryboard.asset_id, 'triple_grid') === 'generating'}
          onConfirm={handleGenerateTripleGrid}
          onClose={() => setShowTripleGridDialog(false)}
        />
      )}

      {/* 底部批量操作面板 */}
      {selectedStoryboardIds.size > 0 && (
        <StoryboardBatchActions
          projectId={projectId}
          episodeId={selectedEpisode?.asset_id}
          episodeName={selectedEpisode?.name}
          selectedCount={selectedStoryboardIds.size}
          selectedStoryboards={storyboards.filter(sb => selectedStoryboardIds.has(sb.asset_id)).sort((a, b) => a.sequence - b.sequence)}
          selectedHasCompletedVideo={selectedHasCompletedVideo}
          onInsertStoryboard={() => handleOpenDialog('insert')}
          onInsertInbetween={() => handleOpenDialog('inbetween')}
          onInsertFirstLastVideo={() => handleOpenDialog('first_last_video')}
          onMultiImageFusion={() => handleOpenDialog('multi_fusion')}
          onMultiSceneVideo={() => handleOpenDialog('multi_scene_video')}
          onCreateEndFrame={() => executeCreateEndFrame(storyboards.find(sb => selectedStoryboardIds.has(sb.asset_id)))}
          onClearSelection={handleClearSelection}
          toast={toast}
        />
      )}

      {/* 统一的提示词对话框 */}
      {dialogType && (
        <StoryboardPromptDialog
          isOpen={true}
          type={dialogType}
          selectedStoryboards={dialogStoryboards}
          projectId={projectId}
          onConfirm={handleDialogConfirm}
          onClose={() => setDialogType(null)}
        />
      )}
    </div>
  );
}
