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
  const currentProject = useProjectStore(s => s.currentProject);

  // ── Core state ──────────────────────────────────────────────────────────────
  const [storyboard, setStoryboard] = useState<any>(null);
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
  // Latest values refs (for auto-save closures)
  const latestTextRef = useRef<any>({});
  const latestAssetsRef = useRef({ selectedCharacters: [] as string[], selectedScenes: [] as string[], selectedProps: [] as string[] });
  const assetStatusesRef = useRef<Record<string, AssetStatus>>({});
  const primaryImageRef = useRef<any>(null);

  // ── Content edit hook ───────────────────────────────────────────────────────
  const contentEdit = useStoryboardContentEdit();
  const {
    editDescription, setEditDescription,
    editDialogue, setEditDialogue,
    editAction, setEditAction,
    editShotType,
    editCameraAngle,
    editDuration, setEditDuration,
    editResolution,
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
    dialogue: editDialogue,
    action: editAction,
    shot_type: editShotType,
    camera_angle: editCameraAngle,
    duration: editDuration,
    resolution: editResolution,
    character_ids: selectedCharacters,
    scene_ids: selectedScenes,
    prop_ids: selectedProps,
  } : null, [storyboard, editDescription, editDialogue, editAction, editShotType, editCameraAngle, editDuration, editResolution, selectedCharacters, selectedScenes, selectedProps]);

  // ── Sync latest refs ────────────────────────────────────────────────────────
  useEffect(() => {
    latestTextRef.current = { editDescription, editDialogue, editAction, editShotType, editCameraAngle, editDuration, editResolution, generatedPrompt, videoPrompt: videoGen.videoPrompt };
  }, [editDescription, editDialogue, editAction, editShotType, editCameraAngle, editDuration, editResolution, generatedPrompt, videoGen.videoPrompt]);

  useEffect(() => {
    latestAssetsRef.current = { selectedCharacters, selectedScenes, selectedProps };
  }, [selectedCharacters, selectedScenes, selectedProps]);

  useEffect(() => {
    assetStatusesRef.current = assetImageStatuses;
  }, [assetImageStatuses]);

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
        setCharacters(charRes.data || []);
        setScenes(sceneRes.data || []);
        setProps(propRes.data || []);
        // Initialize form fields
        resetEditState(sb);
        setSelectedCharacters(sb?.character_ids || []);
        setSelectedScenes(sb?.scene_ids?.length ? sb.scene_ids : (sb?.scene_id ? [sb.scene_id] : []));
        setSelectedProps(sb?.prop_ids || []);
        setGeneratedPrompt(sb?.image_prompt || '');
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

    // 1. 从已有资产数据中直接提取状态（零请求）
    const allAssets = [...characters, ...scenes, ...props];
    const updates: Record<string, AssetStatus> = {};
    const processingIds: string[] = [];

    for (const assetId of allIds) {
      const asset = allAssets.find(a => a.asset_id === assetId);
      if (asset) {
        updates[assetId] = {
          asset_id: asset.volcengine_asset_id,
          status: asset.volcengine_asset_status,
          image_id: asset.image_id,
        };
        if (asset.volcengine_asset_status === 'Processing') {
          processingIds.push(assetId);
        }
      }
    }
    setAssetImageStatuses(prev => ({ ...prev, ...updates }));

    // 2. 只对 Processing 状态的资产发请求获取最新状态
    if (processingIds.length > 0) {
      await Promise.all(processingIds.map(async (assetId) => {
        try {
          const res = await generationApi.listImages(projectId, assetId);
          const imgs: any[] = res.data || [];
          const primary = imgs.find(i => i.is_primary) || imgs[0];
          if (primary) {
            setAssetImageStatuses(prev => ({
              ...prev,
              [assetId]: { asset_id: primary.volcengine_asset_id, status: primary.volcengine_asset_status, image_id: primary.image_id },
            }));
          }
        } catch {}
      }));
    }
  }, [projectId, characters, scenes, props]);

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
        await storyboardApi.update(projectId, storyboardId, {
          description: v.editDescription?.trim() || '',
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

  useEffect(() => { scheduleSave(); }, [editDescription, editDialogue, editAction, editShotType, editCameraAngle, editDuration, editResolution, generatedPrompt]); // eslint-disable-line
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
        });
      } catch {}
    }, 300);
  }, [projectId, storyboardId]);

  useEffect(() => { scheduleAssetSave(); }, [selectedCharacters.join(','), selectedScenes.join(','), selectedProps.join(',')]); // eslint-disable-line

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

  // Keep ref in sync so recomputeConnections (useCallback []) can read current value
  useEffect(() => { primaryImageRef.current = primaryImage; }, [primaryImage]);

  const trackingId = primaryImage?.image_id ?? storyboardId;

  const handleSubmitAsset = useCallback(async () => {
    const imageIds: string[] = [];
    // 建立 imageId → localAssetId 映射，用于轮询时写入正确的 key
    const imageToLocalAsset: Record<string, string> = {};
    if (primaryImage?.image_id) {
      imageIds.push(primaryImage.image_id);
      imageToLocalAsset[primaryImage.image_id] = storyboardId; // 分镜主图用 storyboardId
    }
    for (const charId of latestAssetsRef.current.selectedCharacters) {
      const imgId = assetStatusesRef.current[charId]?.image_id || characters.find((c: any) => c.asset_id === charId)?.image_id;
      if (imgId && !imageIds.includes(imgId)) { imageIds.push(imgId); imageToLocalAsset[imgId] = charId; }
    }
    for (const sceneId of latestAssetsRef.current.selectedScenes) {
      const imgId = assetStatusesRef.current[sceneId]?.image_id || scenes.find((s: any) => s.asset_id === sceneId)?.image_id;
      if (imgId && !imageIds.includes(imgId)) { imageIds.push(imgId); imageToLocalAsset[imgId] = sceneId; }
    }
    for (const propId of latestAssetsRef.current.selectedProps) {
      const imgId = assetStatusesRef.current[propId]?.image_id || props.find((p: any) => p.asset_id === propId)?.image_id;
      if (imgId && !imageIds.includes(imgId)) { imageIds.push(imgId); imageToLocalAsset[imgId] = propId; }
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
  }, [projectId, trackingId, primaryImage, storyboard, storyboardId, characters, scenes, props, reloadStoryboard, reloadAssets, loadAssetImageStatuses, videoGen, toast]);

  const handleResubmitAsset = useCallback(async () => {
    const imageIds: string[] = [];
    const imageToLocalAsset: Record<string, string> = {};
    if (primaryImage?.image_id) {
      imageIds.push(primaryImage.image_id);
      imageToLocalAsset[primaryImage.image_id] = storyboardId;
    }
    for (const charId of latestAssetsRef.current.selectedCharacters) {
      const imgId = assetStatusesRef.current[charId]?.image_id || characters.find((c: any) => c.asset_id === charId)?.image_id;
      if (imgId && !imageIds.includes(imgId)) { imageIds.push(imgId); imageToLocalAsset[imgId] = charId; }
    }
    for (const sceneId of latestAssetsRef.current.selectedScenes) {
      const imgId = assetStatusesRef.current[sceneId]?.image_id || scenes.find((s: any) => s.asset_id === sceneId)?.image_id;
      if (imgId && !imageIds.includes(imgId)) { imageIds.push(imgId); imageToLocalAsset[imgId] = sceneId; }
    }
    for (const propId of latestAssetsRef.current.selectedProps) {
      const imgId = assetStatusesRef.current[propId]?.image_id || props.find((p: any) => p.asset_id === propId)?.image_id;
      if (imgId && !imageIds.includes(imgId)) { imageIds.push(imgId); imageToLocalAsset[imgId] = propId; }
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
  }, [projectId, trackingId, primaryImage, storyboard, storyboardId, characters, scenes, props, reloadStoryboard, reloadAssets, videoGen, toast]);

  // ── Action handlers ────────────────────────────────────────────────────────
  const handleBack = () => navigate(`/project/${projectId}`, { state: { episodeId } });

  const handleGenerateImage = async () => {
    if (!mergedStoryboard) return;
    await imageManagement.handleGenerateImageFromEdit(
      mergedStoryboard, generatedPrompt, selectedCharacters, selectedScenes, selectedProps,
      characters, scenes, props, setStoryboardImages
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
      } else {
        // Reload asset gallery images
        const res = await generationApi.listImages(projectId, galleryState.assetId);
        setGalleryState(prev => ({ ...prev, images: res.data || [] }));
        loadAssetImageStatuses(selectedCharacters, selectedScenes, selectedProps);
      }
    } catch { toast('设置主图失败', 'error'); }
  };

  const handleExport = () => videoGen.handleExport(storyboard);
  const handleDownload = () => videoGen.handleDownload(storyboard);

  // ── Volcengine status summary ───────────────────────────────────────────────
  const allStatuses = useMemo(() => {
    const s: (string | undefined)[] = [];
    if (primaryImage) s.push(assetImageStatuses[primaryImage.image_id]?.status ?? primaryImage.volcengine_asset_status);
    for (const id of selectedCharacters) s.push(assetImageStatuses[id]?.status);
    for (const id of selectedScenes) s.push(assetImageStatuses[id]?.status);
    for (const id of selectedProps) s.push(assetImageStatuses[id]?.status);
    return s;
  }, [primaryImage, assetImageStatuses, selectedCharacters, selectedScenes, selectedProps]);

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
    <div className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden">
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
                    <label className="block text-[10px] text-gray-500 mb-0.5">画面描述 *</label>
                    <textarea
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                      rows={12}
                      placeholder="描述画面..."
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
              <button onClick={handleOpenStoryboardGallery} className="text-[11px] text-green-400 hover:text-green-300 flex items-center gap-1">
                <ImagePlus size={11} />管理图库
              </button>
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
            {visibleImages.length > 1 && (
              <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
                {visibleImages.slice(0, 6).map(img => (
                  <div key={img.image_id} className="relative flex-shrink-0">
                    <img
                      src={getImageUrl(img, projectId).replace('/images/files/', '/thumbnails/')}
                      alt=""
                      className={`w-12 h-12 object-cover rounded cursor-pointer border-2 transition ${img.is_primary ? 'border-blue-500' : 'border-transparent hover:border-gray-500'}`}
                      onClick={handleOpenStoryboardGallery}
                    />
                    {img.is_primary && <div className="absolute top-0 right-0 bg-blue-600 text-[9px] px-0.5 rounded-bl">主</div>}
                  </div>
                ))}
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
                    setPendingMessage({ key: `${projectId}_${episodeId}`, message: `为分镜 ${storyboard.asset_id}（序号 #${storyboard.sequence}）生成图片提示词，只更新这一个分镜，不要修改其他分镜。根据以下画面描述生成：\n${editDescription}\n########` });
                    openVibeDrama();
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
            <div className="flex gap-2 mt-2 flex-shrink-0">
              <button
                onClick={handleGenerateImage}
                disabled={!generatedPrompt || getTaskStatus(storyboardId, 'image') === 'generating'}
                className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded"
              >
                {getTaskStatus(storyboardId, 'image') === 'generating'
                  ? <><Loader2 size={14} className="animate-spin" />生成中...</>
                  : <><ImagePlus size={14} />生成图片</>}
              </button>
              <button
                onClick={() => setShowImageEdit(true)}
                disabled={!primaryImage || getTaskStatus(storyboardId, 'image') === 'generating' || getTaskStatus(storyboardId, 'image_edit') === 'generating'}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:text-gray-500 rounded"
              >
                {getTaskStatus(storyboardId, 'image_edit') === 'generating'
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Edit3 size={14} />}
                编辑图片
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
                    <button
                      onClick={() => {
                        if (!storyboard) return;
                        setVibeDramaContext({ projectId, projectName: currentProject?.name || '', episodeId, tabName: 'storyboard', label: `分镜 #${storyboard.sequence}` });
                        openVibeDrama();
                        setPendingMessage({ key: `${projectId}_${episodeId}`, message: `为分镜 ${storyboard.asset_id}（序号 #${storyboard.sequence}）生成视频提示词，只更新这一个分镜，不要修改其他分镜。根据以下画面描述生成：\n${editDescription}\n########` });
                      }}
                      disabled={getTaskStatus(storyboardId, 'video_prompt') === 'generating' || !editDescription}
                      className="text-xs flex items-center gap-1 text-purple-400 hover:text-purple-300 disabled:text-gray-600"
                    >
                      {getTaskStatus(storyboardId, 'video_prompt') === 'generating'
                        ? <><Loader2 size={11} className="animate-spin" />生成中...</>
                        : <><Wand2 size={11} />AI生成</>}
                    </button>
                  </div>
                  <textarea
                    value={videoGen.videoPrompt}
                    onChange={e => videoGen.handlePromptChange(e.target.value)}
                    className="w-full flex-1 min-h-0 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                    placeholder="输入视频提示词，或点击上方按钮AI生成..."
                  />
                  <div className="flex gap-2 mt-2 flex-shrink-0">
                    {isSubmitting || anyProcessing ? (
                      <span className="text-xs text-yellow-400 flex items-center gap-1 flex-1"><Loader2 size={12} className="animate-spin" />审核中...</span>
                    ) : allActive ? (
                      <span className="text-xs text-green-400 flex items-center gap-1 flex-1"><CheckCircle size={12} />素材已入库</span>
                    ) : (
                      <button
                        onClick={handleSubmitAsset}
                        className={`flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded ${anyFailed ? 'bg-red-700 hover:bg-red-600' : 'bg-orange-600 hover:bg-orange-700'}`}
                      >
                        <Upload size={14} />{anyFailed ? '重试提交' : '提交素材'}
                      </button>
                    )}
                    <button
                      onClick={handleResubmitAsset}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded hover:bg-gray-700"
                      title="强制重新提交（清空旧审核状态重新入库）"
                    >
                      <RefreshCcw size={12} />重新提交
                    </button>
                    <button
                      onClick={async () => { if (!mergedStoryboard) return; videoGen.handleGenerateVideo(mergedStoryboard, editDuration, editResolution, editDescription, editDialogue, editAction, editShotType, editCameraAngle); }}
                      disabled={isGenerating || !videoGen.videoPrompt.trim()}
                      className="flex-1 flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded font-medium"
                    >
                      {isGenerating ? <><Loader2 size={14} className="animate-spin" />生成中...</> : <><Film size={14} />生成视频</>}
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
                            onClick={async () => { if (!mergedStoryboard) return; videoGen.handleGenerateVideoSegment(mergedStoryboard, idx, editDuration, editResolution, editDescription, editDialogue, editAction, editShotType, editCameraAngle); }}
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
                <div className="flex flex-col gap-2 border-t border-gray-700 pt-3">
                  {isSubmitting || anyProcessing ? (
                    <span className="text-xs text-yellow-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" />审核中...</span>
                  ) : allActive ? (
                    <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={12} />素材已入库</span>
                  ) : (
                    <button onClick={handleSubmitAsset} className={`flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded ${anyFailed ? 'bg-red-700 hover:bg-red-600' : 'bg-orange-600 hover:bg-orange-700'}`}>
                      <Upload size={14} />{anyFailed ? '部分失败，重试提交' : '提交素材'}
                    </button>
                  )}
                  <button
                    onClick={handleResubmitAsset}
                    className="flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded hover:bg-gray-700 border border-gray-700"
                    title="强制重新提交（清空旧审核状态重新入库）"
                  >
                    <RefreshCcw size={12} />强制重新提交
                  </button>
                  <button
                    onClick={async () => { if (!mergedStoryboard) return; videoGen.handleGenerateVideo(mergedStoryboard, editDuration, editResolution, editDescription, editDialogue, editAction, editShotType, editCameraAngle); }}
                    disabled={isGenerating || !videoGen.videoPrompt.trim()}
                    className="flex items-center justify-center gap-1.5 text-sm px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded font-medium"
                  >
                    {isGenerating
                      ? <><Loader2 size={15} className="animate-spin" />生成中...</>
                      : <><Film size={15} />生成全部 {videoSegments.length} 段视频</>}
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
