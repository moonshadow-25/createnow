import { useState, useEffect, useRef } from 'react';
import { assetApi, generationApi, storyboardApi } from '@/services/api';
import { useStoryboardGenerationStore } from '@/store/storyboardGenerationStore';
import { Edit, Trash2, Film, Plus, Sparkles, Play, RefreshCcw, Zap, Loader2, ChevronDown } from 'lucide-react';
import { VideoGallery } from './VideoGallery';
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
import { useOneClickGeneration } from './hooks/useOneClickGeneration';
import { useDialogManager } from './hooks/useDialogManager';
import { useAssetExtraction } from './hooks/useAssetExtraction';

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

  // 统一管理所有对话框状态
  const dialogs = useDialogManager({
    videoGallery: false,
    scriptEdit: false,
    storyboardEdit: false,
    assetSelector: false,
    storyboardImageGallery: false,
    imageEdit: false,
    cardImageEdit: false,
    tripleGrid: false
  });

  // 更多菜单
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMoreMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMoreMenu]);

  // 使用 store 管理生成状态
  const { startTask, completeTask, failTask, hasRunningTask } = useStoryboardGenerationStore();

  // 剧本编辑相关状态
  const [editingScript, setEditingScript] = useState('');

  // 分镜编辑相关状态
  const [editingStoryboard, setEditingStoryboard] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false); // 区分创建/编辑模式
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [selectedScene, setSelectedScene] = useState('');
  const [selectedProps, setSelectedProps] = useState<string[]>([]);
  const [generatedPrompt, setGeneratedPrompt] = useState('');

  // 从 store 获取任务状态方法
  const getTaskStatus = useStoryboardGenerationStore(state => state.getTaskStatus);
  const [storyboardImages, setStoryboardImages] = useState<any[]>([]);
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

  // 视频生成弹框数据状态 - 已合并到 StoryboardEditDialog
  // 保存成功提示状态
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [storyboardEditInitialTab, setStoryboardEditInitialTab] = useState<'edit' | 'video'>('edit');

  // 图片编辑弹框数据状态（用于分镜卡片按钮）
  const [cardImageEditStoryboard, setCardImageEditStoryboard] = useState<any>(null);
  const [cardImageEditImages, setCardImageEditImages] = useState<any[]>([]);
  // 隐藏图片状态
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(new Set());

  // 状态隔离：跟踪当前编辑的分镜ID，防止异步响应污染其他分镜
  const editingStoryboardIdRef = useRef<string | null>(null);

  // 多选状态
  const [selectedStoryboardIds, setSelectedStoryboardIds] = useState<Set<string>>(new Set());
  const [selectedHasCompletedVideo, setSelectedHasCompletedVideo] = useState(false);

  // 统一的提示词对话框状态
  const [dialogType, setDialogType] = useState<'insert' | 'inbetween' | 'multi_fusion' | 'first_last_video' | 'multi_scene_video' | null>(null);
  const [dialogStoryboards, setDialogStoryboards] = useState<any[]>([]);

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
    handleGenerateImageFromEdit: handleGenerateImageFromEditBase,
    handleAutoMatchAssets: handleAutoMatchAssetsBase,
    handleGenerateNineGridPrompts: handleGenerateNineGridPromptsBase,
  } = imageManagement;

  // 包装函数以适配现有调用方式
  const handleEditImage = (storyboard: any) => {
    return handleEditImageBase(storyboard, setCardImageEditStoryboard, setCardImageEditImages, (show: boolean) => {
      if (show) dialogs.open('cardImageEdit');
      else dialogs.close('cardImageEdit');
    });
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

  const handleGenerateNineGridPrompts = () => {
    return handleGenerateNineGridPromptsBase(editingStoryboard, setGeneratedPrompt, (videoPrompt: string) => {
      setEditingStoryboard((prev: any) => prev ? { ...prev, video_prompt: videoPrompt } : prev);
    });
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
      (show: boolean) => {
        if (show) dialogs.open('tripleGrid');
        else dialogs.close('tripleGrid');
      }
    );
  };

  const handleSplitTripleGrid = () => {
    return handleSplitTripleGridBase(
      editingStoryboard,
      storyboardImages,
      (show: boolean) => {
        if (show) dialogs.open('storyboardEdit');
        else dialogs.close('storyboardEdit');
      },
      setEditingStoryboard,
      setEditingStoryboardId
    );
  };

  // 使用一键生成 hook
  const oneClickGeneration = useOneClickGeneration({
    projectId,
    storyboards,
    characters,
    scenes,
    props,
    toast,
    loadStoryboards,
    onUpdated
  });
  const {
    isOneClickGenerating,
    oneClickPhase,
    oneClickProgress,
    oneClickFailures,
    handleOneClickGenerate
  } = oneClickGeneration;

  // 资产提取与匹配 hook
  const { isExtracting, isMatching, extractAssets, matchAssets } = useAssetExtraction(projectId);

  const handleExtractAssets = async () => {
    if (!selectedEpisode) return;
    const result = await extractAssets(selectedEpisode.asset_id);
    if (result) {
      const { total_created, skipped_count } = result;
      toast(
        total_created > 0
          ? `已提取 ${total_created} 个新资产${skipped_count > 0 ? `（跳过 ${skipped_count} 个重复）` : ''}`
          : `未发现需要新增的资产${skipped_count > 0 ? `（跳过 ${skipped_count} 个已有资产）` : ''}`,
        'success'
      );
      onUpdated();
    } else {
      toast('资产提取失败，请重试', 'error');
    }
  };

  const handleMatchAssets = async () => {
    if (!selectedEpisode) return;
    const result = await matchAssets(selectedEpisode.asset_id, false);
    if (result) {
      toast(
        result.updated_count > 0
          ? `已为 ${result.updated_count} 个分镜完成资产匹配`
          : '所有分镜已有资产关联，无需更新',
        'success'
      );
      loadStoryboards();
    } else {
      toast('资产匹配失败，请重试', 'error');
    }
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
      dialogs.open('storyboardImageGallery');
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
    dialogs.open('scriptEdit');
  };

  const handleSaveScript = async () => {
    if (!selectedEpisode) return;

    try {
      await assetApi.update(projectId, 'episode', selectedEpisode.asset_id, {
        script: editingScript,
      });
      setSelectedEpisode({ ...selectedEpisode, script: editingScript });
      dialogs.close('scriptEdit');
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
    dialogs.open('storyboardEdit');
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

    setStoryboardEditInitialTab('edit');
    dialogs.open('storyboardEdit');
  };

  const handleAutoMatchAssets = () => {
    if (!editingStoryboard) {
      toast('请先保存分镜再使用自动匹配', 'info');
      return;
    }
    return handleAutoMatchAssetsBase(editingStoryboard, setSelectedScene, setSelectedCharacters, setSelectedProps);
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
    await handleEditStoryboard(storyboard);
    setStoryboardEditInitialTab('video');
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
              <div className="flex gap-2 items-center">
                {/* AI生成分镜 */}
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

                {/* 视频库 */}
                <button
                  onClick={() => dialogs.open('videoGallery')}
                  className="flex items-center gap-1 text-sm bg-green-600 hover:bg-green-700 px-3 py-2 rounded"
                >
                  <Play size={14} />
                  视频库
                </button>

                {/* 更多菜单 */}
                <div className="relative" ref={moreMenuRef}>
                  <button
                    onClick={() => setShowMoreMenu(v => !v)}
                    className="flex items-center gap-1 text-sm bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded"
                  >
                    更多
                    <ChevronDown size={14} className={`transition-transform ${showMoreMenu ? 'rotate-180' : ''}`} />
                  </button>
                  {showMoreMenu && (
                    <div className="absolute right-0 top-full mt-1 w-44 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 py-1">
                      {/* 一键生成分镜图 */}
                      <button
                        onClick={() => { handleOneClickGenerate(); setShowMoreMenu(false); }}
                        disabled={isOneClickGenerating || storyboards.length === 0}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="自动匹配资产、生成提示词和分镜图"
                      >
                        {isOneClickGenerating ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                        {isOneClickGenerating ? '一键生成中...' : '一键生成分镜图'}
                      </button>
                      {/* 添加分镜 */}
                      <button
                        onClick={() => { handleAddStoryboard(); setShowMoreMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700"
                      >
                        <Plus size={14} />
                        添加分镜
                      </button>
                      {/* 重新排序 */}
                      <button
                        onClick={() => { handleRenumber(); setShowMoreMenu(false); }}
                        disabled={storyboards.length === 0}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="重新排序分镜序号，消除间隙"
                      >
                        <RefreshCcw size={14} />
                        重新排序
                      </button>
                      {/* 刷新 */}
                      <button
                        onClick={() => { handleRefreshStoryboards(); setShowMoreMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700"
                      >
                        <RefreshCcw size={14} />
                        刷新
                      </button>
                      <div className="border-t border-gray-600 my-1" />
                      {/* 删除剧集 */}
                      <button
                        onClick={() => { handleDeleteEpisode(); setShowMoreMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-red-400 hover:bg-gray-700"
                      >
                        <Trash2 size={14} />
                        删除剧集
                      </button>
                    </div>
                  )}
                </div>
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

            {/* 剧集资产统计 - 常驻显示 */}
            <div className="mb-4 p-3 bg-gray-700 rounded">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-sm font-semibold text-gray-400">使用资产</h4>
                {storyboards.length > 0 && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleExtractAssets}
                      disabled={isExtracting || isMatching}
                      className="flex items-center gap-1 text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 rounded transition-colors"
                      title="从分镜内容中提取重要角色、场景、道具，添加到资产库"
                    >
                      {isExtracting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      {isExtracting ? '提取中...' : '提取资产'}
                    </button>
                    <button
                      onClick={handleMatchAssets}
                      disabled={isExtracting || isMatching}
                      className="flex items-center gap-1 text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-200 rounded transition-colors"
                      title="将资产库中的资产自动关联到对应分镜"
                    >
                      {isMatching ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                      {isMatching ? '匹配中...' : '匹配资产'}
                    </button>
                  </div>
                )}
              </div>
              {storyboards.length > 0 ? (
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
              ) : (
                <p className="text-xs text-gray-500 italic">暂无分镜</p>
              )}
            </div>

            {/* 分镜列表 */}
            <h4 className="text-md font-semibold mb-3">分镜 ({storyboards.length}) - 拖拽可调整顺序</h4>
            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={storyboards.map(sb => sb.asset_id)} strategy={verticalListSortingStrategy}>
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 320px))' }}>
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
      {dialogs.isOpen('videoGallery') && (
        <VideoGallery
          projectId={projectId}
          episodeId={selectedEpisode?.asset_id}
          onClose={() => dialogs.close('videoGallery')}
          storyboardCount={storyboards.length}
          loadStoryboards={loadStoryboards}
          storyboardPrimaryImages={storyboardPrimaryImages}
        />
      )}

      {/* 剧本编辑弹框 */}
      <ScriptEditDialog
        show={dialogs.isOpen('scriptEdit')}
        editingScript={editingScript}
        onScriptChange={setEditingScript}
        onSave={handleSaveScript}
        onClose={() => dialogs.close('scriptEdit')}
      />

      {/* 分镜编辑/创建弹框 */}
      <StoryboardEditDialog
        show={dialogs.isOpen('storyboardEdit')}
        isCreating={isCreating}
        storyboardsCount={storyboards.length}
        editingStoryboard={editingStoryboard}
        projectId={projectId}
        episodeId={selectedEpisode?.asset_id || ''}
        initialTab={storyboardEditInitialTab}
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
        editDuration={contentEdit.editDuration}
        setEditDuration={contentEdit.setEditDuration}
        editResolution={contentEdit.editResolution}
        setEditResolution={contentEdit.setEditResolution}
        selectedCharacters={selectedCharacters}
        setSelectedCharacters={setSelectedCharacters}
        selectedProps={selectedProps}
        setSelectedProps={setSelectedProps}
        selectedScene={selectedScene}
        setSelectedScene={setSelectedScene}
        characters={characters}
        scenes={scenes}
        props={props}
        onOpenAssetSelector={() => dialogs.open('assetSelector')}
        onAutoMatchAssets={handleAutoMatchAssets}
        generatedPrompt={generatedPrompt}
        setGeneratedPrompt={setGeneratedPrompt}
        onGeneratePrompt={handleGeneratePrompt}
        onGenerateNineGridPrompts={handleGenerateNineGridPrompts}
        storyboardImages={storyboardImages}
        hiddenImageIds={hiddenImageIds}
        getImageUrl={(img) => getImageUrl(img, projectId)}
        onOpenImageGallery={() => dialogs.open('storyboardImageGallery')}
        getTaskStatus={getTaskStatus}
        hasRunningTask={hasRunningTask}
        onSave={handleSaveStoryboard}
        onGenerateImage={handleGenerateImageFromEdit}
        onOpenImageEdit={() => dialogs.open('imageEdit')}
        onOpenTripleGridDialog={() => dialogs.open('tripleGrid')}
        isSplittingTripleGrid={isSplittingTripleGrid}
        onSplitTripleGrid={handleSplitTripleGrid}
        onClose={() => {
          dialogs.close('storyboardEdit');
          setEditingStoryboardId(null); // 状态隔离：清空
          editingStoryboardIdRef.current = null; // 保持兼容性
        }}
        onSuccess={() => loadStoryboards()}
      />

      {/* 统一资产选择弹框 */}
      <AssetSelectorDialog
        show={dialogs.isOpen('assetSelector')}
        characters={characters}
        scenes={scenes}
        props={props}
        selectedCharacters={selectedCharacters}
        setSelectedCharacters={setSelectedCharacters}
        selectedScene={selectedScene}
        setSelectedScene={setSelectedScene}
        selectedProps={selectedProps}
        setSelectedProps={setSelectedProps}
        onClose={() => dialogs.close('assetSelector')}
      />

      {/* 分镜图片库 */}
      {dialogs.isOpen('storyboardImageGallery') && (imageGalleryStoryboard || editingStoryboard) && (
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
            dialogs.close('storyboardImageGallery');
            setImageGalleryStoryboard(null);
          }}
          onClose={() => {
            dialogs.close('storyboardImageGallery');
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
      {dialogs.isOpen('imageEdit') && editingStoryboard && (
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
          onClose={() => dialogs.close('imageEdit')}
        />
      )}

      {/* 图片编辑对话框（分镜卡片按钮触发） */}
      {dialogs.isOpen('cardImageEdit') && cardImageEditStoryboard && (
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
            dialogs.close('cardImageEdit');
            setCardImageEditStoryboard(null);
          }}
        />
      )}

      {/* 三宫格提示词弹框 */}
      {dialogs.isOpen('tripleGrid') && editingStoryboard && (
        <TripleGridPromptDialog
          isOpen={dialogs.isOpen('tripleGrid')}
          defaultPrompt={tripleGridPromptTemplate.replace('{description}', editDescription || editingStoryboard.description || '')}
          isGenerating={getTaskStatus(editingStoryboard.asset_id, 'triple_grid') === 'generating'}
          onConfirm={handleGenerateTripleGrid}
          onClose={() => dialogs.close('tripleGrid')}
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
