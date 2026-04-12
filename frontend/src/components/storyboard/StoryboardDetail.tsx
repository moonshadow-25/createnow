import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { assetApi, generationApi, storyboardApi } from '@/services/api';
import { useStoryboardGenerationStore } from '@/store/storyboardGenerationStore';
import { Edit, Trash2, Film, Plus, Sparkles, Play, RefreshCcw, Zap, Loader2, ChevronDown, Download, GripVertical, CheckCircle } from 'lucide-react';
import { VideoGallery } from './VideoGallery';
import { EpisodePlayer } from './EpisodePlayer';
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
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useOneClickGeneration } from './hooks/useOneClickGeneration';
import { useDialogManager } from './hooks/useDialogManager';
import { useVibeDramaStore } from '@/store/vibeDramaStore';
import { useProjectStore } from '@/store/projectStore';
import { useJianyingExport } from './hooks/useJianyingExport';
import { useVideoGeneration } from './hooks/useVideoGeneration';

interface StoryboardDetailProps {
  projectId: string;
  episodes: any[];
  characters: any[];
  scenes: any[];
  props: any[];
  onUpdated: () => void;
  multimodalReference?: boolean;
  showAssetSubmit?: boolean;
}

interface SortableEpisodeButtonProps {
  episode: any;
  displayIndex: number;
  isSelected: boolean;
  onClick: () => void;
}

function SortableEpisodeButton({ episode, displayIndex, isSelected, onClick }: SortableEpisodeButtonProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: episode.asset_id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex flex-col items-center gap-0.5">
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300"
        title="拖拽排序"
      >
        <GripVertical size={12} />
      </div>
      <button
        onClick={onClick}
        className={`w-10 h-10 rounded flex items-center justify-center font-semibold transition ${
          isSelected ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        }`}
        title={`第${displayIndex}集`}
      >
        {displayIndex}
      </button>
    </div>
  );
}

