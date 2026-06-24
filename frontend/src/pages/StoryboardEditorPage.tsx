import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Plus, Sparkles, Wand2, ImagePlus, Edit3,
  CheckCircle, Loader2, Upload, Download, Film,
  Video, X, ChevronDown, ChevronRight, RefreshCcw,
} from 'lucide-react';
import { assetApi, generationApi, storyboardApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import { useStoryboardGenerationStore } from '@/store/storyboardGenerationStore';
import { useStoryboardContentEdit } from '@/components/storyboard/hooks/useStoryboardContentEdit';
import { useStoryboardImageManagement } from '@/components/storyboard/hooks/useStoryboardImageManagement';
import { useVideoGeneration } from '@/components/storyboard/hooks/useVideoGeneration';
import { AssetSelectorDialog } from '@/components/storyboard/AssetSelectorDialog';
import { ImageGallery } from '@/components/assets/ImageGallery';
import { ImageEditDialog } from '@/components/common/ImageEditDialog';
import { VideoGallery } from '@/components/storyboard/VideoGallery';
import { getImageUrl, getVideoUrl } from '@/components/storyboard/utils/mediaUtils';
import { useVibeDramaStore } from '@/store/vibeDramaStore';
import { useProjectStore } from '@/store/projectStore';
import { useThemeStore } from '@/store/themeStore';
import { useCreatenowModelConfigStore, IMAGE_SIZE_OPTIONS, VIDEO_RATIO_OPTIONS, VIDEO_RESOLUTION_OPTIONS } from '@/store/createnowModelConfigStore';
import { getUsedAssetIdsForEpisode } from '@/utils/assetTags';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AssetStatus {
  asset_id?: string;
  status?: string;
  image_id?: string;
}

interface GalleryState {
  show: boolean;
  assetId: string;
  assetType: string;
  assetName: string;
  images: any[];
}

function getImageSizeLabel(value: string): string {
  return IMAGE_SIZE_OPTIONS.find(option => option.value === value)?.label || value || '图片比例';
}

function getVideoRatioLabel(value: string): string {
  return VIDEO_RATIO_OPTIONS.find(option => option.value === value)?.label || value || '视频比例';
}

function getVideoResolutionLabel(value: string): string {
  return VIDEO_RESOLUTION_OPTIONS.find(option => option.value === value)?.label || value || '分辨率';
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StoryboardEditorPage() {
  const { projectId = '', storyboardId = '' } = useParams<{ projectId: string; storyboardId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { startTask, completeTask, failTask, hasRunningTask, getTaskStatus } = useStoryboardGenerationStore();

  // ── VibeDrama ───────────────────────────────────────────────────────────────
  const setVibeDramaContext = useVibeDramaStore(s => s.setContext);
  const openVibeDrama = useVibeDramaStore(s => s.open);
  const setPendingMessage = useVibeDramaStore(s => s.setPendingMessage);
  const setMessagePrefix = useVibeDramaStore(s => s.setMessagePrefix);
  const currentProject = useProjectStore(s => s.currentProject);
  const appearanceMode = useThemeStore(s => s.appearanceMode);
  const createnowModelConfig = useCreatenowModelConfigStore(s => s.config);

  // ── Core state ──────────────────────────────────────────────────────────────
  const [storyboard, setStoryboard] = useState<any>(null);
  const [storyboardList, setStoryboardList] = useState<any[]>([]);
  const [episodeId, setEpisodeId] = useState(searchParams.get('episodeId') || '');
  const [loading, setLoading] = useState(true);
  const [characters, setCharacters] = useState<any[]>([]);
  const [scenes, setScenes] = useState<any[]>([]);
  const [props, setProps] = useState<any[]>([]);
  const [storyboardImages, setStoryboardImages] = useState<any[]>([]);
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(new Set());
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [selectedScenes, setSelectedScenes] = useState<string[]>([]);
  const [selectedProps, setSelectedProps] = useState<string[]>([]);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [assetImageStatuses, setAssetImageStatuses] = useState<Record<string, AssetStatus>>({});
  const [assetSubmitting, setAssetSubmitting] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'pending'>('saved');
  const [contentExpanded, setContentExpanded] = useState(true);
  const [showAssetSelector, setShowAssetSelector] = useState(false);
  const [showImageEdit, setShowImageEdit] = useState(false);
  const [galleryState, setGalleryState] = useState<GalleryState>({ show: false, assetId: '', assetType: '', assetName: '', images: [] });
  const [showVideoGallery, setShowVideoGallery] = useState(false);
  const [insertingTransitionFrame, setInsertingTransitionFrame] = useState(false);
  const [hasPreviousStoryboardVideo, setHasPreviousStoryboardVideo] = useState(false);
  const [selectedStoryboardReferenceImageIds, setSelectedStoryboardReferenceImageIds] = useState<string[]>([]);
  const [selectedImageModel, setSelectedImageModel] = useState(createnowModelConfig.default_models.image || 'nova-pro');
  const [selectedVideoModel, setSelectedVideoModel] = useState(createnowModelConfig.default_models.video || 'nova-pro');
  const [selectedImageSize, setSelectedImageSize] = useState('16x9');
  const [selectedVideoRatio, setSelectedVideoRatio] = useState('16:9');
  const [showImageSizeMenu, setShowImageSizeMenu] = useState(false);
  const [showVideoRatioMenu, setShowVideoRatioMenu] = useState(false);
  const [showVideoResolutionMenu, setShowVideoResolutionMenu] = useState(false);
  const [showImageModelMenu, setShowImageModelMenu] = useState(false);
  const [showVideoModelMenu, setShowVideoModelMenu] = useState(false);
  const selectedStoryboardReferenceImageIdsRef = useRef<string[]>([]);
  const imageApiType = currentProject?.ai_config?.image?.api_type;
  const videoApiType = currentProject?.ai_config?.video?.api_type;
  const showImageModelSelect = imageApiType === 'createnow';
  const showVideoModelSelect = videoApiType === 'createnow';
  const [svgPaths, setSvgPaths] = useState<Array<{ d: string; stroke: string }>>([]);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const isInitializedRef = useRef(false);
  const isReloadingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assetSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const storyboardImgRef = useRef<HTMLDivElement>(null);
  const assetNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const videoNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const assetStatusPollingRef = useRef<Set<string>>(new Set());
  // Latest values refs (for auto-save closures)
  const latestTextRef = useRef<any>({});
  const latestAssetsRef = useRef({ selectedCharacters: [] as string[], selectedScenes: [] as string[], selectedProps: [] as string[] });
  const assetStatusesRef = useRef<Record<string, AssetStatus>>({});
  const primaryImageRef = useRef<any>(null);

  // ── Content edit hook ───────────────────────────────────────────────────────
  const contentEdit = useStoryboardContentEdit();
  const {
    editDescription, setEditDescription,
    editScriptSceneLabel, setEditScriptSceneLabel,
    editDialogue, setEditDialogue,
    editAction, setEditAction,
    editShotType,
    editCameraAngle,
    editDuration, setEditDuration,
    editResolution, setEditResolution,
    resetEditState,
  } = contentEdit;

  // ── Video generation hook ───────────────────────────────────────────────────
  const videoGen = useVideoGeneration({
    projectId,
    episodeId,
    onSuccess: () => reloadStoryboard(),
    characters,
    scenes,
    props,
    selectedStoryboardReferenceImageIds,
    multimodalReference: true,
  });

  // ── Image management hook ───────────────────────────────────────────────────
  const reloadStoryboard = useCallback(async () => {
    if (!projectId || !storyboardId) return;
    isReloadingRef.current = true;
    try {
      const [sbRes, imgRes] = await Promise.all([
        assetApi.get(projectId, 'storyboard', storyboardId),
        generationApi.listImages(projectId, storyboardId),
      ]);
      const sb = sbRes.data;
      if (sb) {
        setStoryboard(sb);
        setGeneratedPrompt(sb.image_prompt || '');
        setSelectedStoryboardReferenceImageIds(Array.isArray(sb.reference_image_ids) ? sb.reference_image_ids : []);
        latestTextRef.current = { ...latestTextRef.current, generatedPrompt: sb.image_prompt || '' };
      }
      const sorted = (imgRes.data || []).sort((a: any, b: any) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setStoryboardImages(sorted);
    } catch {} finally {
      // 延迟重置，确保 setGeneratedPrompt 触发的 scheduleSave useEffect 已跳过
      setTimeout(() => { isReloadingRef.current = false; }, 2000);
    }
  }, [projectId, storyboardId]);

  const imageManagement = useStoryboardImageManagement({
    projectId, toast, startTask, completeTask, failTask,
    loadStoryboards: reloadStoryboard as any,
  });

  // ── Merged storyboard (current form values layered on top) ─────────────────
  const mergedStoryboard = useMemo(() => storyboard ? {
    ...storyboard,
    description: editDescription,
    script_scene_label: editScriptSceneLabel,
    dialogue: editDialogue,
    action: editAction,
    shot_type: editShotType,
    camera_angle: editCameraAngle,
    duration: editDuration,
    resolution: editResolution,
    character_ids: selectedCharacters,
    scene_ids: selectedScenes,
    prop_ids: selectedProps,
  } : null, [storyboard, editDescription, editScriptSceneLabel, editDialogue, editAction, editShotType, editCameraAngle, editDuration, editResolution, selectedCharacters, selectedScenes, selectedProps]);

  const usedAssetIdsByType = useMemo(
    () => getUsedAssetIdsForEpisode(storyboardList, episodeId),
    [storyboardList, episodeId]
  );

  // ── Sync latest refs ────────────────────────────────────────────────────────
  useEffect(() => {
    latestTextRef.current = { editDescription, editScriptSceneLabel, editDialogue, editAction, editShotType, editCameraAngle, editDuration, editResolution, generatedPrompt, videoPrompt: videoGen.videoPrompt };
  }, [editDescription, editScriptSceneLabel, editDialogue, editAction, editShotType, editCameraAngle, editDuration, editResolution, generatedPrompt, videoGen.videoPrompt]);

  useEffect(() => {
    latestAssetsRef.current = { selectedCharacters, selectedScenes, selectedProps };
  }, [selectedCharacters, selectedScenes, selectedProps]);

  useEffect(() => {
    selectedStoryboardReferenceImageIdsRef.current = selectedStoryboardReferenceImageIds;
  }, [selectedStoryboardReferenceImageIds]);

  useEffect(() => {
    assetStatusesRef.current = assetImageStatuses;
  }, [assetImageStatuses]);

  useEffect(() => {
    if (createnowModelConfig.default_models.image) setSelectedImageModel(createnowModelConfig.default_models.image);
    if (createnowModelConfig.default_models.video) setSelectedVideoModel(createnowModelConfig.default_models.video);
  }, [createnowModelConfig.default_models.image, createnowModelConfig.default_models.video]);

  // ── VibeDrama context + storyboard:tool-updated listener ───────────────────
  useEffect(() => {
    if (!storyboard || !projectId) return;
    setVibeDramaContext({
      projectId,
      projectName: currentProject?.name || '',
      episodeId: storyboard.episode_id || '',
      tabName: 'storyboard',
      label: `分镜 #${storyboard.sequence}`,
    });
    setMessagePrefix(`当前分镜：分镜 #${storyboard.sequence}，storyboard_id='${storyboard.asset_id}'`);
  }, [storyboard?.asset_id, storyboard?.sequence, projectId, currentProject?.name]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.storyboard_ids) return;
      if (detail.storyboard_ids.length === 0 || detail.storyboard_ids.includes(storyboardId)) {
        reloadStoryboard();
      }
    };
    window.addEventListener('storyboard:tool-updated', handler);
    return () => window.removeEventListener('storyboard:tool-updated', handler);
  }, [storyboardId, reloadStoryboard]);

  // 编辑页卸载时通知分镜列表页刷新数据（审核状态可能已变化）
  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('storyboard:editor-closed', { detail: { projectId } }));
    };
  }, [projectId]);

  // 编辑页卸载时通知分镜列表页刷新数据
  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('storyboard:editor-closed', { detail: { projectId } }));
    };
  }, [projectId]);

  // ── Initial data load ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId || !storyboardId) return;
    (async () => {
      setLoading(true);
      try {
        const [sbRes, charRes, sceneRes, propRes, imgRes] = await Promise.all([
          assetApi.get(projectId, 'storyboard', storyboardId),
          assetApi.list(projectId, 'character'),
          assetApi.list(projectId, 'scene'),
          assetApi.list(projectId, 'prop'),
          generationApi.listImages(projectId, storyboardId),
        ]);
        const sb = sbRes.data;
        setStoryboard(sb);
        const ep = sb?.episode_id || searchParams.get('episodeId') || '';
        setEpisodeId(ep);
        if (ep) {
          try {
            const listRes = await storyboardApi.list(projectId, ep);
            const sortedStoryboards = (listRes.data || []).sort((a: any, b: any) => Number(a.sequence || 0) - Number(b.sequence || 0));
            setStoryboardList(sortedStoryboards);
          } catch {
            setStoryboardList([]);
          }
        } else {
          setStoryboardList([]);
        }
        setCharacters(charRes.data || []);
        setScenes(sceneRes.data || []);
        setProps(propRes.data || []);
        // Initialize form fields
        resetEditState(sb);
        setSelectedCharacters(sb?.character_ids || []);
        setSelectedScenes(sb?.scene_ids?.length ? sb.scene_ids : (sb?.scene_id ? [sb.scene_id] : []));
        setSelectedProps(sb?.prop_ids || []);
        setGeneratedPrompt(sb?.image_prompt || '');
        setSelectedStoryboardReferenceImageIds(Array.isArray(sb?.reference_image_ids) ? sb.reference_image_ids : []);
        // Images
        const imgs = (imgRes.data || []).sort((a: any, b: any) => {
          if (a.is_primary && !b.is_primary) return -1;
          if (!a.is_primary && b.is_primary) return 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        setStoryboardImages(imgs);
        const storageKey = `hidden_images_${storyboardId}`;
        const stored = localStorage.getItem(storageKey);
        if (stored) { try { setHiddenImageIds(new Set(JSON.parse(stored))); } catch {} }
        // Init image management state isolation
        imageManagement.setEditingStoryboardId(storyboardId);
        // Mark initialized after a tick
        setTimeout(() => { isInitializedRef.current = true; }, 100);
      } catch (e) {
        console.error('Failed to load storyboard:', e);
        toast('加载分镜失败', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [storyboardId, projectId]); // eslint-disable-line

  // ── Init videoGen when storyboard+episodeId ready ──────────────────────────
  useEffect(() => {
    if (storyboard && episodeId) {
      videoGen.initForStoryboard(storyboard);
    }
  }, [storyboard?.asset_id, storyboard?.video_prompt, episodeId]); // eslint-disable-line

  useEffect(() => {
    if (!projectId || !storyboardId || !storyboard?.episode_id || !storyboard?.sequence) {
      setHasPreviousStoryboardVideo(false);
      return;
    }

    let disposed = false;
    (async () => {
      try {
        const listRes = await storyboardApi.list(projectId, storyboard.episode_id);
        const all = (listRes.data || []) as any[];
        const prev = all.find(sb => Number(sb.sequence) === Number(storyboard.sequence) - 1);
        if (!disposed) {
          setHasPreviousStoryboardVideo(!!prev?.primary_video_url);
        }
      } catch {
        if (!disposed) setHasPreviousStoryboardVideo(false);
      }
    })();

    return () => { disposed = true; };
  }, [projectId, storyboardId, storyboard?.episode_id, storyboard?.sequence]);

  // ── Reload assets (after AssetSelectorDialog creates new asset) ─────────────
  const reloadAssets = useCallback(async () => {
    try {
      const [charRes, sceneRes, propRes] = await Promise.all([
        assetApi.list(projectId, 'character'),
        assetApi.list(projectId, 'scene'),
        assetApi.list(projectId, 'prop'),
      ]);
      setCharacters(charRes.data || []);
      setScenes(sceneRes.data || []);
      setProps(propRes.data || []);
    } catch {}
  }, [projectId]);

  // ── Load volcengine statuses for all selected assets ───────────────────────
  const loadAssetImageStatuses = useCallback(async (charIds: string[], sceneIds: string[], propIds: string[]) => {
    const allIds = [...charIds, ...sceneIds, ...propIds];
    if (allIds.length === 0) return;

    const allAssets = [...characters, ...scenes, ...props];
    const updates: Record<string, AssetStatus> = {};
    const processingAssets: Array<{ localId: string; assetId: string; imageId?: string }> = [];

    for (const localId of allIds) {
      const asset = allAssets.find(a => a.asset_id === localId);
      if (!asset) continue;
      updates[localId] = {
        asset_id: asset.volcengine_asset_id,
        status: asset.volcengine_asset_status,
        image_id: asset.image_id,
      };
      if (asset.volcengine_asset_status === 'Processing' && asset.volcengine_asset_id) {
        processingAssets.push({
          localId,
          assetId: asset.volcengine_asset_id,
          imageId: asset.image_id,
        });
      }
    }
    setAssetImageStatuses(prev => ({ ...prev, ...updates }));

    const pollAssetStatus = async (localId: string, assetId: string, imageId?: string) => {
      if (assetStatusPollingRef.current.has(assetId)) return;
      assetStatusPollingRef.current.add(assetId);

      const poll = async () => {
        try {
          const res = await generationApi.getAssetStatus(projectId, assetId);
          const status = res.data.status;
          const nextImageId = res.data.image_id || imageId;
          setAssetImageStatuses(prev => ({
            ...prev,
            [localId]: { asset_id: assetId, status, image_id: nextImageId },
            ...(nextImageId ? { [nextImageId]: { asset_id: assetId, status, image_id: nextImageId } } : {}),
          }));
          if (status === 'Processing') {
            setTimeout(poll, 5000);
          } else {
            assetStatusPollingRef.current.delete(assetId);
            await reloadAssets();
            await reloadStoryboard();
          }
        } catch {
          assetStatusPollingRef.current.delete(assetId);
        }
      };

      await poll();
    };

    await Promise.all(processingAssets.map(item => pollAssetStatus(item.localId, item.assetId, item.imageId)));
  }, [projectId, characters, scenes, props, reloadAssets, reloadStoryboard]);

  // Load statuses when selected assets change
  useEffect(() => {
    if (!isInitializedRef.current && !storyboard) return;
    loadAssetImageStatuses(selectedCharacters, selectedScenes, selectedProps);
  }, [selectedCharacters.join(','), selectedScenes.join(','), selectedProps.join(',')]); // eslint-disable-line

  // ── Auto-save: text fields (debounced 1.5s) ────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (!isInitializedRef.current || !storyboardId || isReloadingRef.current) return;
    setSaveStatus('pending');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      const v = latestTextRef.current;
      try {
        const hasPersistedPrompt = storyboard?.video_prompt !== undefined && storyboard?.video_prompt !== null;
        const isPromptUnexpectedlyEmpty = hasPersistedPrompt && !(v.videoPrompt || '').trim();
        if (isPromptUnexpectedlyEmpty) {
          setSaveStatus('saved');
          return;
        }

        await storyboardApi.update(projectId, storyboardId, {
          description: v.editDescription?.trim() || '',
          script_scene_label: v.editScriptSceneLabel?.trim() || '',
          dialogue: v.editDialogue?.trim() || '',
          action: v.editAction?.trim() || '',
          shot_type: v.editShotType || '',
          camera_angle: v.editCameraAngle || '',
          duration: v.editDuration || 6,
          resolution: v.editResolution || '1280x720',
          image_prompt: v.generatedPrompt?.trim() || '',
          video_prompt: v.videoPrompt || '',
        });
        setSaveStatus('saved');
      } catch { setSaveStatus('saved'); }
    }, 1500);
  }, [projectId, storyboardId]);

  useEffect(() => { scheduleSave(); }, [editDescription, editScriptSceneLabel, editDialogue, editAction, editShotType, editCameraAngle, editDuration, editResolution, generatedPrompt]); // eslint-disable-line
  useEffect(() => { if (isInitializedRef.current) scheduleSave(); }, [videoGen.videoPrompt]); // eslint-disable-line

  // ── Auto-save: asset selection (immediate partial save, 300ms debounce) ────
  const scheduleAssetSave = useCallback(() => {
    if (!isInitializedRef.current || !storyboardId) return;
    if (assetSaveTimerRef.current) clearTimeout(assetSaveTimerRef.current);
    assetSaveTimerRef.current = setTimeout(async () => {
      const { selectedCharacters: sc, selectedScenes: ss, selectedProps: sp } = latestAssetsRef.current;
      try {
        await assetApi.update(projectId, 'storyboard', storyboardId, {
          character_ids: sc, scene_ids: ss, prop_ids: sp,
          reference_image_ids: selectedStoryboardReferenceImageIdsRef.current,
        });
      } catch {}
    }, 300);
  }, [projectId, storyboardId]);

  useEffect(() => { scheduleAssetSave(); }, [selectedCharacters.join(','), selectedScenes.join(','), selectedProps.join(','), selectedStoryboardReferenceImageIds.join(',')]); // eslint-disable-line

  // ── SVG connection drawing ─────────────────────────────────────────────────
  const recomputeConnections = useCallback(() => {
    if (!containerRef.current || !storyboardImgRef.current) return;
    const cRect = containerRef.current.getBoundingClientRect();
    const imgRect = storyboardImgRef.current.getBoundingClientRect();
    const imgMidY = imgRect.top + imgRect.height / 2 - cRect.top;
    const imgLeft = imgRect.left - cRect.left;
    const imgRight = imgRect.right - cRect.left;
    const paths: Array<{ d: string; stroke: string }> = [];

    if (!primaryImageRef.current) {
      // No storyboard image: draw direct lines from assets to video nodes
      for (const [assetId, assetEl] of assetNodeRefs.current) {
        const ar = assetEl.getBoundingClientRect();
        if (ar.bottom < cRect.top || ar.top > cRect.bottom) continue;
        const sx = ar.right - cRect.left;
        const sy = Math.max(0, Math.min(cRect.height, ar.top + ar.height / 2 - cRect.top));
        const status = assetStatusesRef.current[assetId]?.status;
        const stroke = status === 'Active' ? '#22c55e' : '#4f46e5';
        for (const [, videoEl] of videoNodeRefs.current) {
          const vr = videoEl.getBoundingClientRect();
          if (vr.bottom < cRect.top || vr.top > cRect.bottom) continue;
          const tx = vr.left - cRect.left;
          const ty = Math.max(0, Math.min(cRect.height, vr.top + vr.height / 2 - cRect.top));
          const cx = (sx + tx) / 2;
          paths.push({ d: `M${sx},${sy} C${cx},${sy} ${cx},${ty} ${tx},${ty}`, stroke });
        }
      }
    } else {
      // Has storyboard image: assets → center → video
      for (const [assetId, el] of assetNodeRefs.current) {
        const r = el.getBoundingClientRect();
        if (r.bottom < cRect.top || r.top > cRect.bottom) continue;
        const sx = r.right - cRect.left;
        const sy = Math.max(0, Math.min(cRect.height, r.top + r.height / 2 - cRect.top));
        const cx = (sx + imgLeft) / 2;
        const status = assetStatusesRef.current[assetId]?.status;
        const stroke = status === 'Active' ? '#22c55e' : '#374151';
        paths.push({ d: `M${sx},${sy} C${cx},${sy} ${cx},${imgMidY} ${imgLeft},${imgMidY}`, stroke });
      }
      for (const [, el] of videoNodeRefs.current) {
        const r = el.getBoundingClientRect();
        if (r.bottom < cRect.top || r.top > cRect.bottom) continue;
        const tx = r.left - cRect.left;
        const ty = Math.max(0, Math.min(cRect.height, r.top + r.height / 2 - cRect.top));
        const cx = (imgRight + tx) / 2;
        paths.push({ d: `M${imgRight},${imgMidY} C${cx},${imgMidY} ${cx},${ty} ${tx},${ty}`, stroke: '#4f46e5' });
      }
    }
    setSvgPaths(paths);
  }, []);

  useEffect(() => {
    const timer = setTimeout(recomputeConnections, 50);
    return () => clearTimeout(timer);
  });

  useEffect(() => {
    const handleScroll = () => requestAnimationFrame(recomputeConnections);
    const lp = leftPanelRef.current;
    const rp = rightPanelRef.current;
    lp?.addEventListener('scroll', handleScroll);
    rp?.addEventListener('scroll', handleScroll);
    return () => { lp?.removeEventListener('scroll', handleScroll); rp?.removeEventListener('scroll', handleScroll); };
  }, [recomputeConnections]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => recomputeConnections());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [recomputeConnections]);

  // ── handleSubmitAsset ──────────────────────────────────────────────────────
  const primaryImage = useMemo(() => {
    const visible = storyboardImages.filter(img => !hiddenImageIds.has(img.image_id));
    return visible.find(i => i.is_primary) || visible[0] || null;
  }, [storyboardImages, hiddenImageIds]);

  const orderedStoryboardReferenceImages = useMemo(() => {
    const visible = storyboardImages.filter(img => !hiddenImageIds.has(img.image_id));
    return visible.filter(img => selectedStoryboardReferenceImageIds.includes(img.image_id));
  }, [storyboardImages, hiddenImageIds, selectedStoryboardReferenceImageIds]);

  const orderedAssetReferenceImageIds = useMemo(() => {
    if (!storyboard) return [] as string[];
    const ids: string[] = [];
    for (const charId of selectedCharacters) {
      const char = characters.find((c: any) => c.asset_id === charId);
      if (char?.image_id) ids.push(char.image_id);
    }
    const sceneIds: string[] = selectedScenes;
    for (const sid of sceneIds) {
      const scene = scenes.find((s: any) => s.asset_id === sid);
      if (scene?.image_id) ids.push(scene.image_id);
    }
    for (const propId of selectedProps) {
      const prop = props.find((p: any) => p.asset_id === propId);
      if (prop?.image_id) ids.push(prop.image_id);
    }
    return ids;
  }, [storyboard, selectedCharacters, selectedScenes, selectedProps, characters, scenes, props]);

  const orderedReferenceImageIds = useMemo(() => {
    return Array.from(new Set([
      ...orderedAssetReferenceImageIds,
      ...orderedStoryboardReferenceImages.map(img => img.image_id),
    ].filter(Boolean)));
  }, [orderedAssetReferenceImageIds, orderedStoryboardReferenceImages]);

  // Keep ref in sync so recomputeConnections (useCallback []) can read current value
  useEffect(() => { primaryImageRef.current = primaryImage; }, [primaryImage]);

  const trackingId = primaryImage?.image_id ?? storyboardId;

  const handleSubmitAsset = useCallback(async () => {
    const imageIds = [...orderedReferenceImageIds];
    const imageToLocalAsset: Record<string, string> = {};
    for (const charId of selectedCharacters) {
      const imageId = characters.find((c: any) => c.asset_id === charId)?.image_id;
      if (imageId) imageToLocalAsset[imageId] = charId;
    }
    for (const sceneId of selectedScenes) {
      const imageId = scenes.find((s: any) => s.asset_id === sceneId)?.image_id;
      if (imageId) imageToLocalAsset[imageId] = sceneId;
    }
    for (const propId of selectedProps) {
      const imageId = props.find((p: any) => p.asset_id === propId)?.image_id;
      if (imageId) imageToLocalAsset[imageId] = propId;
    }
    for (const imageId of orderedReferenceImageIds) {
      imageToLocalAsset[imageId] = imageToLocalAsset[imageId] || imageId;
    }
    if (imageIds.length === 0) { toast('没有可提交的图片', 'error'); return; }
    setAssetSubmitting(prev => ({ ...prev, [trackingId]: true }));
    try {
      const res = await generationApi.submitAsset(projectId, imageIds);
      const submitted: { image_id: string; asset_id: string; status: string }[] = res.data.submitted || [];
      const pollOne = async (volcAssetId: string, imageId: string) => {
        const localId = imageToLocalAsset[imageId] || imageId;
        try {
          const r = await generationApi.getAssetStatus(projectId, volcAssetId);
          // 同时写入 localAssetId 和 imageId 两个 key，确保渲染和 allStatuses 都能读到
          setAssetImageStatuses(prev => ({
            ...prev,
            [localId]: { asset_id: volcAssetId, status: r.data.status, image_id: imageId },
            [imageId]: { asset_id: volcAssetId, status: r.data.status, image_id: imageId },
          }));
          if (r.data.status === 'Processing') setTimeout(() => pollOne(volcAssetId, imageId), 5000);
        } catch {}
      };
      // 提交后立即将所有已提交项标记为 Processing（即时 UI 反馈）
      const immediateUpdates: Record<string, AssetStatus> = {};
      for (const s of submitted) {
        const localId = imageToLocalAsset[s.image_id] || s.image_id;
        immediateUpdates[localId] = { asset_id: s.asset_id, status: s.status, image_id: s.image_id };
        immediateUpdates[s.image_id] = { asset_id: s.asset_id, status: s.status, image_id: s.image_id };
      }
      setAssetImageStatuses(prev => ({ ...prev, ...immediateUpdates }));

      const processingItems = submitted.filter(s => s.status === 'Processing');
      const refreshAll = async () => {
        await reloadStoryboard();
        await reloadAssets();
        await videoGen.loadPrimaryImage(storyboard);
        // 不调 loadAssetImageStatuses：轮询已把正确状态写入，调了反而会用闭包旧数据覆盖
      };
      if (processingItems.length > 0) {
        setTimeout(async () => {
          await Promise.all(processingItems.map(s => pollOne(s.asset_id, s.image_id)));
          setAssetSubmitting(prev => ({ ...prev, [trackingId]: false }));
          await refreshAll();
        }, 3000);
      } else {
        setAssetSubmitting(prev => ({ ...prev, [trackingId]: false }));
        await refreshAll();
      }
      toast('素材提交成功', 'success');
    } catch {
      setAssetSubmitting(prev => ({ ...prev, [trackingId]: false }));
    }
  }, [projectId, trackingId, orderedReferenceImageIds, selectedCharacters, selectedScenes, selectedProps, characters, scenes, props, reloadStoryboard, reloadAssets, loadAssetImageStatuses, videoGen, storyboard, toast]);

  const handleResubmitAsset = useCallback(async () => {
    const imageIds = [...orderedReferenceImageIds];
    const imageToLocalAsset: Record<string, string> = {};
    for (const charId of selectedCharacters) {
      const imageId = characters.find((c: any) => c.asset_id === charId)?.image_id;
      if (imageId) imageToLocalAsset[imageId] = charId;
    }
    for (const sceneId of selectedScenes) {
      const imageId = scenes.find((s: any) => s.asset_id === sceneId)?.image_id;
      if (imageId) imageToLocalAsset[imageId] = sceneId;
    }
    for (const propId of selectedProps) {
      const imageId = props.find((p: any) => p.asset_id === propId)?.image_id;
      if (imageId) imageToLocalAsset[imageId] = propId;
    }
    for (const imageId of orderedReferenceImageIds) {
      imageToLocalAsset[imageId] = imageToLocalAsset[imageId] || imageId;
    }
    if (imageIds.length === 0) { toast('没有可提交的图片', 'error'); return; }
    setAssetSubmitting(prev => ({ ...prev, [trackingId]: true }));
    try {
      const res = await generationApi.resubmitAsset(projectId, imageIds);
      const submitted: { image_id: string; asset_id: string; status: string }[] = res.data.submitted || [];
      const pollOne = async (volcAssetId: string, imageId: string) => {
        const localId = imageToLocalAsset[imageId] || imageId;
        try {
          const r = await generationApi.getAssetStatus(projectId, volcAssetId);
          setAssetImageStatuses(prev => ({
            ...prev,
            [localId]: { asset_id: volcAssetId, status: r.data.status, image_id: imageId },
            [imageId]: { asset_id: volcAssetId, status: r.data.status, image_id: imageId },
          }));
          if (r.data.status === 'Processing') setTimeout(() => pollOne(volcAssetId, imageId), 5000);
        } catch {}
      };
      const immediateUpdates: Record<string, AssetStatus> = {};
      for (const s of submitted) {
        const localId = imageToLocalAsset[s.image_id] || s.image_id;
        immediateUpdates[localId] = { asset_id: s.asset_id, status: s.status, image_id: s.image_id };
        immediateUpdates[s.image_id] = { asset_id: s.asset_id, status: s.status, image_id: s.image_id };
      }
      setAssetImageStatuses(prev => ({ ...prev, ...immediateUpdates }));
      const processingItems = submitted.filter(s => s.status === 'Processing');
      const refreshAll = async () => {
        await reloadStoryboard();
        await reloadAssets();
        await videoGen.loadPrimaryImage(storyboard);
      };
      if (processingItems.length > 0) {
        setTimeout(async () => {
          await Promise.all(processingItems.map(s => pollOne(s.asset_id, s.image_id)));
          setAssetSubmitting(prev => ({ ...prev, [trackingId]: false }));
          await refreshAll();
        }, 3000);
      } else {
        setAssetSubmitting(prev => ({ ...prev, [trackingId]: false }));
        await refreshAll();
      }
      toast('强制重新提交成功', 'success');
    } catch {
      setAssetSubmitting(prev => ({ ...prev, [trackingId]: false }));
    }
  }, [projectId, trackingId, orderedReferenceImageIds, selectedCharacters, selectedScenes, selectedProps, characters, scenes, props, reloadStoryboard, reloadAssets, videoGen, storyboard, toast]);

  // ── Action handlers ────────────────────────────────────────────────────────
  const handleBack = () => {
    setMessagePrefix(null);
    navigate(`/project/${projectId}`, { state: { episodeId } });
  };

  const handleSwitchStoryboard = (nextStoryboardId: string) => {
    if (!nextStoryboardId || nextStoryboardId === storyboardId) return;
    setMessagePrefix(null);
    navigate(`/project/${projectId}/storyboard/${nextStoryboardId}/edit${episodeId ? `?episodeId=${episodeId}` : ''}`);
  };

  const handleGenerateImage = async () => {
    if (!mergedStoryboard) return;
    await imageManagement.handleGenerateImageFromEdit(
      mergedStoryboard, generatedPrompt, selectedCharacters, selectedScenes, selectedProps,
      characters, scenes, props, setStoryboardImages,
      showImageModelSelect ? selectedImageModel : undefined,
      selectedImageSize
    );
  };

  const handleOpenAssetGallery = async (asset: any, assetType: string) => {
    try {
      const res = await generationApi.listImages(projectId, asset.asset_id);
      const images = (res.data || []).sort((a: any, b: any) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return 0;
      });
      setGalleryState({ show: true, assetId: asset.asset_id, assetType, assetName: asset.name, images });
    } catch { toast('加载图库失败', 'error'); }
  };

  const handleOpenStoryboardGallery = () => {
    setGalleryState({ show: true, assetId: storyboardId, assetType: 'storyboard', assetName: `分镜 ${storyboard?.sequence}`, images: storyboardImages });
  };

  const handleSetPrimaryImage = async (imageId: string) => {
    try {
      await generationApi.setPrimaryImage(projectId, galleryState.assetId, imageId);
      if (galleryState.assetType === 'storyboard') {
        await reloadStoryboard();
        const imgs = (await generationApi.listImages(projectId, storyboardId)).data || [];
        setGalleryState(prev => ({ ...prev, images: imgs }));
        setSelectedStoryboardReferenceImageIds(prev => prev.includes(imageId) ? prev : [...prev, imageId]);
      } else {
        // Reload asset gallery images
        const res = await generationApi.listImages(projectId, galleryState.assetId);
        setGalleryState(prev => ({ ...prev, images: res.data || [] }));
        loadAssetImageStatuses(selectedCharacters, selectedScenes, selectedProps);
      }
    } catch { toast('设置主图失败', 'error'); }
  };

  const handleInsertTransitionFrame = useCallback(async () => {
    if (!projectId || !storyboardId) return;
    setInsertingTransitionFrame(true);
    try {
      const insertRes = await storyboardApi.insertTransitionFrame(projectId, storyboardId);
      const transitionImageId = insertRes.data?.transition_image?.image_id;
      if (!transitionImageId) {
        toast('插入衔接帧失败: 未返回图片ID', 'error');
        return;
      }

      const nextSelectedStoryboardIds = selectedStoryboardReferenceImageIds.includes(transitionImageId)
        ? selectedStoryboardReferenceImageIds
        : [...selectedStoryboardReferenceImageIds, transitionImageId];
      setSelectedStoryboardReferenceImageIds(nextSelectedStoryboardIds);

      const orderedIdsAfterInsert = Array.from(new Set([
        ...orderedAssetReferenceImageIds,
        ...nextSelectedStoryboardIds,
      ].filter(Boolean)));

      const n = orderedIdsAfterInsert.indexOf(transitionImageId) + 1;
      const fixedPrefix = `以@图片${n} 为起始画面，【接下来动作/场景变化】，镜头平滑过渡，主体位置衔接，光影不变。并且保持当前的位置关系一致。`;
      const rewriteOne = (raw: string) => {
        const body = (raw || '').trim().replace(/^以@图片\d+ 为起始画面，【接下来动作\/场景变化】，镜头平滑过渡，主体位置衔接，光影不变。并且保持当前的位置关系一致。\s*/u, '');
        return body ? `${fixedPrefix}\n${body}` : fixedPrefix;
      };

      const currentPrompt = videoGen.videoPrompt || '';
      let nextPrompt = currentPrompt;
      try {
        const parsed = JSON.parse(currentPrompt);
        if (Array.isArray(parsed) && parsed.length > 0) {
          nextPrompt = JSON.stringify(parsed.map((p: any) => rewriteOne(String(p || ''))));
        } else {
          nextPrompt = rewriteOne(currentPrompt);
        }
      } catch {
        nextPrompt = rewriteOne(currentPrompt);
      }

      videoGen.handlePromptChange(nextPrompt);
      await storyboardApi.update(projectId, storyboardId, {
        video_prompt: nextPrompt,
        reference_image_ids: nextSelectedStoryboardIds,
      });

      if (storyboard) {
        await videoGen.loadPrimaryImage(storyboard);
      }
      await reloadStoryboard();
      setSelectedStoryboardReferenceImageIds(prev => prev.includes(transitionImageId)
        ? prev
        : [...prev, transitionImageId]);
      toast('衔接帧已插入并更新提示词前缀', 'success');
    } catch (error: any) {
      toast(`插入衔接帧失败: ${error.response?.data?.detail || error.message || '操作失败'}`, 'error');
    } finally {
      setInsertingTransitionFrame(false);
    }
  }, [projectId, storyboardId, storyboard, selectedStoryboardReferenceImageIds, orderedAssetReferenceImageIds, videoGen, reloadStoryboard, toast]);


  const handleExport = () => videoGen.handleExport(storyboard);
  const handleDownload = () => videoGen.handleDownload(storyboard);

  // ── Volcengine status summary ───────────────────────────────────────────────
  const referenceImageStatusById = useMemo(() => {
    const map: Record<string, string | undefined> = {};

    for (const image of storyboardImages) {
      map[image.image_id] = assetImageStatuses[image.image_id]?.status ?? image.volcengine_asset_status;
    }

    for (const assetId of selectedCharacters) {
      const char = characters.find((c: any) => c.asset_id === assetId);
      if (char?.image_id) {
        map[char.image_id] = assetImageStatuses[char.image_id]?.status
          ?? assetImageStatuses[assetId]?.status
          ?? char.volcengine_asset_status;
      }
    }
    for (const assetId of selectedScenes) {
      const scene = scenes.find((s: any) => s.asset_id === assetId);
      if (scene?.image_id) {
        map[scene.image_id] = assetImageStatuses[scene.image_id]?.status
          ?? assetImageStatuses[assetId]?.status
          ?? scene.volcengine_asset_status;
      }
    }
    for (const assetId of selectedProps) {
      const prop = props.find((p: any) => p.asset_id === assetId);
      if (prop?.image_id) {
        map[prop.image_id] = assetImageStatuses[prop.image_id]?.status
          ?? assetImageStatuses[assetId]?.status
          ?? prop.volcengine_asset_status;
      }
    }

    return map;
  }, [storyboardImages, assetImageStatuses, selectedCharacters, selectedScenes, selectedProps, characters, scenes, props]);

  const allStatuses = useMemo(() => {
    return orderedReferenceImageIds.map((imageId) => referenceImageStatusById[imageId]);
  }, [orderedReferenceImageIds, referenceImageStatusById]);

  const isSubmitting = assetSubmitting[trackingId];
  const anyProcessing = allStatuses.some(s => s === 'Processing');
  const anyFailed = allStatuses.some(s => s === 'Failed');
  const allActive = allStatuses.length > 0 && allStatuses.every(s => s === 'Active');
  const isGenerating = hasRunningTask(storyboardId);
  const visibleImages = useMemo(() => storyboardImages.filter(img => !hiddenImageIds.has(img.image_id)), [storyboardImages, hiddenImageIds]);

  // ── Video segments ─────────────────────────────────────────────────────────
  const videoSegments = useMemo(() => {
    try {
      const parsed = JSON.parse(videoGen.videoPrompt);
      if (Array.isArray(parsed) && parsed.length > 1) return parsed as string[];
    } catch {}
    return null;
  }, [videoGen.videoPrompt]);

  // ── Primary video (single mode) & sorted videos (multi mode) ───────────────
  // Single: prefer is_primary, fall back to first completed, then first
  const primaryVideoSingle = useMemo(() => {
    const vs = videoGen.videos;
    if (vs.length === 0) return null;
    return vs.find((x: any) => x.is_primary)
      || vs.find((x: any) => x.status === 'completed')
      || vs[0];
  }, [videoGen.videos]);

  // Single: thumbnail strip = all videos except the primary one
  const otherVideosSingle = useMemo(() => {
    if (!primaryVideoSingle) return videoGen.videos;
    return videoGen.videos.filter((x: any) => x.video_id !== primaryVideoSingle.video_id);
  }, [videoGen.videos, primaryVideoSingle]);

  // Multi: sort so is_primary comes first (maps to segment 0), rest keep API order
  const sortedVideosMulti = useMemo(() => {
    return [...videoGen.videos].sort((a: any, b: any) =>
      a.is_primary ? -1 : b.is_primary ? 1 : 0
    );
  }, [videoGen.videos]);
  // ─────────────────────────── RENDER ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-400" size={32} />
      </div>
    );
  }

  if (!storyboard) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">分镜不存在或加载失败</p>
          <button onClick={handleBack} className="text-blue-400 hover:text-blue-300">← 返回</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-screen bg-gray-900 text-white flex flex-col overflow-hidden ${appearanceMode === 'vip' ? 'vip-editor-shell' : ''}`}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2.5 flex items-center justify-between flex-shrink-0 h-[52px]">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white transition text-sm"
          >
            <ArrowLeft size={15} />返回分镜
          </button>
          <span className="text-gray-600">|</span>
          <span className="text-sm font-medium text-gray-200">分镜 #{storyboard.sequence}</span>
          <div className="flex items-center gap-1 ml-1 max-w-[46vw] overflow-x-auto py-1">
            {(storyboardList.length > 0 ? storyboardList : [storyboard]).map((item) => {
              const isActiveStoryboard = item.asset_id === storyboardId;
              return (
                <button
                  key={item.asset_id}
                  type="button"
                  onClick={() => handleSwitchStoryboard(item.asset_id)}
                  disabled={isActiveStoryboard}
                  className={`min-w-7 h-7 px-2 rounded text-xs font-medium transition ${
                    isActiveStoryboard
                      ? 'bg-blue-600 text-white cursor-default'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
                  }`}
                  title={item.script_scene_label ? `分镜 #${item.sequence} · ${item.script_scene_label}` : `切换到分镜 #${item.sequence}`}
                >
                  {item.sequence}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Save status */}
          <span className="text-xs text-gray-500">
            {saveStatus === 'pending' && '待保存...'}
            {saveStatus === 'saving' && <><Loader2 size={11} className="inline animate-spin mr-1" />保存中...</>}
            {saveStatus === 'saved' && '已自动保存'}
          </span>
          <button
            onClick={handleExport}
            disabled={videoGen.isExporting}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded"
          >
            {videoGen.isExporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            导出
          </button>
          <button
            onClick={handleDownload}
            disabled={videoGen.isDownloading}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded"
          >
            {videoGen.isDownloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            下载资源
          </button>
        </div>
      </div>

      {/* ── Three-Column Canvas ─────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden relative" ref={containerRef}>
        {/* SVG connection overlay */}
        <svg
          className="absolute inset-0 pointer-events-none z-10"
          width="100%"
          height="100%"
          style={{ overflow: 'visible' }}
        >
          {svgPaths.map((p, i) => (
            <path key={i} d={p.d} stroke={p.stroke} strokeWidth="1.5" fill="none" opacity="0.65" />
          ))}
        </svg>

        {/* ── LEFT PANEL: Assets + Content Fields ─────────────────────────── */}
        <div
          ref={leftPanelRef}
          className="flex-[2] min-w-0 border-r border-gray-700 overflow-y-auto flex flex-col bg-gray-900"
        >
          <div className="p-3 space-y-3 flex-1">
            {/* Assets section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">已选资产</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      if (!storyboard) return;
                      setVibeDramaContext({ projectId, projectName: currentProject?.name || '', episodeId, tabName: 'storyboard', label: `分镜 #${storyboard.sequence}` });
                      setMessagePrefix(`当前分镜：分镜 #${storyboard.sequence}，storyboard_id='${storyboard.asset_id}'`);
                      openVibeDrama();
                      setPendingMessage({ key: `${projectId}_${episodeId}`, message: '自动匹配资产' });
                    }}
                    disabled={getTaskStatus(storyboardId, 'auto_match') === 'generating'}
                    className="text-[11px] text-purple-400 hover:text-purple-300 disabled:text-gray-600 flex items-center gap-0.5"
                    title="AI自动匹配"
                  >
                    {getTaskStatus(storyboardId, 'auto_match') === 'generating'
                      ? <Loader2 size={10} className="animate-spin" />
                      : <Sparkles size={10} />}
                    匹配
                  </button>
                  <button
                    onClick={() => setShowAssetSelector(true)}
                    className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                  >
                    <Plus size={10} />选择
                  </button>
                </div>
              </div>

              {/* Character nodes */}
              {selectedCharacters.map(charId => {
                const char = characters.find(c => c.asset_id === charId);
                if (!char) return null;
                const status = assetImageStatuses[charId]?.status;
                const thumbUrl = (char.primary_image_url || char.image_url)?.replace('/images/files/', '/thumbnails/');
                return (
                  <div
                    key={charId}
                    ref={el => { if (el) assetNodeRefs.current.set(charId, el); else assetNodeRefs.current.delete(charId); }}
                    onClick={() => handleOpenAssetGallery(char, 'character')}
                    className="flex items-center gap-2 bg-gray-700 rounded-lg p-2 mb-1.5 cursor-pointer hover:bg-gray-600 transition group"
                  >
                    <div className="w-10 h-10 rounded overflow-hidden bg-gray-600 flex-shrink-0 flex items-center justify-center">
                      {thumbUrl
                        ? <img src={thumbUrl} alt={char.name} className="w-full h-full object-cover" />
                        : <span className="text-sm font-bold text-gray-400">{(char.name || '?')[0]}</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-200 truncate">{char.name}</p>
                      <p className="text-[10px] text-blue-400">角色</p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1">
                      {status === 'Active' && <CheckCircle size={12} className="text-green-400" />}
                      {status === 'Processing' && <Loader2 size={12} className="text-yellow-400 animate-spin" />}
                      {status === 'Failed' && <span className="text-red-400 text-[10px]">!</span>}
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedCharacters(selectedCharacters.filter(id => id !== charId)); }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Scene nodes */}
              {selectedScenes.map(sceneId => {
                const scene = scenes.find(s => s.asset_id === sceneId);
                if (!scene) return null;
                const status = assetImageStatuses[sceneId]?.status;
                const thumbUrl = (scene.primary_image_url || scene.image_url)?.replace('/images/files/', '/thumbnails/');
                return (
                  <div
                    key={sceneId}
                    ref={el => { if (el) assetNodeRefs.current.set(sceneId, el); else assetNodeRefs.current.delete(sceneId); }}
                    onClick={() => handleOpenAssetGallery(scene, 'scene')}
                    className="flex items-center gap-2 bg-gray-700 rounded-lg p-2 mb-1.5 cursor-pointer hover:bg-gray-600 transition group"
                  >
                    <div className="w-10 h-10 rounded overflow-hidden bg-gray-600 flex-shrink-0 flex items-center justify-center">
                      {thumbUrl
                        ? <img src={thumbUrl} alt={scene.name} className="w-full h-full object-cover" />
                        : <span className="text-sm font-bold text-gray-400">{(scene.name || '?')[0]}</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-200 truncate">{scene.name}</p>
                      <p className="text-[10px] text-green-400">场景</p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1">
                      {status === 'Active' && <CheckCircle size={12} className="text-green-400" />}
                      {status === 'Processing' && <Loader2 size={12} className="text-yellow-400 animate-spin" />}
                      {status === 'Failed' && <span className="text-red-400 text-[10px]">!</span>}
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedScenes(selectedScenes.filter(id => id !== sceneId)); }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Prop nodes */}
              {selectedProps.map(propId => {
                const prop = props.find(p => p.asset_id === propId);
                if (!prop) return null;
                const status = assetImageStatuses[propId]?.status;
                const thumbUrl = (prop.primary_image_url || prop.image_url)?.replace('/images/files/', '/thumbnails/');
                return (
                  <div
                    key={propId}
                    ref={el => { if (el) assetNodeRefs.current.set(propId, el); else assetNodeRefs.current.delete(propId); }}
                    onClick={() => handleOpenAssetGallery(prop, 'prop')}
                    className="flex items-center gap-2 bg-gray-700 rounded-lg p-2 mb-1.5 cursor-pointer hover:bg-gray-600 transition group"
                  >
                    <div className="w-10 h-10 rounded overflow-hidden bg-gray-600 flex-shrink-0 flex items-center justify-center">
                      {thumbUrl
                        ? <img src={thumbUrl} alt={prop.name} className="w-full h-full object-cover" />
                        : <span className="text-sm font-bold text-gray-400">{(prop.name || '?')[0]}</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-200 truncate">{prop.name}</p>
                      <p className="text-[10px] text-purple-400">道具</p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-1">
                      {status === 'Active' && <CheckCircle size={12} className="text-green-400" />}
                      {status === 'Processing' && <Loader2 size={12} className="text-yellow-400 animate-spin" />}
                      {status === 'Failed' && <span className="text-red-400 text-[10px]">!</span>}
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedProps(selectedProps.filter(id => id !== propId)); }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {selectedCharacters.length === 0 && selectedScenes.length === 0 && selectedProps.length === 0 && (
                <p className="text-xs text-gray-600 italic text-center py-4">未选择资产</p>
              )}
            </div>

            {/* Content fields section */}
            <div className="border-t border-gray-700 pt-3">
              <button
                onClick={() => setContentExpanded(!contentExpanded)}
                className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 hover:text-gray-300 transition"
              >
                <span>分镜内容</span>
                {contentExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              {contentExpanded && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">剧本原文 *</label>
                    <textarea
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                      rows={12}
                      placeholder="粘贴该镜头对应的剧本原文片段..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">场次</label>
                    <input
                      type="text"
                      value={editScriptSceneLabel}
                      onChange={e => setEditScriptSceneLabel(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      placeholder="如：14-2 日 外 老林家院子"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">对白</label>
                    <input
                      type="text"
                      value={editDialogue}
                      onChange={e => setEditDialogue(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      placeholder="角色对白..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">动作</label>
                    <input
                      type="text"
                      value={editAction}
                      onChange={e => setEditAction(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                      placeholder="描述动作..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">时长(秒)</label>
                    <input
                      type="number"
                      value={editDuration}
                      min={1}
                      max={60}
                      onChange={e => setEditDuration(Math.max(1, parseInt(e.target.value) || 6))}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── CENTER PANEL: Storyboard Image + Image Prompt ────────────────── */}
        <div className="flex-[4] min-w-0 flex flex-col overflow-hidden p-4 border-r border-gray-700">
          {/* Storyboard image node - connection anchor */}
          <div className="flex-shrink-0 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">分镜图</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowImageEdit(true)}
                  disabled={!primaryImage || getTaskStatus(storyboardId, 'image') === 'generating' || getTaskStatus(storyboardId, 'image_edit') === 'generating'}
                  className="text-[11px] text-orange-400 hover:text-orange-300 disabled:text-gray-600 flex items-center gap-1"
                >
                  {getTaskStatus(storyboardId, 'image_edit') === 'generating'
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Edit3 size={11} />}
                  编辑
                </button>
                <button onClick={handleOpenStoryboardGallery} className="text-[11px] text-green-400 hover:text-green-300 flex items-center gap-1">
                  <ImagePlus size={11} />管理图库
                </button>
              </div>
            </div>

            {/* Primary image display */}
            <div
              ref={storyboardImgRef}
              onClick={handleOpenStoryboardGallery}
              className={`relative cursor-pointer group rounded-lg overflow-hidden bg-gray-800 transition mx-auto ${
                primaryImage
                  ? 'border border-gray-700 hover:border-blue-500'
                  : 'border border-dashed border-gray-600 hover:border-gray-500 opacity-30 hover:opacity-50'
              }`}
              style={{ aspectRatio: '16/9', maxHeight: '180px', maxWidth: '320px' }}
            >
              {primaryImage ? (
                <>
                  <img
                    src={getImageUrl(primaryImage, projectId).replace('/images/files/', '/thumbnails/')}
                    alt="分镜主图"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-20 transition" />
                  {/* Volcengine status badge */}
                  {(primaryImage.volcengine_asset_status || assetImageStatuses[primaryImage.image_id]?.status) && (
                    <div className="absolute top-2 right-2">
                      {(assetImageStatuses[primaryImage.image_id]?.status ?? primaryImage.volcengine_asset_status) === 'Active'
                        ? <span className="bg-green-600 text-white text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"><CheckCircle size={9} />入库</span>
                        : (assetImageStatuses[primaryImage.image_id]?.status ?? primaryImage.volcengine_asset_status) === 'Processing'
                        ? <span className="bg-yellow-600 text-white text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"><Loader2 size={9} className="animate-spin" />审核</span>
                        : <span className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded">!</span>
                      }
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent py-2 px-3 opacity-0 group-hover:opacity-100 transition">
                    <p className="text-xs text-white">点击管理图库</p>
                  </div>
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-600">
                  <ImagePlus size={32} className="mb-2 opacity-40" />
                  <p className="text-sm">暂无分镜图</p>
                  <p className="text-xs mt-1">生成图片提示词后可生成</p>
                </div>
              )}
            </div>

            {/* Thumbnail strip */}
            {visibleImages.length > 0 && (
              <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
                {visibleImages.slice(0, 6).map(img => {
                  const checked = selectedStoryboardReferenceImageIds.includes(img.image_id);
                  const imageStatus = referenceImageStatusById[img.image_id] ?? img.volcengine_asset_status;
                  return (
                    <div key={img.image_id} className="relative flex-shrink-0">
                      <img
                        src={getImageUrl(img, projectId).replace('/images/files/', '/thumbnails/')}
                        alt=""
                        className={`w-12 h-12 object-cover rounded cursor-pointer border-2 transition ${img.is_primary ? 'border-blue-500' : 'border-transparent hover:border-gray-500'}`}
                        onClick={handleOpenStoryboardGallery}
                      />
                      <label
                        className="absolute -bottom-1 -right-1 w-4 h-4 rounded bg-gray-900 border border-gray-500 flex items-center justify-center cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={() => {
                            setSelectedStoryboardReferenceImageIds(prev => {
                              if (prev.includes(img.image_id)) return prev.filter(id => id !== img.image_id);
                              return [...prev, img.image_id];
                            });
                          }}
                        />
                        {checked && <CheckCircle size={11} className="text-green-400" />}
                      </label>
                      {imageStatus && (
                        <div className="absolute bottom-0 left-0">
                          {imageStatus === 'Active'
                            ? <span className="bg-green-600 text-white text-[8px] px-1 py-0.5 rounded-tr">入库</span>
                            : imageStatus === 'Processing'
                            ? <span className="bg-yellow-600 text-white text-[8px] px-1 py-0.5 rounded-tr flex items-center gap-0.5"><Loader2 size={8} className="animate-spin" />审</span>
                            : <span className="bg-red-600 text-white text-[8px] px-1 py-0.5 rounded-tr">!</span>
                          }
                        </div>
                      )}
                      {img.is_primary && <div className="absolute top-0 right-0 bg-blue-600 text-[9px] px-0.5 rounded-bl">主</div>}
                    </div>
                  );
                })}
                {visibleImages.length > 6 && (
                  <div onClick={handleOpenStoryboardGallery} className="w-12 h-12 bg-gray-700 rounded flex items-center justify-center text-xs text-gray-400 cursor-pointer hover:bg-gray-600 flex-shrink-0">
                    +{visibleImages.length - 6}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Image prompt section */}
          <div className="border-t border-gray-700 pt-3 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">图片提示词</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (!storyboard) return;
                    setVibeDramaContext({ projectId, projectName: currentProject?.name || '', episodeId, tabName: 'storyboard', label: `分镜 #${storyboard.sequence}` });
                    setMessagePrefix(`当前分镜：分镜 #${storyboard.sequence}，storyboard_id='${storyboard.asset_id}'`);
                    openVibeDrama();
                    setPendingMessage({ key: `${projectId}_${episodeId}`, message: `使用 generate_storyboard_video_prompt_subagent 为此分镜生成图片提示词。参数：storyboard_id='${storyboard.asset_id}', prompt_type='image'。` });
                  }}
                  disabled={getTaskStatus(storyboardId, 'prompt') === 'generating'}
                  className="text-xs flex items-center gap-1 text-purple-400 hover:text-purple-300 disabled:text-gray-600"
                >
                  {getTaskStatus(storyboardId, 'prompt') === 'generating'
                    ? <><Loader2 size={11} className="animate-spin" />生成中...</>
                    : <><Wand2 size={11} />AI生成</>}
                </button>
              </div>
            </div>
            <textarea
              value={generatedPrompt}
              onChange={e => setGeneratedPrompt(e.target.value)}
              className="w-full flex-1 min-h-0 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
              placeholder="点击上方按钮AI生成提示词，或手动输入..."
            />
            <div className="flex items-center justify-end gap-2 mt-2 flex-shrink-0">
              <div className="relative shrink-0">
                <button
                  onClick={() => setShowImageSizeMenu(prev => !prev)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                  title="图片比例"
                >
                  <ImagePlus size={13} />
                  {getImageSizeLabel(selectedImageSize)}
                  <ChevronDown size={12} />
                </button>
                {showImageSizeMenu && (
                  <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
                    {IMAGE_SIZE_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        onClick={() => { setSelectedImageSize(option.value); setShowImageSizeMenu(false); }}
                        className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${option.value === selectedImageSize ? 'text-blue-400' : ''}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {showImageModelSelect && (
                <div className="relative w-32 shrink-0">
                  <button
                    onClick={() => setShowImageModelMenu(prev => !prev)}
                    className="w-full flex items-center justify-between gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                    title={`当前图片模型：${selectedImageModel}`}
                  >
                    <span className="truncate">
                      {createnowModelConfig.suggestions.image.find(option => option.model === selectedImageModel)?.label || selectedImageModel || '选择模型'}
                    </span>
                    <ChevronDown size={12} className="shrink-0" />
                  </button>
                  {showImageModelMenu && (
                    <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden min-w-[240px]">
                      <div className="p-2 border-b border-gray-600">
                        <label className="block text-xs text-gray-400 mb-1">自定义模型</label>
                        <input
                          type="text"
                          value={selectedImageModel}
                          onChange={e => setSelectedImageModel(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') setShowImageModelMenu(false);
                            if (e.key === 'Escape') setShowImageModelMenu(false);
                          }}
                          placeholder="输入图片模型名"
                          className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                          autoFocus
                        />
                      </div>
                      <div className="py-1">
                        <div className="px-4 py-1 text-xs text-gray-500">预设模型</div>
                        {(createnowModelConfig.suggestions.image || []).map(option => (
                          <button
                            key={`${option.label}-${option.model}`}
                            onClick={() => { setSelectedImageModel(option.model); setShowImageModelMenu(false); }}
                            className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${option.model === selectedImageModel ? 'text-blue-400' : ''}`}
                            title={option.model}
                          >
                            <span>{option.label}</span>
                            <span className="ml-2 text-xs text-gray-400">{option.model}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={handleGenerateImage}
                disabled={!generatedPrompt || getTaskStatus(storyboardId, 'image') === 'generating'}
                className="w-28 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded shrink-0"
              >
                {getTaskStatus(storyboardId, 'image') === 'generating'
                  ? <><Loader2 size={14} className="animate-spin" />生成中</>
                  : <><ImagePlus size={14} />生成图片</>}
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL: Videos + Video Prompt ──────────────────────────── */}
        <div
          ref={rightPanelRef}
          className="flex-[4] min-w-0 overflow-hidden flex flex-col bg-gray-900"
        >
          <div className="p-3 flex-1 flex flex-col min-h-0">

            {/* ── Single segment layout (mirrors center panel) ─────────────── */}
            {!videoSegments && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Video header – matches "分镜图" header style */}
                <div className="flex items-center justify-between mb-2 flex-shrink-0">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">已生成视频</span>
                  <button
                    onClick={() => setShowVideoGallery(true)}
                    className="text-[11px] text-green-400 hover:text-green-300 flex items-center gap-1"
                  >
                    <Video size={11} />视频库
                  </button>
                </div>

                {/* Primary video – mirrors primary image display */}
                <div
                  ref={el => { if (el) videoNodeRefs.current.set('seg_0', el); else videoNodeRefs.current.delete('seg_0'); }}
                  className="relative rounded-lg overflow-hidden bg-gray-800 border border-gray-700 cursor-pointer flex-shrink-0"
                  style={{ aspectRatio: '16/9', maxHeight: '180px' }}
                  onClick={videoGen.videos.length > 0 ? () => setShowVideoGallery(true) : undefined}
                >
                  {videoGen.videos.length > 0 ? (() => {
                    const v = primaryVideoSingle!;
                    return v.status === 'completed' && v.video_path
                      ? <video src={getVideoUrl(v, projectId)} className="w-full h-full object-contain" controls onClick={e => e.stopPropagation()} />
                      : v.status === 'failed'
                      ? <div className="w-full h-full flex items-center justify-center text-red-400 text-xs">生成失败</div>
                      : <div className="w-full h-full flex items-center justify-center"><Loader2 size={16} className="animate-spin text-yellow-400" /></div>;
                  })() : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-600">
                      <Film size={32} className="mb-2 opacity-40" />
                      <p className="text-sm">暂无视频</p>
                      <p className="text-xs mt-1">生成视频提示词后可生成</p>
                    </div>
                  )}
                </div>

                {/* Thumbnail strip – same as center panel */}
                {otherVideosSingle.length > 0 && (
                  <div onClick={() => setShowVideoGallery(true)} className="flex gap-1.5 cursor-pointer overflow-x-auto pb-1 flex-shrink-0 mt-2">
                    {otherVideosSingle.slice(0, 4).map((v: any) => (
                      <div key={v.video_id} className="w-12 h-12 bg-gray-700 rounded overflow-hidden flex-shrink-0 border-2 border-transparent hover:border-gray-500 transition flex items-center justify-center">
                        {v.status === 'completed' && v.video_path
                          ? <video src={getVideoUrl(v, projectId)} className="w-full h-full object-cover" muted preload="none" />
                          : v.status === 'failed'
                          ? <span className="text-red-400 text-[9px]">失败</span>
                          : <Loader2 size={12} className="animate-spin text-yellow-400" />}
                      </div>
                    ))}
                    {otherVideosSingle.length > 4 && (
                      <div className="w-12 h-12 bg-gray-700 rounded flex items-center justify-center text-xs text-gray-400 flex-shrink-0">
                        +{otherVideosSingle.length - 4}
                      </div>
                    )}
                  </div>
                )}

                {/* Video prompt – mirrors image prompt section */}
                <div className="border-t border-gray-700 pt-3 flex-1 flex flex-col min-h-0 mt-2">
                  <div className="flex items-center justify-between mb-2 flex-shrink-0">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">视频提示词</span>
                    <div className="flex items-center gap-2">
                      {hasPreviousStoryboardVideo && (
                        <button
                          onClick={handleInsertTransitionFrame}
                          disabled={insertingTransitionFrame}
                          className="text-xs flex items-center gap-1 text-cyan-400 hover:text-cyan-300 disabled:text-gray-600"
                        >
                          {insertingTransitionFrame
                            ? <><Loader2 size={11} className="animate-spin" />插入中...</>
                            : <><ImagePlus size={11} />插入衔接帧</>}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (!storyboard) return;
                          setVibeDramaContext({ projectId, projectName: currentProject?.name || '', episodeId, tabName: 'storyboard', label: `分镜 #${storyboard.sequence}` });
                          setMessagePrefix(`当前分镜：分镜 #${storyboard.sequence}，storyboard_id='${storyboard.asset_id}'`);
                          openVibeDrama();
                          setPendingMessage({ key: `${projectId}_${episodeId}`, message: `使用 generate_storyboard_video_prompt_subagent 为此分镜生成视频提示词。参数：storyboard_id='${storyboard.asset_id}', prompt_type='video'。` });
                        }}
                        disabled={getTaskStatus(storyboardId, 'video_prompt') === 'generating' || !editDescription}
                        className="text-xs flex items-center gap-1 text-purple-400 hover:text-purple-300 disabled:text-gray-600"
                      >
                        {getTaskStatus(storyboardId, 'video_prompt') === 'generating'
                          ? <><Loader2 size={11} className="animate-spin" />生成中...</>
                          : <><Wand2 size={11} />AI生成</>}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={videoGen.videoPrompt}
                    onChange={e => videoGen.handlePromptChange(e.target.value)}
                    className="w-full flex-1 min-h-0 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                    placeholder="输入视频提示词，或点击上方按钮AI生成..."
                  />
                  <div className="flex items-center justify-end gap-2 mt-2 flex-shrink-0">
                    {isSubmitting || anyProcessing ? (
                      <span className="w-24 text-xs text-yellow-400 flex items-center gap-1 shrink-0"><Loader2 size={12} className="animate-spin" />审核中</span>
                    ) : allActive ? (
                      <span className="w-24 text-xs text-green-400 flex items-center gap-1 shrink-0"><CheckCircle size={12} />已入库</span>
                    ) : (
                      <button
                        onClick={handleSubmitAsset}
                        className={`w-24 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded shrink-0 ${anyFailed ? 'bg-red-700 hover:bg-red-600' : 'bg-orange-600 hover:bg-orange-700'}`}
                      >
                        <Upload size={13} />{anyFailed ? '重试' : '入库'}
                      </button>
                    )}
                    <button
                      onClick={handleResubmitAsset}
                      className="w-20 flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded hover:bg-gray-700 shrink-0"
                      title="强制重新提交（清空旧审核状态重新入库）"
                    >
                      <RefreshCcw size={12} />重提
                    </button>
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setShowVideoRatioMenu(prev => !prev)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                        title="视频比例"
                      >
                        {getVideoRatioLabel(selectedVideoRatio)}
                        <ChevronDown size={12} />
                      </button>
                      {showVideoRatioMenu && (
                        <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
                          {VIDEO_RATIO_OPTIONS.map(option => (
                            <button
                              key={option.value}
                              onClick={() => { setSelectedVideoRatio(option.value); setShowVideoRatioMenu(false); }}
                              className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${option.value === selectedVideoRatio ? 'text-blue-400' : ''}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setShowVideoResolutionMenu(prev => !prev)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                        title="视频分辨率"
                      >
                        {getVideoResolutionLabel(editResolution)}
                        <ChevronDown size={12} />
                      </button>
                      {showVideoResolutionMenu && (
                        <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
                          {VIDEO_RESOLUTION_OPTIONS.map(option => (
                            <button
                              key={option.value}
                              onClick={() => { setEditResolution(option.value); setShowVideoResolutionMenu(false); }}
                              className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${option.value === editResolution ? 'text-blue-400' : ''}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {showVideoModelSelect && (
                      <div className="relative w-32 shrink-0">
                        <button
                          onClick={() => setShowVideoModelMenu(prev => !prev)}
                          className="w-full flex items-center justify-between gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                          title={`当前视频模型：${selectedVideoModel}`}
                        >
                          <span className="truncate">
                            {createnowModelConfig.suggestions.video.find(option => option.model === selectedVideoModel)?.label || selectedVideoModel || '选择模型'}
                          </span>
                          <ChevronDown size={12} className="shrink-0" />
                        </button>
                        {showVideoModelMenu && (
                          <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden min-w-[240px]">
                            <div className="p-2 border-b border-gray-600">
                              <label className="block text-xs text-gray-400 mb-1">自定义模型</label>
                              <input
                                type="text"
                                value={selectedVideoModel}
                                onChange={e => setSelectedVideoModel(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') setShowVideoModelMenu(false);
                                  if (e.key === 'Escape') setShowVideoModelMenu(false);
                                }}
                                placeholder="输入视频模型名"
                                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                autoFocus
                              />
                            </div>
                            <div className="py-1">
                              <div className="px-4 py-1 text-xs text-gray-500">预设模型</div>
                              {(createnowModelConfig.suggestions.video || []).map(option => (
                                <button
                                  key={`${option.label}-${option.model}`}
                                  onClick={() => { setSelectedVideoModel(option.model); setShowVideoModelMenu(false); }}
                                  className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${option.model === selectedVideoModel ? 'text-blue-400' : ''}`}
                                  title={option.model}
                                >
                                  <span>{option.label}</span>
                                  <span className="ml-2 text-xs text-gray-400">{option.model}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      onClick={async () => { if (!mergedStoryboard) return; videoGen.handleGenerateVideo(mergedStoryboard, editDuration, selectedVideoRatio, editResolution, editDescription, editDialogue, editAction, editShotType, editCameraAngle, showVideoModelSelect ? selectedVideoModel : undefined); }}
                      disabled={isGenerating || !videoGen.videoPrompt.trim()}
                      className="w-28 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded font-medium shrink-0"
                    >
                      {isGenerating ? <><Loader2 size={14} className="animate-spin" />生成中</> : <><Film size={14} />生成视频</>}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Multi-segment layout: each segment = video + prompt paired ── */}
            {videoSegments && (
              <>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">视频 & 提示词</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => { if (!mergedStoryboard) return; videoGen.handleGenerateVideoPrompt(mergedStoryboard, editDescription, editDialogue, editAction, editShotType, editCameraAngle, editDuration); }}
                      disabled={getTaskStatus(storyboardId, 'video_prompt') === 'generating' || !editDescription}
                      className="text-xs flex items-center gap-1 text-purple-400 hover:text-purple-300 disabled:text-gray-600"
                    >
                      {getTaskStatus(storyboardId, 'video_prompt') === 'generating'
                        ? <><Loader2 size={11} className="animate-spin" />生成中...</>
                        : <><Wand2 size={11} />AI生成全部提示词</>}
                    </button>
                    <button onClick={() => setShowVideoGallery(true)} className="text-[11px] text-green-400 hover:text-green-300 flex items-center gap-1">
                      <Video size={11} />视频库
                    </button>
                  </div>
                </div>

                {/* Per-segment nodes: video on top, prompt below */}
                <div className="space-y-3">
                  {videoSegments.map((segment, idx) => {
                    const segVideo = sortedVideosMulti[idx] ?? null;
                    return (
                      <div
                        key={idx}
                        ref={el => { if (el) videoNodeRefs.current.set(`seg_${idx}`, el); else videoNodeRefs.current.delete(`seg_${idx}`); }}
                        className="bg-gray-800 rounded-lg p-3 border border-gray-700 space-y-2"
                      >
                        {/* Segment header */}
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium text-indigo-300">第 {idx + 1} 段</span>
                          <button
                            onClick={async () => { if (!mergedStoryboard) return; videoGen.handleGenerateVideoSegment(mergedStoryboard, idx, editDuration, selectedVideoRatio, editResolution, editDescription, editDialogue, editAction, editShotType, editCameraAngle, showVideoModelSelect ? selectedVideoModel : undefined); }}
                            disabled={isGenerating || !segment.trim() || (!primaryImage && selectedCharacters.length === 0 && selectedScenes.length === 0 && selectedProps.length === 0)}
                            className="text-[11px] flex items-center gap-1 bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 px-2 py-0.5 rounded"
                          >
                            {isGenerating ? <Loader2 size={10} className="animate-spin" /> : <Film size={10} />}
                            生成此段
                          </button>
                        </div>
                        {/* Video for this segment */}
                        <div className="relative w-full rounded overflow-hidden bg-gray-700 border border-gray-600" style={{ aspectRatio: '16/9', maxHeight: '180px' }}>
                          {segVideo ? (
                            segVideo.status === 'completed' && segVideo.video_path
                              ? <video src={getVideoUrl(segVideo, projectId)} className="w-full h-full object-contain" controls />
                              : segVideo.status === 'failed'
                              ? <div className="w-full h-full flex items-center justify-center text-red-400 text-xs">生成失败</div>
                              : <div className="w-full h-full flex items-center justify-center"><Loader2 size={16} className="animate-spin text-yellow-400" /></div>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">暂无视频</div>
                          )}
                        </div>
                        {/* Prompt for this segment */}
                        <textarea
                          value={segment}
                          onChange={e => { const a = [...videoSegments]; a[idx] = e.target.value; videoGen.handlePromptChange(JSON.stringify(a)); }}
                          className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                          rows={10}
                          placeholder={`第 ${idx + 1} 段提示词...`}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Bottom actions */}
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-700 pt-3">
                  {isSubmitting || anyProcessing ? (
                    <span className="w-24 text-xs text-yellow-400 flex items-center gap-1 shrink-0"><Loader2 size={12} className="animate-spin" />审核中</span>
                  ) : allActive ? (
                    <span className="w-24 text-xs text-green-400 flex items-center gap-1 shrink-0"><CheckCircle size={12} />已入库</span>
                  ) : (
                    <button onClick={handleSubmitAsset} className={`w-24 flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded shrink-0 ${anyFailed ? 'bg-red-700 hover:bg-red-600' : 'bg-orange-600 hover:bg-orange-700'}`}>
                      <Upload size={13} />{anyFailed ? '重试' : '入库'}
                    </button>
                  )}
                  <button
                    onClick={handleResubmitAsset}
                    className="w-20 flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded hover:bg-gray-700 shrink-0"
                    title="强制重新提交（清空旧审核状态重新入库）"
                  >
                    <RefreshCcw size={12} />重提
                  </button>
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setShowVideoRatioMenu(prev => !prev)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                      title="视频比例"
                    >
                      {getVideoRatioLabel(selectedVideoRatio)}
                      <ChevronDown size={12} />
                    </button>
                    {showVideoRatioMenu && (
                      <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
                        {VIDEO_RATIO_OPTIONS.map(option => (
                          <button
                            key={option.value}
                            onClick={() => { setSelectedVideoRatio(option.value); setShowVideoRatioMenu(false); }}
                            className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${option.value === selectedVideoRatio ? 'text-blue-400' : ''}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setShowVideoResolutionMenu(prev => !prev)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                      title="视频分辨率"
                    >
                      {getVideoResolutionLabel(editResolution)}
                      <ChevronDown size={12} />
                    </button>
                    {showVideoResolutionMenu && (
                      <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
                        {VIDEO_RESOLUTION_OPTIONS.map(option => (
                          <button
                            key={option.value}
                            onClick={() => { setEditResolution(option.value); setShowVideoResolutionMenu(false); }}
                            className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${option.value === editResolution ? 'text-blue-400' : ''}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {showVideoModelSelect && (
                    <div className="relative w-32 shrink-0">
                      <button
                        onClick={() => setShowVideoModelMenu(prev => !prev)}
                        className="w-full flex items-center justify-between gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition"
                        title={`当前视频模型：${selectedVideoModel}`}
                      >
                        <span className="truncate">
                          {createnowModelConfig.suggestions.video.find(option => option.model === selectedVideoModel)?.label || selectedVideoModel || '选择模型'}
                        </span>
                        <ChevronDown size={12} className="shrink-0" />
                      </button>
                      {showVideoModelMenu && (
                        <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden min-w-[240px]">
                          <div className="p-2 border-b border-gray-600">
                            <label className="block text-xs text-gray-400 mb-1">自定义模型</label>
                            <input
                              type="text"
                              value={selectedVideoModel}
                              onChange={e => setSelectedVideoModel(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') setShowVideoModelMenu(false);
                                if (e.key === 'Escape') setShowVideoModelMenu(false);
                              }}
                              placeholder="输入视频模型名"
                              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                              autoFocus
                            />
                          </div>
                          <div className="py-1">
                            <div className="px-4 py-1 text-xs text-gray-500">预设模型</div>
                            {(createnowModelConfig.suggestions.video || []).map(option => (
                              <button
                                key={`${option.label}-${option.model}`}
                                onClick={() => { setSelectedVideoModel(option.model); setShowVideoModelMenu(false); }}
                                className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${option.model === selectedVideoModel ? 'text-blue-400' : ''}`}
                                title={option.model}
                              >
                                <span>{option.label}</span>
                                <span className="ml-2 text-xs text-gray-400">{option.model}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={async () => { if (!mergedStoryboard) return; videoGen.handleGenerateVideo(mergedStoryboard, editDuration, selectedVideoRatio, editResolution, editDescription, editDialogue, editAction, editShotType, editCameraAngle, showVideoModelSelect ? selectedVideoModel : undefined); }}
                    disabled={isGenerating || !videoGen.videoPrompt.trim()}
                    className="w-32 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded font-medium shrink-0"
                  >
                    {isGenerating
                      ? <><Loader2 size={14} className="animate-spin" />生成中</>
                      : <><Film size={14} />生成全部</>}
                  </button>
                </div>
              </>
            )}

            {/* Video generating indicator */}
            {isGenerating && (
              <div className="bg-blue-900/30 border border-blue-700 rounded p-2 flex items-center gap-2">
                <Loader2 className="animate-spin text-blue-300 flex-shrink-0" size={13} />
                <span className="text-xs text-blue-300">视频生成中...</span>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── Modal Dialogs ────────────────────────────────────────────────────── */}

      {/* Asset Selector */}
      <AssetSelectorDialog
        show={showAssetSelector}
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
        usedAssetIdsByType={usedAssetIdsByType}
        onClose={() => setShowAssetSelector(false)}
        onAssetsAdded={reloadAssets}
      />

      {/* Image Gallery (asset or storyboard) */}
      {galleryState.show && (
        <ImageGallery
          images={galleryState.images}
          assetName={galleryState.assetName}
          assetId={galleryState.assetId}
          projectId={projectId}
          assetType={galleryState.assetType}
          onSelectPrimary={handleSetPrimaryImage}
          onClose={() => setGalleryState(prev => ({ ...prev, show: false }))}
          onImagesUpdated={async () => {
            if (galleryState.assetType === 'storyboard') {
              await reloadStoryboard();
            } else {
              loadAssetImageStatuses(selectedCharacters, selectedScenes, selectedProps);
            }
          }}
        />
      )}

      {/* Image Edit Dialog */}
      {showImageEdit && storyboard && (
        <ImageEditDialog
          projectId={projectId}
          assetId={storyboardId}
          assetType="storyboard"
          assetName={`分镜 ${storyboard.sequence}`}
          images={storyboardImages}
          onCompleted={reloadStoryboard}
          onClose={() => setShowImageEdit(false)}
        />
      )}

      {/* Video Gallery */}
      {showVideoGallery && (
        <VideoGallery
          projectId={projectId}
          storyboardId={storyboardId}
          episodeId={episodeId}
          onClose={() => { setShowVideoGallery(false); videoGen.loadVideos(storyboard); }}
        />
      )}
    </div>
  );
}
