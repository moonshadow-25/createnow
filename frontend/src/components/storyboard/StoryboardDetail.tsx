import { useState, useEffect, useRef } from 'react';
import { assetApi, generationApi, storyboardApi } from '@/services/api';
import { useStoryboardGenerationStore } from '@/store/storyboardGenerationStore';
import { Edit, Trash2, Film, Plus, Sparkles, Play, RefreshCcw } from 'lucide-react';
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
  const [dialogType, setDialogType] = useState<'insert' | 'inbetween' | 'multi_fusion' | 'first_last_video' | null>(null);
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
  const handleOpenDialog = (type: 'insert' | 'inbetween' | 'multi_fusion' | 'first_last_video') => {
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
    if (!selectedEpisode) return;

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
    } catch (error) {
      console.error('Failed to load storyboards:', error);
      setStoryboards([]);
      setStoryboardPrimaryImages(new Map());
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
  const { executeInsertStoryboard, executeMultiImageFusion, executeInsertInbetween, executeFirstLastVideo, executeCreateEndFrame } = batchOps;

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
    <div className="flex gap-4 h-full">
      {/* 左侧：剧集数字按钮 */}
      <div className="bg-gray-800 rounded-lg p-2 overflow-y-auto">
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
          {episodes.length === 0 && (
            <div className="text-gray-500 text-xs p-2 text-center w-10">
              空
            </div>
          )}
        </div>
      </div>

      {/* 右侧：分镜详情 */}
      <div className="flex-1 bg-gray-800 rounded-lg p-4 overflow-y-auto">
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

      {/* 视频库 */}
      {showVideoGallery && (
        <VideoGallery
          projectId={projectId}
          episodeId={selectedEpisode?.asset_id}
          onClose={() => setShowVideoGallery(false)}
          storyboardCount={storyboards.length}
          loadStoryboards={loadStoryboards}
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
      {showStoryboardImageGallery && editingStoryboard && (
        <ImageGallery
          images={storyboardImages}
          assetName={`分镜 ${editingStoryboard.sequence}`}
          assetId={editingStoryboard.asset_id}
          projectId={projectId}
          assetType="storyboard"
          onSelectPrimary={async (imageId) => {
            await handleSetPrimaryStoryboardImage(imageId);
            setShowStoryboardImageGallery(false);
          }}
          onClose={() => setShowStoryboardImageGallery(false)}
          onImagesUpdated={async () => {
            // 重新加载分镜图片列表
            if (editingStoryboard) {
              const response = await generationApi.listImages(projectId, editingStoryboard.asset_id);
              const sortedImages = (response.data || []).sort((a: any, b: any) => {
                if (a.is_primary && !b.is_primary) return -1;
                if (!a.is_primary && b.is_primary) return 1;
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              });
              setStoryboardImages(sortedImages);
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