export function StoryboardDetail({
  projectId,
  episodes,
  characters,
  scenes,
  props,
  onUpdated,
  multimodalReference = false,
  showAssetSubmit = false,
}: StoryboardDetailProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // 剪映下载导出 hook
  const { isDownloadExporting, downloadExportProgress, handleExportAllToJiayingDownload } =
    useJianyingExport({ projectId, episodeId: undefined, selectedStoryboardIds: new Set(), toast });

  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  const [orderedEpisodes, setOrderedEpisodes] = useState<any[]>([]);
  const isReorderingEpisodes = useRef(false);
  const [storyboards, setStoryboards] = useState<any[]>([]);
  const [storyboardPrimaryImages, setStoryboardPrimaryImages] = useState<Map<string, string>>(new Map());
  const [imageStatuses, setImageStatuses] = useState<Record<string, { asset_id: string; status: string }>>({});

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

  // 全集预览播放器
  const [episodePlayerVideos, setEpisodePlayerVideos] = useState<
    { storyboardId: string; url: string; sequence: number; description?: string }[]
  >([]);
  const [showEpisodePlayer, setShowEpisodePlayer] = useState(false);

  const openEpisodePlayer = () => {
    const videos = storyboards
      .filter(sb => sb.primary_video_url)
      .map(sb => ({
        storyboardId: sb.asset_id,
        url: sb.primary_video_url,
        sequence: sb.sequence,
        description: sb.description,
      }));
    if (videos.length === 0) return;
    setEpisodePlayerVideos(videos);
    setShowEpisodePlayer(true);
  };

  // 更多菜单
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Vibe Drama：设置上下文 + 订阅资产刷新事件
  const setVibeDramaContext = useVibeDramaStore(s => s.setContext);
  const openVibeDrama = useVibeDramaStore(s => s.open);
  const setPendingMessage = useVibeDramaStore(s => s.setPendingMessage);
  const currentProject = useProjectStore(s => s.currentProject);
  useEffect(() => {
    if (!selectedEpisode || !projectId) return;
    setVibeDramaContext({
      projectId,
      projectName: currentProject?.name || '',
      episodeId: selectedEpisode.asset_id,
      tabName: 'storyboard',
      label: `第${selectedEpisode.episode_number}集`,
    });
  }, [selectedEpisode?.asset_id, selectedEpisode?.episode_number, projectId, currentProject?.name]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === projectId) {
        loadStoryboards();
        onUpdated();
      }
    };
    window.addEventListener('vibe-drama:assets-created', handler);
    return () => window.removeEventListener('vibe-drama:assets-created', handler);
  }, [projectId, selectedEpisode]);

  // 监听审核状态更新事件，重新加载图片状态（更新徽章）
  // 监听审核状态更新事件，重新加载图片状态（更新徽章）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === projectId && storyboards.length > 0) {
        loadImageStatuses(storyboards);
      }
    };
    window.addEventListener('storyboard:review-status-updated', handler);
    return () => window.removeEventListener('storyboard:review-status-updated', handler);
  }, [projectId, storyboards]);

  // 编辑页关闭时重新加载分镜数据（审核状态可能已变化）
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === projectId) {
        loadStoryboards();
      }
    };
    window.addEventListener('storyboard:editor-closed', handler);
    return () => window.removeEventListener('storyboard:editor-closed', handler);
  }, [projectId, selectedEpisode]);

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
  const [selectedScenes, setSelectedScenes] = useState<string[]>([]);
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

  const videoGen = useVideoGeneration({
    projectId,
    episodeId: selectedEpisode?.asset_id || '',
    onSuccess: () => loadStoryboards(),
    characters,
    scenes,
    props,
    multimodalReference,
  });

  // 隐藏图片状态
  const [hiddenImageIds] = useState<Set<string>>(new Set());

  // 状态隔离：跟踪当前编辑的分镜ID，防止异步响应污染其他分镜
  const editingStoryboardIdRef = useRef<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  // 从 episodes prop 同步显示顺序（升序）
  useEffect(() => {
    const sorted = [...episodes].sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0));
    setOrderedEpisodes(sorted);
  }, [episodes]);

  // 当 orderedEpisodes 重建时，仅在没有选中集或选中集已不存在时才默认选第1集
  useEffect(() => {
    if (isReorderingEpisodes.current) return;
    if (orderedEpisodes.length === 0) return;
    const isSelectedValid = selectedEpisode && orderedEpisodes.some(ep => ep.asset_id === selectedEpisode.asset_id);
    if (!isSelectedValid) {
      const targetId = (location.state as any)?.episodeId;
      const target = targetId && orderedEpisodes.find(ep => ep.asset_id === targetId);
      setSelectedEpisode(target || orderedEpisodes[0]);
    }
  }, [orderedEpisodes]);

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

      // 异步加载所有图片的审核状态
      loadImageStatuses(sortedData);

      return sortedData;  // ✅ 返回最新数据供调用者使用
    } catch (error) {
      console.error('Failed to load storyboards:', error);
      setStoryboards([]);
      setStoryboardPrimaryImages(new Map());
      return [];  // 错误时返回空数组
    }
  };

  // 轮询单个素材审核状态，直到不再是 Processing
  const pollAssetStatus = (assetId: string, imageId: string, onComplete?: () => void) => {
    const poll = async () => {
      try {
        const r = await generationApi.getAssetStatus(projectId, assetId);
        setImageStatuses(prev => ({ ...prev, [imageId]: { asset_id: assetId, status: r.data.status } }));
        if (r.data.status === 'Processing') {
          setTimeout(poll, 5000);
        } else {
          onComplete?.();
        }
      } catch {}
    };
    setTimeout(poll, 3000);
  };

  // 加载所有分镜及关联资产的图片审核状态，并对 Processing 的自动启动轮询
  const loadImageStatuses = async (sbs: any[]) => {
    // 先从后端已返回的分镜数据中提取审核状态（无需额外请求）
    const initialUpdates: Record<string, { asset_id: string; status: string }> = {};
    const processingAssetIds: string[] = [];

    for (const sb of sbs) {
      if (sb.volcengine_asset_status && sb.volcengine_asset_id && sb.image_id) {
        // 用 image_id 作为 key，与 StoryboardCard 的查找方式保持一致
        initialUpdates[sb.image_id] = {
          asset_id: sb.volcengine_asset_id,
          status: sb.volcengine_asset_status,
        };
        // 只有 Processing 状态才需要后续轮询
        if (sb.volcengine_asset_status === 'Processing') {
          processingAssetIds.push(sb.asset_id);
        }
      }
    }

    // 设置已知状态
    if (Object.keys(initialUpdates).length > 0) {
      setImageStatuses(prev => ({ ...prev, ...initialUpdates }));
    }

    // 只对 Processing 状态的素材发请求获取详细信息并启动轮询
    if (processingAssetIds.length > 0) {
      const updates: Record<string, { asset_id: string; status: string }> = {};
      await Promise.all(processingAssetIds.map(async (assetId) => {
        try {
          const res = await generationApi.listImages(projectId, assetId);
          const imgs: any[] = res.data || [];
          const primary = imgs.find((i: any) => i.is_primary) || imgs[0];
          if (primary?.image_id) {
            updates[primary.image_id] = {
              asset_id: primary.volcengine_asset_id,
              status: primary.volcengine_asset_status,
            };
          }
        } catch {}
      }));
      setImageStatuses(prev => ({ ...prev, ...updates }));
      for (const [imageId, info] of Object.entries(updates)) {
        if (info.status === 'Processing' && info.asset_id) {
          pollAssetStatus(info.asset_id, imageId);
        }
      }
    }
  };

  // AI 触发提交审核：监听事件，走和手动按钮完全相同的路径，完成后通知 AI
  const storyboardsRef = useRef(storyboards);
  const imageStatusesRef = useRef(imageStatuses);
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => { storyboardsRef.current = storyboards; }, [storyboards]);
  useEffect(() => { imageStatusesRef.current = imageStatuses; }, [imageStatuses]);
  useEffect(() => { onUpdatedRef.current = onUpdated; }, [onUpdated]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const eventDetail = (e as CustomEvent).detail;
      const epId = eventDetail?.episodeId || selectedEpisode?.asset_id;
      console.log(`[StoryboardDetail v2] submit-for-review handler: epId=${epId?.slice(0,8)}`);
      if (eventDetail?.episodeId && selectedEpisode?.asset_id && eventDetail.episodeId !== selectedEpisode.asset_id) return;

      // 从 API 拉取最新资产数据（不依赖可能过期的 state）
      console.log(`[StoryboardDetail v2] fetching fresh asset data from API...`);
      let freshChars: any[] = [];
      let freshScenes: any[] = [];
      let freshProps: any[] = [];
      try {
        const [charRes, sceneRes, propRes] = await Promise.all([
          assetApi.list(projectId, 'character'),
          assetApi.list(projectId, 'scene'),
          assetApi.list(projectId, 'prop'),
        ]);
        freshChars = charRes.data || [];
        freshScenes = sceneRes.data || [];
        freshProps = propRes.data || [];
      } catch (err) {
        console.error('[StoryboardDetail v2] failed to fetch fresh assets:', err);
      }

      const sbs = storyboardsRef.current;
      const statuses = imageStatusesRef.current;
      const isActive = (imageId: string) => statuses[imageId]?.status === 'Active';
      const imageIds: string[] = [];

      // 从所有资产直接收集 image_id（不经过分镜关联）
      for (const char of freshChars) {
        if (char.image_id && !imageIds.includes(char.image_id) && !isActive(char.image_id)) imageIds.push(char.image_id);
      }
      for (const scene of freshScenes) {
        if (scene.image_id && !imageIds.includes(scene.image_id) && !isActive(scene.image_id)) imageIds.push(scene.image_id);
      }
      for (const prop of freshProps) {
        if (prop.image_id && !imageIds.includes(prop.image_id) && !isActive(prop.image_id)) imageIds.push(prop.image_id);
      }
      // 分镜图（如果有）
      for (const sb of sbs) {
        if (sb.image_id && !imageIds.includes(sb.image_id) && !isActive(sb.image_id)) imageIds.push(sb.image_id);
      }

      console.log(`[StoryboardDetail v2] submit-for-review: imageIds=${imageIds.length}, epId=${epId?.slice(0,8)}`);

      if (imageIds.length === 0) {
        console.log(`[StoryboardDetail v2] → all Active, dispatching review-complete`);
        window.dispatchEvent(new CustomEvent('storyboard:review-complete', { detail: { episodeId: epId } }));
        return;
      }

      try {
        const res = await generationApi.submitAsset(projectId, imageIds);
        const submitted: { image_id: string; asset_id: string; status: string }[] = res.data.submitted || [];

        // 刷新前端资产 state，让分镜页面显示最新的图片和审核状态
        onUpdatedRef.current();

        const processingItems = submitted.filter(s => s.status === 'Processing');
        if (processingItems.length === 0) {
          window.dispatchEvent(new CustomEvent('storyboard:review-complete', { detail: { episodeId: epId } }));
          return;
        }

        let remaining = processingItems.length;
        processingItems.forEach(s => {
          pollAssetStatus(s.asset_id, s.image_id, () => {
            remaining--;
            if (remaining === 0) {
              // 全部审核完成，刷新前端 state 让打勾状态正确显示
              onUpdatedRef.current();
              window.dispatchEvent(new CustomEvent('storyboard:review-complete', { detail: { episodeId: epId } }));
            }
          });
        });
      } catch {
        window.dispatchEvent(new CustomEvent('storyboard:review-complete', { detail: { episodeId: epId } }));
      }
    };

    window.addEventListener('storyboard:submit-for-review', handler);
    return () => window.removeEventListener('storyboard:submit-for-review', handler);
  }, [projectId, selectedEpisode?.asset_id]);

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
    handleSetPrimaryStoryboardImage: handleSetPrimaryStoryboardImageBase,
    handleGeneratePrompt: handleGeneratePromptBase,
    handleGenerateImageFromEdit: handleGenerateImageFromEditBase,
    handleAutoMatchAssets: handleAutoMatchAssetsBase,
  } = imageManagement;

  // 包装函数以适配现有调用方式

  const handleSetPrimaryStoryboardImage = (imageId: string) => {
    return handleSetPrimaryStoryboardImageBase(editingStoryboard, imageId, setStoryboardImages);
  };

  const handleGeneratePrompt = async () => {
    await saveCurrentStoryboard();
    return handleGeneratePromptBase(
      editingStoryboard,
      selectedCharacters,
      selectedScenes,
      selectedProps,
      characters,
      scenes,
      props,
      setGeneratedPrompt
    );
  };

  const handleGenerateImageFromEdit = async () => {
    await saveCurrentStoryboard();
    return handleGenerateImageFromEditBase(
      editingStoryboard,
      generatedPrompt,
      selectedCharacters,
      selectedScenes,
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
  const handleGenerateTripleGrid = async (prompt: string) => {
    await saveCurrentStoryboard();
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
    getEligibleCount,
    handleOneClickGenerate
  } = oneClickGeneration;


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

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedStoryboardIds);
    try {
      for (const id of ids) {
        await storyboardApi.delete(projectId, id);
      }
      setSelectedStoryboardIds(new Set());
      loadStoryboards();
      onUpdated();
      toast(`已删除 ${ids.length} 个分镜`, 'success');
    } catch (error: any) {
      toast(`删除失败: ${error.response?.data?.detail || error.message}`, 'error');
      loadStoryboards();
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
    setSelectedScenes([]);
    setSelectedProps([]);
    setGeneratedPrompt('');
    resetEditState(); // 使用 hook 的重置函数
    setStoryboardImages([]);
    setStoryboardEditInitialTab('edit');
    dialogs.open('storyboardEdit');
  };

  const handleEditStoryboard = (storyboard: any) => {
    const epId = selectedEpisode?.asset_id || '';
    navigate(`/project/${projectId}/storyboard/${storyboard.asset_id}/edit${epId ? `?episodeId=${epId}` : ''}`);
  };

  const handleAutoMatchAssets = () => {
    if (!editingStoryboard) {
      toast('请先保存分镜再使用自动匹配', 'info');
      return;
    }
    return handleAutoMatchAssetsBase(editingStoryboard, setSelectedScenes, setSelectedCharacters, setSelectedProps);
  };

  const handleImagePromptChange = (newPrompt: string) => {
    setGeneratedPrompt(newPrompt);
  };

  // 统一保存当前分镜所有字段
  const saveCurrentStoryboard = async () => {
    if (!editingStoryboard) return;
    setIsSaving(true);
    try {
      const data: any = {
        description: editDescription.trim(),
        dialogue: editDialogue.trim(),
        action: editAction.trim(),
        shot_type: editShotType,
        camera_angle: editCameraAngle,
        duration: contentEdit.editDuration,
        resolution: contentEdit.editResolution,
        character_ids: selectedCharacters,
        scene_ids: selectedScenes,
        prop_ids: selectedProps,
        image_prompt: generatedPrompt.trim(),
        video_prompt: videoGen.videoPrompt,
      };
      await storyboardApi.update(projectId, editingStoryboard.asset_id, data);
    } finally {
      setIsSaving(false);
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
      baseData.scene_ids = selectedScenes;
      baseData.prop_ids = selectedProps;
      if (generatedPrompt.trim()) baseData.image_prompt = generatedPrompt.trim();
      baseData.duration = contentEdit.editDuration;
      baseData.resolution = contentEdit.editResolution;

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

  const handleEpisodeDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedEpisodes.findIndex(ep => ep.asset_id === active.id);
    const newIndex = orderedEpisodes.findIndex(ep => ep.asset_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = arrayMove(orderedEpisodes, oldIndex, newIndex);
    isReorderingEpisodes.current = true;
    setOrderedEpisodes(newOrder);
    setTimeout(() => { isReorderingEpisodes.current = false; }, 0);

    try {
      await assetApi.reorderEpisodes(projectId, newOrder.map(ep => ep.asset_id));
      onUpdated();
    } catch (error) {
      console.error('Failed to reorder episodes:', error);
      const restored = [...episodes].sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0));
      isReorderingEpisodes.current = true;
      setOrderedEpisodes(restored);
      setTimeout(() => { isReorderingEpisodes.current = false; }, 0);
    }
  };

  const selectedEpisodeDisplayIndex = selectedEpisode
    ? orderedEpisodes.findIndex(ep => ep.asset_id === selectedEpisode.asset_id) + 1
    : 0;

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* 左侧：剧集数字按钮 */}
      <div className="bg-gray-800 rounded-lg p-2 overflow-y-auto flex-shrink-0">
        <div className="flex flex-col gap-1">
          <DndContext collisionDetection={closestCenter} onDragEnd={handleEpisodeDragEnd}>
            <SortableContext items={orderedEpisodes.map(ep => ep.asset_id)} strategy={verticalListSortingStrategy}>
              {orderedEpisodes.map((episode, index) => (
                <SortableEpisodeButton
                  key={episode.asset_id}
                  episode={episode}
                  displayIndex={index + 1}
                  isSelected={selectedEpisode?.asset_id === episode.asset_id}
                  onClick={() => setSelectedEpisode(episode)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {/* 新增剧集按钮 */}
          <button
            onClick={handleAddEpisode}
            className="w-10 h-10 rounded flex items-center justify-center font-semibold transition bg-green-600 hover:bg-green-700 text-white text-xl"
            title="新增剧集"
          >
            +
          </button>
          {orderedEpisodes.length === 0 && (
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
                <h3 className="text-xl font-semibold">第{selectedEpisodeDisplayIndex}集</h3>
                <p className="text-sm text-gray-400 mt-1">{selectedEpisode.description || ''}</p>
              </div>
              <div className="flex gap-2 items-center">
              {/* 一键生成本集 */}
                <button
                  onClick={() => {
                    if (selectedEpisode) {
                      setVibeDramaContext({
                        projectId,
                        projectName: currentProject?.name || '',
                        episodeId: selectedEpisode.asset_id,
                        tabName: 'storyboard',
                        label: `第${selectedEpisode.episode_number}集`,
                      });
                      openVibeDrama();
                      setPendingMessage({ key: `${projectId}_${selectedEpisode.asset_id}`, message: '自动生成本集' });
                    }
                  }}
                  className="flex items-center gap-1 text-sm px-3 py-2 rounded bg-purple-600 hover:bg-purple-700"
                >
                  <Sparkles size={14} />
                  一键生成本集
                </button>

                {/* 视频库 */}
                <button
                  onClick={() => dialogs.open('videoGallery')}
                  className="flex items-center gap-1 text-sm bg-green-600 hover:bg-green-700 px-3 py-2 rounded"
                >
                  <Play size={14} />
                  视频库
                </button>

                {/* 预览全集 */}
                <button
                  onClick={openEpisodePlayer}
                  disabled={storyboards.every(sb => !sb.primary_video_url)}
                  className="flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                  title="顺序播放本集所有分镜视频"
                >
                  <Play size={14} />
                  预览全集
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
                    <div className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 py-1">
                      {/* 一键生成分镜图 */}
                      <button
                        onClick={() => {
                          setShowMoreMenu(false);
                          const n = getEligibleCount();
                          if (n === 0) { toast('暂无可生成的分镜（请先为分镜添加图片提示词）', 'info'); return; }
                          if (confirm(`共 ${n} 个分镜有图片提示词，将生成 ${n} 张图，确认？`)) handleOneClickGenerate();
                        }}
                        disabled={isOneClickGenerating || storyboards.length === 0}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isOneClickGenerating ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                        {isOneClickGenerating ? '一键生成中...' : '一键生成分镜图'}
                      </button>
                      {/* 一键提交审核 */}
                      <button
                        onClick={() => {
                          setShowMoreMenu(false);
                          const isActive = (imageId: string) => imageStatuses[imageId]?.status === 'Active';
                          const imageIds: string[] = [];
                          for (const sb of storyboards) {
                            if (sb.image_id && !imageIds.includes(sb.image_id) && !isActive(sb.image_id)) imageIds.push(sb.image_id);
                            for (const charId of (sb.character_ids || [])) {
                              const char = characters.find((c: any) => c.asset_id === charId);
                              if (char?.image_id && !imageIds.includes(char.image_id) && !isActive(char.image_id)) imageIds.push(char.image_id);
                            }
                            const sceneIds = sb.scene_ids?.length ? sb.scene_ids : (sb.scene_id ? [sb.scene_id] : []);
                            for (const sceneId of sceneIds) {
                              const scene = scenes.find((s: any) => s.asset_id === sceneId);
                              if (scene?.image_id && !imageIds.includes(scene.image_id) && !isActive(scene.image_id)) imageIds.push(scene.image_id);
                            }
                            for (const propId of (sb.prop_ids || [])) {
                              const prop = props.find((p: any) => p.asset_id === propId);
                              if (prop?.image_id && !imageIds.includes(prop.image_id) && !isActive(prop.image_id)) imageIds.push(prop.image_id);
                            }
                          }
                          if (imageIds.length === 0) { toast('没有可提交的图片', 'info'); return; }
                          if (!confirm(`将提交 ${imageIds.length} 张图片（分镜图 + 关联资产）审核，继续？`)) return;
                          (async () => {
                            try {
                              const res = await generationApi.submitAsset(projectId, imageIds);
                              const submitted: { image_id: string; asset_id: string; status: string }[] = res.data.submitted || [];
                              toast('素材提交成功', 'success');
                              submitted.filter(s => s.status === 'Processing').forEach(s => pollAssetStatus(s.asset_id, s.image_id));
                            } catch { toast('提交审核失败', 'error'); }
                          })();
                        }}
                        disabled={storyboards.length === 0}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Sparkles size={14} />
                        一键提交审核
                      </button>
                      {/* 一键生成视频 */}
                      <button
                        onClick={() => {
                          setShowMoreMenu(false);
                          const eligible = storyboards.filter(sb => !sb.primary_video_url && sb.video_prompt);
                          if (eligible.length === 0) { toast('暂无可生成的分镜（请先为分镜添加视频提示词）', 'info'); return; }
                          if (!confirm(`共 ${eligible.length} 个分镜有视频提示词，将生成 ${eligible.length} 个视频，确认？`)) return;
                          (async () => {
                            let ok = 0, fail = 0;
                            const batches = Array.from({ length: Math.ceil(eligible.length / 5) }, (_, i) =>
                              eligible.slice(i * 5, i * 5 + 5)
                            );
                            for (const batch of batches) {
                              await Promise.allSettled(batch.map(async (sb: any) => {
                                try {
                                  await generationApi.generateVideo(projectId, {
                                    storyboard_id: sb.asset_id,
                                    episode_id: selectedEpisode!.asset_id,
                                    prompt: sb.video_prompt,
                                    duration: sb.duration || 5,
                                    resolution: sb.resolution || '1920x1080',
                                  });
                                  ok++;
                                } catch { fail++; }
                              }));
                            }
                            toast(fail > 0 ? `视频生成任务已提交: ${ok} 成功, ${fail} 失败` : `已提交 ${ok} 个视频生成任务`, fail > 0 ? 'info' : 'success');
                          })();
                        }}
                        disabled={storyboards.length === 0}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Film size={14} />
                        一键生成视频
                      </button>
                      {/* 导出到剪映 */}
                      <button
                        onClick={() => { setShowMoreMenu(false); selectedEpisode && handleExportAllToJiayingDownload(selectedEpisode.asset_id); }}
                        disabled={isDownloadExporting || !selectedEpisode}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isDownloadExporting ? (
                          <>
                            <div className="animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                            {downloadExportProgress > 0 ? `导出中 ${downloadExportProgress}%` : '导出中...'}
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            导出到剪映
                          </>
                        )}
                      </button>
                      <div className="border-t border-gray-600 my-1" />
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
                          {uniqueCharacters.map((char: any) => {
                            const status = char.volcengine_asset_status || (char.image_id ? imageStatuses[char.image_id]?.status : undefined);
                            return (
                              <span key={char.asset_id} className="bg-blue-900 text-blue-300 px-2 py-1 rounded text-xs flex items-center gap-1">
                                {char.name}
                                {status === 'Active' && <CheckCircle size={10} className="text-green-400" />}
                                {status === 'Processing' && <Loader2 size={10} className="animate-spin text-yellow-400" />}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* 收集所有分镜的场景 */}
                  {(() => {
                    const uniqueSceneIds = new Set<string>();
                    storyboards.forEach(sb => {
                      // 兼容旧的 scene_id 和新的 scene_ids 两种格式
                      if (sb.scene_ids?.length) {
                        sb.scene_ids.forEach((id: string) => uniqueSceneIds.add(id));
                      } else if (sb.scene_id) {
                        uniqueSceneIds.add(sb.scene_id);
                      }
                    });
                    const uniqueScenes = Array.from(uniqueSceneIds)
                      .map(id => scenes.find(s => s.asset_id === id))
                      .filter(Boolean);
                    return uniqueScenes.length > 0 ? (
                      <div>
                        <span className="text-gray-400">场景:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {uniqueScenes.map((scene: any) => {
                            const status = scene.volcengine_asset_status || (scene.image_id ? imageStatuses[scene.image_id]?.status : undefined);
                            return (
                              <span key={scene.asset_id} className="bg-green-900 text-green-300 px-2 py-1 rounded text-xs flex items-center gap-1">
                                {scene.name}
                                {status === 'Active' && <CheckCircle size={10} className="text-green-400" />}
                                {status === 'Processing' && <Loader2 size={10} className="animate-spin text-yellow-400" />}
                              </span>
                            );
                          })}
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
                          {uniqueProps.map((prop: any) => {
                            const status = prop.volcengine_asset_status || (prop.image_id ? imageStatuses[prop.image_id]?.status : undefined);
                            return (
                              <span key={prop.asset_id} className="bg-purple-900 text-purple-300 px-2 py-1 rounded text-xs flex items-center gap-1">
                                {prop.name}
                                {status === 'Active' && <CheckCircle size={10} className="text-green-400" />}
                                {status === 'Processing' && <Loader2 size={10} className="animate-spin text-yellow-400" />}
                              </span>
                            );
                          })}
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
                      imageStatuses={imageStatuses}
                      onEdit={handleEditStoryboard}
                      onDelete={handleDeleteStoryboard}
                      onOpenImageGallery={handleOpenImageGallery}
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

      {/* 全集预览播放器 */}
      {showEpisodePlayer && (
        <EpisodePlayer
          videos={episodePlayerVideos}
          onClose={() => setShowEpisodePlayer(false)}
        />
      )}

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
        selectedScenes={selectedScenes}
        setSelectedScenes={setSelectedScenes}
        characters={characters}
        scenes={scenes}
        props={props}
        onOpenAssetSelector={() => dialogs.open('assetSelector')}
        onAutoMatchAssets={handleAutoMatchAssets}
        generatedPrompt={generatedPrompt}
        setGeneratedPrompt={setGeneratedPrompt}
        onImagePromptChange={handleImagePromptChange}
        onGeneratePrompt={handleGeneratePrompt}
        videoGen={videoGen}
        isSaving={isSaving}
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
        onClose={async () => {
          await saveCurrentStoryboard();
          dialogs.close('storyboardEdit');
          setEditingStoryboardId(null);
          editingStoryboardIdRef.current = null;
        }}
        onSaveBeforeGenerate={saveCurrentStoryboard}
        onSuccess={() => loadStoryboards()}
        onRefreshImages={async () => {
          if (!editingStoryboard) return;
          try {
            const response = await generationApi.listImages(projectId, editingStoryboard.asset_id);
            const sortedImages = (response.data || []).sort((a: any, b: any) => {
              if (a.is_primary && !b.is_primary) return -1;
              if (!a.is_primary && b.is_primary) return 1;
              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });
            setStoryboardImages(sortedImages);
          } catch {}
        }}
        multimodalReference={multimodalReference}
        showAssetSubmit={showAssetSubmit}
      />

      {/* 统一资产选择弹框 */}
      <AssetSelectorDialog
        show={dialogs.isOpen('assetSelector')}
        projectId={projectId}
        characters={characters}
        scenes={scenes}
        props={props}
        selectedCharacters={selectedCharacters}
        setSelectedCharacters={setSelectedCharacters}
        selectedScenes={selectedScenes}
        setSelectedScenes={setSelectedScenes}
        selectedProps={selectedProps}
        setSelectedProps={setSelectedProps}
        onClose={() => dialogs.close('assetSelector')}
        onAssetsAdded={onUpdated}
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
          onDeleteSelected={handleDeleteSelected}
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
