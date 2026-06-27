import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Upload, X, Film, ChevronDown, Loader2, Play,
  Clock, CheckCircle, XCircle, Image, Volume2, VolumeX, Music
} from 'lucide-react';
import { useAssetStore } from '@/store/assetStore';
import { useAdminAuthStore } from '@/store/adminAuthStore';
import { useSaasAuthStore } from '@/store/saasAuthStore';
import { generationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import { getVideoUrl } from '@/components/storyboard/utils/mediaUtils';
import { VideoGallery } from '@/components/storyboard/VideoGallery';
import { ExpandableText } from '@/components/common/ExpandableText';
import { translateError } from '@/utils/errorMessages';
import { useCreatenowModelConfigStore, IMAGE_SIZE_OPTIONS, VIDEO_RATIO_OPTIONS, VIDEO_RESOLUTION_OPTIONS } from '@/store/createnowModelConfigStore';
import { useProjectStore } from '@/store/projectStore';
import { CreatenowModelSelector, GenerationOptionSelector } from '@/components/common/GenerationSelectors';
import { getDefaultImageSize, getDefaultServiceModel, getDefaultVideoSpec } from '@/utils/generationDefaults';
import { isAssetUnsupportedVideoModel } from '@/utils/assetReview';
import { AssetPickerPanel, getAssetImageUrl } from '@/components/assets/AssetPickerPanel';

interface RefMedia {
  type: 'image' | 'video' | 'audio';
  id?: string;      // image_id 或 media_id
  url: string;      // 图片展示 URL 或视频/音频公网 URL
  name: string;
  sourceAssetId?: string;
  sourceAssetType?: 'character' | 'scene' | 'prop';
  volcengineAssetId?: string;
  volcengineStatus?: string;
}

interface VideoRecord {
  video_id: string;
  storyboard_id: string | null;
  episode_id: string | null;
  prompt: string;
  video_path: string | null;
  local_path?: string;
  duration: number;
  resolution: string;
  ratio?: string;
  estimated_cost?: number;
  actual_cost?: number;
  credits_consumed?: number;
  model: string;
  status: string;
  created_at: string;
  created_by?: string;
  task_id?: string;
  poll_count?: number;
  last_poll_time?: string | null;
  last_poll_response?: any;
  error?: string;
  generate_audio?: boolean | null;
  reference_media?: RefMedia[];
}

function isInternalAssetVideo(media: RefMedia): boolean {
  return media.type === 'video' && media.url?.startsWith('asset://');
}

function getReferenceMediaKey(media: RefMedia): string {
  if (media.type === 'video' || media.type === 'audio') {
    return `${media.type}:${media.url || media.id || media.name || ''}`;
  }
  return `image:${media.id || media.url || media.name || ''}`;
}

function dedupeReferenceMedia(mediaList?: RefMedia[]): RefMedia[] {
  const deduped: RefMedia[] = [];
  const seen = new Set<string>();
  for (const media of mediaList || []) {
    if (isInternalAssetVideo(media)) continue;
    const key = getReferenceMediaKey(media);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(media);
  }
  return deduped;
}

interface ImageRecord {
  image_id: string;
  asset_id: string;
  asset_type: string;
  prompt: string;
  image_path?: string | null;
  local_path?: string;
  width?: number;
  height?: number;
  created_at: string;
  created_by?: string;
  is_primary?: boolean;
  estimated_cost?: number;
  actual_cost?: number;
  credits_consumed?: number;
  status?: 'pending' | 'completed' | 'failed';
  error?: string;
  isPlaceholder?: boolean;
  size?: string;
  reference_image_ids?: string[];
  reference_image_urls?: string[];
  reference_media?: RefMedia[];
}

interface GenerateTabProps {
  projectId: string;
  showAssetSubmit?: boolean;
  imageApiType?: string;
  videoApiType?: string;
}

const HISTORY_PAGE_SIZE = 60;

const LEGACY_RESOLUTION_MAP: Record<string, string> = {
  '1280x720': '720p',
  '720x1280': '720p',
  '21:9-720p': '720p',
};

function normalizeResolutionValue(resolution?: string): string {
  if (!resolution) return '720p';
  if (VIDEO_RESOLUTION_OPTIONS.some(r => r.value === resolution)) return resolution;
  return LEGACY_RESOLUTION_MAP[resolution] || '720p';
}

function inferRatioFromVideo(video: Pick<VideoRecord, 'ratio' | 'resolution'>): string {
  if (video.ratio && VIDEO_RATIO_OPTIONS.some(r => r.value === video.ratio)) return video.ratio;
  if (video.resolution === '720x1280') return '9:16';
  if (video.resolution === '21:9-720p') return '21:9';
  return '16:9';
}

function VideoStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle size={14} className="text-green-400" />;
  if (status === 'failed') return <XCircle size={14} className="text-red-400" />;
  if (status === 'poll_failed') return <XCircle size={14} className="text-orange-400" />;
  return <Loader2 size={14} className="text-blue-400 animate-spin" />;
}

function VideoStatusText({ status }: { status: string }) {
  if (status === 'completed') return <span className="text-green-400">已完成</span>;
  if (status === 'failed') return <span className="text-red-400">生成失败</span>;
  if (status === 'poll_failed') return <span className="text-orange-400">轮询异常</span>;
  if (status === 'in_progress') return <span className="text-blue-400">生成中...</span>;
  return <span className="text-yellow-400">等待中...</span>;
}

function getAssetStatusKey(item: Pick<RefMedia, 'type' | 'id' | 'url'>): string | null {
  if (item.type === 'image') return item.id ? `image:${item.id}` : null;
  if (item.type === 'video') return item.id ? `video:${item.id}` : (item.url ? `video:${item.url}` : null);
  return null;
}

function getThumbnailUrl(url?: string): string {
  if (!url) return '';
  return url.replace('/images/files/', '/thumbnails/');
}

function getCurrentUserLabel(adminUsername: string | null, saasUser: { display_name?: string; email?: string } | null): string {
  return saasUser?.display_name || saasUser?.email || adminUsername || '';
}

function filterMineItems<T>(items: T[], currentUserLabel: string, onlyMine: boolean): T[] {
  if (!onlyMine || !currentUserLabel) return items;
  return items.filter(item => (((item as any).created_by || '') === currentUserLabel));
}

function getImageRecordUrl(projectId: string, image: ImageRecord): string {
  if (image.local_path) {
    return `/api/projects/${projectId}/images/files/${image.local_path}`;
  }
  return image.image_path || '';
}

function resolveGenerationCredits(record: { credits_consumed?: number; actual_cost?: number; estimated_cost?: number }, fallback: number): number {
  if (typeof record.credits_consumed === 'number') return record.credits_consumed;
  if (typeof record.actual_cost === 'number') return record.actual_cost;
  if (typeof record.estimated_cost === 'number') return record.estimated_cost;
  return fallback;
}

function formatCredits(value: number): string {
  return `${Math.round(value)} 积分`;
}

export function GenerateTab({ projectId, showAssetSubmit = false, imageApiType, videoApiType }: GenerateTabProps) {
  const { toast } = useToast();
  const { characters, scenes, props } = useAssetStore();
  const adminUsername = useAdminAuthStore(state => state.username);
  const saasUser = useSaasAuthStore(state => state.user);
  const createnowModelConfig = useCreatenowModelConfigStore(state => state.config);
  const fetchCreatenowModelConfig = useCreatenowModelConfigStore(state => state.fetchConfig);
  const currentProject = useProjectStore(state => state.currentProject);
  const defaultVideoSpec = getDefaultVideoSpec(currentProject);

  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'video' | 'image'>('video');
  const [selectedImageModel, setSelectedImageModel] = useState(() => getDefaultServiceModel(currentProject, createnowModelConfig, 'image'));
  const [selectedVideoModel, setSelectedVideoModel] = useState(() => getDefaultServiceModel(currentProject, createnowModelConfig, 'video'));
  const [onlyMine, setOnlyMine] = useState(false);
  const [duration, setDuration] = useState(6);
  const [resolution, setResolution] = useState(defaultVideoSpec.resolution);
  const [ratio, setRatio] = useState(defaultVideoSpec.ratio);
  const [imageSize, setImageSize] = useState(() => getDefaultImageSize(currentProject, 'storyboard'));
  const [generateAudio, setGenerateAudio] = useState(true);
  const [selectedMedia, setSelectedMedia] = useState<RefMedia[]>([]);
  const [allVideos, setAllVideos] = useState<VideoRecord[]>([]);
  const [allImages, setAllImages] = useState<ImageRecord[]>([]);
  const [videoVisibleCount, setVideoVisibleCount] = useState(0);
  const [imageVisibleCount, setImageVisibleCount] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [pendingImageCount, setPendingImageCount] = useState(0);
  const [showDurationMenu, setShowDurationMenu] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ImageRecord | null>(null);
  const [previewMedia, setPreviewMedia] = useState<RefMedia | null>(null);
  const [hasLoadedVideos, setHasLoadedVideos] = useState(false);
  const [hasLoadedImages, setHasLoadedImages] = useState(false);
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  // 素材审核
  const [isSubmittingAssets, setIsSubmittingAssets] = useState(false);
  const [assetStatuses, setAssetStatuses] = useState<Record<string, { assetId?: string; status?: string }>>({});

  useEffect(() => {
    fetchCreatenowModelConfig();
  }, [fetchCreatenowModelConfig]);

  useEffect(() => {
    const nextVideoSpec = getDefaultVideoSpec(currentProject);
    setSelectedImageModel(getDefaultServiceModel(currentProject, createnowModelConfig, 'image'));
    setSelectedVideoModel(getDefaultServiceModel(currentProject, createnowModelConfig, 'video'));
    setImageSize(getDefaultImageSize(currentProject, 'storyboard'));
    setRatio(nextVideoSpec.ratio);
    setResolution(nextVideoSpec.resolution);
  }, [currentProject, createnowModelConfig]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const videoListRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const historyReadyRef = useRef(false);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (videoListRef.current) {
      videoListRef.current.scrollTop = videoListRef.current.scrollHeight;
    }
  }, []);

  const currentUserLabel = getCurrentUserLabel(adminUsername, saasUser);

  const filteredVideos = useMemo(
    () => filterMineItems(allVideos, currentUserLabel, onlyMine),
    [allVideos, currentUserLabel, onlyMine]
  );

  const filteredImages = useMemo(
    () => filterMineItems(allImages, currentUserLabel, onlyMine),
    [allImages, currentUserLabel, onlyMine]
  );

  const activeListLength = mode === 'video' ? filteredVideos.length : filteredImages.length;
  const activeVisibleCount = mode === 'video' ? videoVisibleCount : imageVisibleCount;
  const hasMoreHistory = activeListLength > activeVisibleCount;

  // 加载视频库：只按项目首次加载，不受 mode/onlyMine 影响
  const loadLibraryVideos = useCallback(async () => {
    try {
      const res = await generationApi.listLibraryVideos(projectId);
      const list: VideoRecord[] = res.data || [];
      const asc = [...list].reverse();
      setAllVideos(asc);
      setVideoVisibleCount(Math.min(HISTORY_PAGE_SIZE, asc.length));
      setHasLoadedVideos(true);
      shouldStickToBottomRef.current = true;
      historyReadyRef.current = false;
    } catch { /* ignore */ }
  }, [projectId]);

  const loadLibraryImages = useCallback(async () => {
    try {
      const res = await generationApi.listLibraryImages(projectId);
      const list: ImageRecord[] = res.data || [];
      const asc = [...list].reverse();
      setAllImages(asc);
      setImageVisibleCount(Math.min(HISTORY_PAGE_SIZE, asc.length));
      setHasLoadedImages(true);
      shouldStickToBottomRef.current = true;
      historyReadyRef.current = false;
    } catch { /* ignore */ }
  }, [projectId]);

  const handleLibraryVideoCreated = useCallback((video: Partial<VideoRecord> & { video_id: string }) => {
    const normalizedVideo: VideoRecord = {
      ...video,
      video_id: video.video_id,
      storyboard_id: video.storyboard_id ?? null,
      episode_id: video.episode_id ?? null,
      prompt: video.prompt || '',
      video_path: video.video_path ?? null,
      duration: video.duration ?? 0,
      resolution: video.resolution || '',
      model: video.model || '',
      status: video.status || 'pending',
      created_at: video.created_at || new Date().toISOString(),
    };
    setAllVideos(prev => {
      if (prev.some(item => item.video_id === normalizedVideo.video_id)) return prev;
      return [...prev, normalizedVideo];
    });
    setVideoVisibleCount(prev => Math.max(prev, Math.min(HISTORY_PAGE_SIZE, prev + 1)));
    shouldStickToBottomRef.current = true;
  }, []);

  const visibleVideos = useMemo(() => {
    if (videoVisibleCount <= 0) return [];
    return filteredVideos.slice(-videoVisibleCount);
  }, [filteredVideos, videoVisibleCount]);

  const visibleImages = useMemo(() => {
    if (imageVisibleCount <= 0) return [];
    return filteredImages.slice(-imageVisibleCount);
  }, [filteredImages, imageVisibleCount]);

  const loadMoreHistory = useCallback(() => {
    if (!hasMoreHistory || isLoadingHistory) return;
    const container = videoListRef.current;
    const prevHeight = container?.scrollHeight || 0;
    setIsLoadingHistory(true);
    if (mode === 'video') {
      setVideoVisibleCount(prev => Math.min(filteredVideos.length, prev + HISTORY_PAGE_SIZE));
    } else {
      setImageVisibleCount(prev => Math.min(filteredImages.length, prev + HISTORY_PAGE_SIZE));
    }
    requestAnimationFrame(() => {
      if (container) {
        const nextHeight = container.scrollHeight;
        container.scrollTop = nextHeight - prevHeight + container.scrollTop;
      }
      setIsLoadingHistory(false);
    });
  }, [hasMoreHistory, isLoadingHistory, mode, filteredVideos.length, filteredImages.length]);

  useEffect(() => {
    setAllVideos([]);
    setAllImages([]);
    setVideoVisibleCount(0);
    setImageVisibleCount(0);
    setHasLoadedVideos(false);
    setHasLoadedImages(false);
  }, [projectId]);

  useEffect(() => {
    if (mode === 'video' && !hasLoadedVideos) {
      loadLibraryVideos();
    } else if (mode === 'image' && !hasLoadedImages) {
      loadLibraryImages();
    }
  }, [mode, hasLoadedVideos, hasLoadedImages, loadLibraryVideos, loadLibraryImages]);

  useEffect(() => {
    if (mode === 'video' && videoVisibleCount === 0 && filteredVideos.length > 0) {
      setVideoVisibleCount(Math.min(HISTORY_PAGE_SIZE, filteredVideos.length));
    }
    if (mode === 'image' && imageVisibleCount === 0 && filteredImages.length > 0) {
      setImageVisibleCount(Math.min(HISTORY_PAGE_SIZE, filteredImages.length));
    }
  }, [mode, videoVisibleCount, imageVisibleCount, filteredVideos.length, filteredImages.length]);

  // 历史新增后滚动到底部（仅在用户停留底部时）
  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    setTimeout(() => {
      scrollToBottom();
      historyReadyRef.current = true;
    }, 50);
  }, [mode === 'video' ? visibleVideos.length : visibleImages.length, scrollToBottom]);

  const handleVideoListScroll = useCallback(() => {
    const el = videoListRef.current;
    if (!el) return;
    if (!historyReadyRef.current) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    shouldStickToBottomRef.current = nearBottom;
    if (el.scrollTop < 80 && hasMoreHistory && !isLoadingHistory) {
      loadMoreHistory();
    }
  }, [hasMoreHistory, isLoadingHistory, loadMoreHistory]);

  // 启动视频轮询
  const startPolling = useCallback((videoId: string) => {
    if (pollingRef.current.has(videoId)) return;
    setPollingIds(prev => new Set([...prev, videoId]));
    const timer = setInterval(async () => {
      try {
        const res = await generationApi.pollVideo(projectId, videoId);
        const updated: VideoRecord = res.data;
        setAllVideos(prev => prev.map(v => v.video_id === videoId ? updated : v));
        if (updated.status === 'completed' || updated.status === 'failed' || updated.status === 'poll_failed') {
          clearInterval(timer);
          pollingRef.current.delete(videoId);
          setPollingIds(prev => { const s = new Set(prev); s.delete(videoId); return s; });
        }
      } catch {
        clearInterval(timer);
        pollingRef.current.delete(videoId);
      }
    }, 15000);
    pollingRef.current.set(videoId, timer);
  }, [projectId]);

  useEffect(() => () => { pollingRef.current.forEach(t => clearInterval(t)); }, []);

  // 对已有 pending/in_progress 视频自动轮询
  useEffect(() => {
    allVideos.forEach(v => {
      if ((v.status === 'pending' || v.status === 'in_progress') && !pollingRef.current.has(v.video_id)) {
        startPolling(v.video_id);
      }
    });
  }, [allVideos, startPolling]);

  const createPendingImage = useCallback((textPrompt: string, refs: RefMedia[]): ImageRecord => ({
    image_id: `pending-${crypto.randomUUID()}`,
    asset_id: 'square-generate',
    asset_type: 'generate',
    prompt: textPrompt,
    created_at: new Date().toISOString(),
    created_by: currentUserLabel,
    status: 'pending',
    isPlaceholder: true,
    image_path: null,
    local_path: undefined,
    size: imageSize,
    reference_image_ids: refs.filter(m => m.type === 'image' && m.id).map(m => m.id!),
    reference_image_urls: refs.filter(m => m.type === 'image' && !m.id && m.url).map(m => m.url),
    reference_media: refs.filter(m => m.type === 'image'),
  }), [currentUserLabel, imageSize]);

  const buildImageReferenceMedia = useCallback((image: ImageRecord): RefMedia[] => {
    if (image.reference_media?.length) {
      return dedupeReferenceMedia(image.reference_media.filter(media => media.type === 'image'));
    }

    const refs: RefMedia[] = [];
    const imageById = new Map(allImages.map(item => [item.image_id, item]));
    const referenceImageIds = image.reference_image_ids || [];
    const referenceImageUrls = image.reference_image_urls || [];

    referenceImageIds.forEach((id, index) => {
      const ref = imageById.get(id);
      const url = ref ? getImageRecordUrl(projectId, ref) : (referenceImageUrls[index] || '');
      if (!url) return;
      if (refs.some(item => item.url === url || item.id === id)) return;
      refs.push({
        type: 'image',
        id,
        url,
        name: ref?.prompt || '参考图',
      });
    });
    referenceImageUrls.forEach(url => {
      if (!url) return;
      if (refs.some(ref => ref.url === url)) return;
      refs.push({ type: 'image', url, name: '参考图' });
    });
    return refs;
  }, [allImages, projectId]);

  const handleRegenerateImage = useCallback((image: ImageRecord) => {
    setMode('image');
    setPrompt(image.prompt || '');
    setSelectedMedia(buildImageReferenceMedia(image));
    if (image.size && IMAGE_SIZE_OPTIONS.some(option => option.value === image.size)) {
      setImageSize(image.size);
      return;
    }
    const width = (image as any).width;
    const height = (image as any).height;
    if (width && height) {
      const ratioKey = `${width}:${height}`;
      const byPixels: Record<string, string> = {
        '2048:1152': '16x9',
        '1152:2048': '9x16',
        '1536:1536': '1x1',
        '1536:1152': '4x3',
        '1152:1536': '3x4',
      };
      if (byPixels[ratioKey]) {
        setImageSize(byPixels[ratioKey]);
      }
    }
  }, [buildImageReferenceMedia]);

  const handleEditImage = useCallback((image: ImageRecord) => {
    const imageUrl = getImageRecordUrl(projectId, image);
    if (!imageUrl) return;
    setMode('image');
    setSelectedMedia(prev => {
      if (prev.some(item => item.type === 'image' && item.id === image.image_id)) {
        return prev;
      }
      return [...prev, {
        type: 'image',
        id: image.image_id,
        url: imageUrl,
        name: image.prompt || '广场图片',
      }];
    });
  }, [projectId]);

  // 生成视频
  const handleGenerate = async () => {
    if (!prompt.trim()) { toast(mode === 'video' ? '请输入视频提示词' : '请输入图片提示词', 'error'); return; }

    const trimmedPrompt = prompt.trim();
    const imageItems = selectedMedia.filter(m => m.type === 'image' && m.id);
    const videoItems = selectedMedia.filter(m => m.type === 'video');
    const audioItems = selectedMedia.filter(m => m.type === 'audio');
    const resolvedVideoUrls = videoItems.map(m => {
      const key = getAssetStatusKey(m);
      const audit = key ? assetStatuses[key] : undefined;
      if (audit?.assetId && audit.status === 'Active') {
        return `asset://${audit.assetId}`;
      }
      return m.url;
    });

    try {
      if (mode === 'image') {
        const placeholder = createPendingImage(trimmedPrompt, selectedMedia);
        setAllImages(prev => [...prev, placeholder]);
        setImageVisibleCount(prev => Math.min(filteredImages.length + 1, Math.max(prev, 0) + 1));
        shouldStickToBottomRef.current = true;
        setPendingImageCount(count => count + 1);
        try {
          const referenceImageIds = imageItems.map(m => m.id!);
          const referenceImageUrls = selectedMedia
            .filter(m => m.type === 'image' && !m.id && m.url)
            .map(m => m.url);
          const response = await (imageItems.length > 0
            ? generationApi.editSquareImage(projectId, {
                prompt: trimmedPrompt,
                size: imageSize,
                referenceImageIds,
                referenceImageUrls,
                referenceMedia: selectedMedia.filter(m => m.type === 'image'),
                model: imageApiType === 'createnow' ? selectedImageModel.trim() || undefined : undefined,
              })
            : generationApi.generateSquareImage(projectId, {
                prompt: trimmedPrompt,
                size: imageSize,
                model: imageApiType === 'createnow' ? selectedImageModel.trim() || undefined : undefined,
              }));
          const savedImage: ImageRecord = response.data;
          setAllImages(prev => prev.map(image => image.image_id === placeholder.image_id ? savedImage : image));
          const imageCredits = resolveGenerationCredits(savedImage, 100);
          toast(`图片生成成功（消耗 ${formatCredits(imageCredits)}）`, 'success');
        } catch (e: any) {
          const errorMessage = e?.response?.data?.detail || '图片生成失败，请检查配置';
          setAllImages(prev => prev.map(image => image.image_id === placeholder.image_id ? {
            ...image,
            status: 'failed',
            error: String(errorMessage),
            isPlaceholder: false,
          } : image));
          toast(errorMessage, 'error');
        } finally {
          setPendingImageCount(count => Math.max(0, count - 1));
        }
        return;
      }

      setIsGeneratingVideo(true);
      const res = await generationApi.generateVideo(projectId, {
        storyboard_id: null,
        episode_id: null,
        image_ids: imageItems.map(m => m.id!),
        video_urls: resolvedVideoUrls.length > 0 ? resolvedVideoUrls : undefined,
        audio_urls: audioItems.length > 0 ? audioItems.map(m => m.url) : undefined,
        prompt: trimmedPrompt,
        duration,
        resolution,
        ratio,
        generate_audio: generateAudio,
        reference_media: selectedMedia.map(m => ({
          type: m.type,
          id: m.id,
          url: m.url,
          name: m.name,
          sourceAssetId: m.sourceAssetId,
          sourceAssetType: m.sourceAssetType,
        })),
        model: videoApiType === 'createnow' ? selectedVideoModel.trim() || undefined : undefined,
      });
      const newVideo: VideoRecord = res.data;
      setAllVideos(prev => [...prev, newVideo]);
      setVideoVisibleCount(prev => {
        const base = prev > 0 ? prev : Math.min(HISTORY_PAGE_SIZE, filteredVideos.length + 1);
        return Math.min(filteredVideos.length + 1, base + 1);
      });
      shouldStickToBottomRef.current = true;
      startPolling(newVideo.video_id);
      const estimatedCost = resolveGenerationCredits(newVideo, newVideo.duration * 200);
      toast(`视频生成任务已提交（预计消耗 ${formatCredits(estimatedCost)}）`, 'success');
    } catch (e: any) {
      const errorMessage = e?.response?.data?.detail || '生成失败，请检查配置';
      toast(errorMessage, 'error');
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  // 重新生成（恢复参数）
  const handleRegenerate = (video: VideoRecord) => {
    setPrompt(video.prompt);
    setDuration(video.duration);
    setResolution(normalizeResolutionValue(video.resolution));
    setRatio(inferRatioFromVideo(video));
    if (video.generate_audio != null) setGenerateAudio(video.generate_audio);
    setSelectedMedia(dedupeReferenceMedia(video.reference_media));
    // 清空审核状态，让用户重新触发（若需要）
    setAssetStatuses({});
  };

  const addAssetMedia = (asset: any): boolean => {
    const imgId = asset.image_id;
    if (!imgId) { toast('该资产暂无主图', 'error'); return false; }
    if (selectedMedia.find(m => m.id === imgId || m.sourceAssetId === asset.asset_id)) { return true; }
    if (selectedMedia.filter(m => m.type === 'image').length >= 10) { toast('最多支持10张参考图片', 'error'); return false; }
    const newItem: RefMedia = {
      type: 'image',
      id: imgId,
      url: getAssetImageUrl(asset),
      name: asset.name,
      sourceAssetId: asset.asset_id,
      sourceAssetType: asset.asset_type,
    };
    setSelectedMedia(prev => [...prev, newItem]);
    // 直接从 asset 对象读取审核状态（后端已透传主图的 volcengine 字段）
    if (showAssetSubmit) {
      const statusKey = getAssetStatusKey(newItem);
      if (statusKey) {
        setAssetStatuses(prev => ({
          ...prev,
          [statusKey]: { assetId: asset.volcengine_asset_id, status: asset.volcengine_asset_status },
        }));
      }
    }
    return true;
  };

  const removeAssetMedia = (asset: any) => {
    setSelectedMedia(prev => prev.filter(m => m.sourceAssetId !== asset.asset_id && m.id !== asset.image_id));
  };

  const handleToggleAsset = (asset: any) => {
    const selected = selectedMedia.some(m => m.sourceAssetId === asset.asset_id || m.id === asset.image_id);
    if (selected) {
      removeAssetMedia(asset);
      return;
    }
    addAssetMedia(asset);
  };

  // 上传本地文件（图片/视频/音频自动识别）
  const handleUploadFile = async (file: File) => {
    const fileType = file.type;
    if (fileType.startsWith('image/')) {
      if (selectedMedia.filter(m => m.type === 'image').length >= 10) { toast('最多支持10张参考图片', 'error'); return; }
      setIsUploading(true);
      try {
        const tempAssetId = crypto.randomUUID();
        const res = await generationApi.uploadImage(projectId, {
          asset_id: tempAssetId,
          asset_type: 'storyboard',
          file,
          prompt: '手动上传',
        });
        const record = res.data;
        const localUrl = record.local_path
          ? `/api/projects/${projectId}/images/files/${record.local_path}`
          : (record.image_path || '');
        const newItem: RefMedia = { type: 'image', id: record.image_id, url: localUrl, name: file.name };
        setSelectedMedia(prev => [...prev, newItem]);
        if (showAssetSubmit) {
          const statusKey = getAssetStatusKey(newItem);
          if (statusKey) {
            setAssetStatuses(prev => ({
              ...prev,
              [statusKey]: { assetId: record.volcengine_asset_id, status: record.volcengine_asset_status },
            }));
          }
        }
      } catch { toast('图片上传失败', 'error'); } finally { setIsUploading(false); }
    } else if (fileType.startsWith('video/') || fileType.startsWith('audio/')) {
      if (mode === 'image') {
        toast('图片模式只支持上传图片', 'error');
        return;
      }
      setIsUploading(true);
      try {
        const res = await generationApi.uploadMedia(projectId, file);
        const record = res.data;
        const newItem: RefMedia = {
          type: record.media_type as 'video' | 'audio',
          id: record.media_id,
          url: record.url,
          name: file.name,
        };
        setSelectedMedia(prev => [...prev, newItem]);
        toast(`${record.media_type === 'video' ? '视频' : '音频'}上传成功`, 'success');
      } catch { toast('文件上传失败', 'error'); } finally { setIsUploading(false); }
    } else {
      toast('不支持的文件类型，请上传图片、视频或音频', 'error');
    }
  };

  // 提交素材审核
  const handleSubmitAssets = async (force = false) => {
    const imageIds = selectedMedia.filter(m => m.type === 'image' && m.id).map(m => m.id!);
    const videoItems = selectedMedia.filter(m => m.type === 'video' && m.url);
    const videoUrls = videoItems.map(m => m.url);
    if (imageIds.length === 0 && videoUrls.length === 0) return;
    setIsSubmittingAssets(true);
    try {
      const payload = {
        image_ids: imageIds,
        video_urls: videoUrls,
        project_name: 'default',
      };
      const res = force
        ? await generationApi.resubmitAsset(projectId, payload)
        : await generationApi.submitAsset(projectId, payload);
      const submitted: any[] = res.data.submitted || [];
      // skipped 可能是字符串（错误跳过）或对象（已提交过）
      const skippedRaw: any[] = res.data.skipped || [];
      const skippedWithStatus = skippedRaw.filter(s => typeof s === 'object' && s.asset_id && (s.image_id || s.video_url));

      const getRefKey = (s: any): string | null => {
        if (s.ref_type === 'video' || s.video_url) {
          const media = selectedMedia.find(m => m.type === 'video' && m.url === s.video_url);
          if (media?.id) return `video:${media.id}`;
          return s.video_url ? `video:${s.video_url}` : null;
        }
        if (s.image_id) return `image:${s.image_id}`;
        return null;
      };

      // 更新初始状态（submitted + 已提交过的 skipped）
      const initUpdates: Record<string, { assetId?: string; status?: string }> = {};
      submitted.forEach(s => {
        const key = getRefKey(s);
        if (key) initUpdates[key] = { assetId: s.asset_id, status: s.status };
      });
      skippedWithStatus.forEach(s => {
        const key = getRefKey(s);
        if (key) initUpdates[key] = { assetId: s.asset_id, status: s.status };
      });
      setAssetStatuses(prev => ({ ...prev, ...initUpdates }));

      // 对 Processing 或空状态的进行轮询
      const pollOne = async (assetId: string, statusKey: string) => {
        try {
          const r = await generationApi.getAssetStatus(projectId, assetId);
          const status = r.data.status;
          const refType = r.data.ref_type as string | undefined;
          const imageId = r.data.image_id as string | null | undefined;

          setAssetStatuses(prev => {
            let nextKey = statusKey;
            if (refType === 'image' && imageId) {
              nextKey = `image:${imageId}`;
            } else if (refType === 'video') {
              const existing = Object.entries(prev).find(([, v]) => v.assetId === assetId)?.[0];
              if (existing) nextKey = existing;
            }
            return { ...prev, [nextKey]: { assetId, status } };
          });

          if (status === 'Processing') setTimeout(() => pollOne(assetId, statusKey), 5000);
        } catch { /* ignore */ }
      };
      const needsPoll = [
        ...submitted.filter(s => s.status === 'Processing'),
        ...skippedWithStatus.filter(s => !s.status || s.status === 'Processing'),
      ];
      if (needsPoll.length > 0) {
        setTimeout(async () => {
          await Promise.all(needsPoll.map(s => {
            const key = getRefKey(s);
            return key ? pollOne(s.asset_id, key) : Promise.resolve();
          }));
          setIsSubmittingAssets(false);
        }, 3000);
      } else {
        setIsSubmittingAssets(false);
      }
    } catch {
      toast('提交审核失败', 'error');
      setIsSubmittingAssets(false);
    }
  };

  // 计算审核状态（图片+视频，音频不参与）
  const reviewItems = selectedMedia.filter(m => m.type === 'image' || m.type === 'video');
  const allStatuses = reviewItems
    .map(m => getAssetStatusKey(m))
    .filter((k): k is string => !!k)
    .map(k => assetStatuses[k]?.status);
  const anyProcessing = allStatuses.some(s => s === 'Processing');
  const anyFailed = allStatuses.some(s => s === 'Failed');
  const allActive = reviewItems.length > 0 && allStatuses.length > 0 && allStatuses.every(s => s === 'Active');
  const hasUnreviewed = reviewItems.length > 0 && (allStatuses.length < reviewItems.length || allStatuses.some(s => !s || s === 'Failed'));
  const skipAssetReview = isAssetUnsupportedVideoModel(selectedVideoModel);
  const showSubmitButton = showAssetSubmit && !skipAssetReview && reviewItems.length > 0;

  const imageSelectedCount = selectedMedia.filter(item => item.type === 'image').length;
  const selectedProjectAssetIds = useCallback((assets: any[]) => assets
    .filter(asset => selectedMedia.some(item =>
      item.sourceAssetId === asset.asset_id ||
      (item.type === 'image' && item.id && asset.image_id && item.id === asset.image_id)
    ))
    .map(asset => asset.asset_id), [selectedMedia]);
  const selectedCharacterIds = selectedProjectAssetIds(characters);
  const selectedSceneIds = selectedProjectAssetIds(scenes);
  const selectedPropIds = selectedProjectAssetIds(props);
  const handleInsertReferences = () => {
    const assetsById = new Map<string, any>();
    const assetsByImageId = new Map<string, any>();
    [...characters, ...scenes, ...props].forEach(asset => {
      assetsById.set(asset.asset_id, asset);
      if (asset.image_id) assetsByImageId.set(asset.image_id, asset);
    });
    const selectedImageAssets = selectedMedia
      .filter(item => item.type === 'image')
      .map(item => item.sourceAssetId ? assetsById.get(item.sourceAssetId) : (item.id ? assetsByImageId.get(item.id) : null))
      .filter(Boolean);
    const imageRefs = selectedImageAssets
      .map((asset, index) => `@图${index + 1}是【${asset.name}】`);
    const audioRefs = generateAudio
      ? selectedImageAssets
        .filter(asset => characters.some(character => character.asset_id === asset.asset_id))
        .filter(asset => asset.voice_enabled !== false && asset.voice_audio_id)
        .map((asset, index) => `@音频${index + 1}是【${asset.name}】的声音`)
      : [];
    const referenceText = [...imageRefs, ...audioRefs].join('，');
    if (!referenceText) {
      toast('请先选择可引用的资产', 'error');
      return;
    }
    setPrompt(prev => {
      const body = prev.trimStart();
      return body ? `${referenceText}\n\n${body}` : `${referenceText}\n`;
    });
  };
  const showCreatenowModelSelect = mode === 'image' ? imageApiType === 'createnow' : videoApiType === 'createnow';
  const activeModelSuggestions = mode === 'image'
    ? (createnowModelConfig.suggestions.image || [])
    : (createnowModelConfig.suggestions.video || []);
  const selectedModelOverride = mode === 'image' ? selectedImageModel : selectedVideoModel;
  const handleModelOverrideChange = (model: string) => {
    if (mode === 'image') {
      setSelectedImageModel(model);
    } else {
      setSelectedVideoModel(model);
    }
  };
  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      <div className="border-b border-gray-800 px-4 py-3 flex items-center justify-between gap-3 bg-gray-900/80">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode('video')}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${mode === 'video' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            视频
          </button>
          <button
            onClick={() => setMode('image')}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${mode === 'image' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            图片
          </button>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'video' && (
            <button
              onClick={() => setShowLibrary(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition"
            >
              <Film size={14} />
              视频库
            </button>
          )}
          <button
            onClick={() => setOnlyMine(prev => !prev)}
            className={`px-3 py-1.5 rounded-lg text-sm transition ${onlyMine ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            {onlyMine ? '只看自己' : '查看全部'}
          </button>
        </div>
      </div>


      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <div className="w-full lg:w-[40%] lg:basis-[40%] lg:shrink-0 min-h-0 border-b lg:border-b-0 lg:border-r border-gray-700 bg-gray-800">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex-1 min-h-0 p-4 pb-0">
              <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-800 border border-gray-600 rounded-lg shadow-xl">
                <AssetPickerPanel
                  characters={characters}
                  scenes={scenes}
                  props={props}
                  selectedCharacters={selectedCharacterIds}
                  selectedScenes={selectedSceneIds}
                  selectedProps={selectedPropIds}
                  onToggleCharacter={(_, asset) => handleToggleAsset(asset)}
                  onToggleScene={(_, asset) => handleToggleAsset(asset)}
                  onToggleProp={(_, asset) => handleToggleAsset(asset)}
                  showOnlyUsedFilter={false}
                  showAddEmptyAction={false}
                  isAssetDisabled={(asset) => !asset.image_id}
                  disabledReason={(asset) => !asset.image_id ? `${asset.name || '资产'}暂无主图，不能作为参考图` : undefined}
                  className="h-full p-3"
                  gridClassName="flex flex-wrap gap-3 p-1"
                />
              </div>
            </div>
            <div className="shrink-0 max-h-full overflow-y-auto p-4 space-y-4">
            <div className="flex flex-wrap gap-3 items-center min-h-[72px]">
              {selectedMedia.map((item, idx) => {
                const statusKey = getAssetStatusKey(item);
                const volStatus = statusKey ? assetStatuses[statusKey]?.status : undefined;
                const openPreview = () => setPreviewMedia(item);
                return (
                  <div key={`${item.type}-${idx}`} className="relative group flex-shrink-0">
                    {item.type === 'image' ? (
                      <button type="button" onClick={openPreview} className="w-16 h-16 relative cursor-zoom-in" title="点击查看大图">
                        {item.url ? (
                          <img src={item.url} alt={item.name} className="w-16 h-16 object-cover rounded border border-gray-600 hover:border-blue-400 transition-colors" />
                        ) : (
                          <div className="w-16 h-16 bg-gray-700 rounded border border-gray-600 flex items-center justify-center hover:border-blue-400 transition-colors">
                            <Image size={16} className="text-gray-400" />
                          </div>
                        )}
                        {mode === 'video' && showAssetSubmit && volStatus && (
                          <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center ${volStatus === 'Active' ? 'bg-green-500' : volStatus === 'Processing' ? 'bg-yellow-500' : volStatus === 'Failed' ? 'bg-red-500' : 'bg-gray-500'}`} />
                        )}
                      </button>
                    ) : item.type === 'video' ? (
                      <button type="button" onClick={openPreview} className="w-16 h-16 relative cursor-pointer" title="点击播放视频">
                        <div className="w-16 h-16 bg-gray-700 rounded border border-gray-600 flex items-center justify-center hover:border-blue-400 transition-colors">
                          <Film size={16} className="text-blue-400" />
                        </div>
                        {mode === 'video' && showAssetSubmit && volStatus && (
                          <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center ${volStatus === 'Active' ? 'bg-green-500' : volStatus === 'Processing' ? 'bg-yellow-500' : volStatus === 'Failed' ? 'bg-red-500' : 'bg-gray-500'}`} />
                        )}
                      </button>
                    ) : (
                      <button type="button" onClick={openPreview} className="flex items-center gap-2 h-16 px-3 bg-gray-700 rounded border border-gray-600 hover:border-purple-400 transition-colors max-w-[220px]" title="点击播放音频">
                        <Music size={14} className="text-purple-400 flex-shrink-0" />
                        <span className="text-xs text-gray-300 truncate">{item.name}</span>
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedMedia(prev => prev.filter((_, i) => i !== idx))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-16 h-16 bg-gray-700 hover:bg-gray-600 rounded border border-dashed border-gray-500 flex items-center justify-center transition-colors disabled:opacity-50"
                title={mode === 'video' ? '上传图片、视频或音频' : '上传图片作为图生图参考'}
              >
                {isUploading ? <Loader2 size={16} className="text-gray-400 animate-spin" /> : <Upload size={16} className="text-gray-400" />}
              </button>
              <input ref={fileInputRef} type="file" accept={mode === 'video' ? 'image/*,video/*,audio/*' : 'image/*'} multiple className="hidden"
                onChange={async e => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = '';
                  for (const f of files) await handleUploadFile(f);
                }}
              />

              <button
                onClick={handleInsertReferences}
                disabled={selectedMedia.filter(item => item.type === 'image').length === 0}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded ml-1 text-blue-400 hover:text-blue-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                title="将已选资产引用插入提示词开头"
              >
                插入引用提示词
              </button>

              {mode === 'video' && showSubmitButton && (
                isSubmittingAssets || anyProcessing ? (
                  <span className="text-xs text-yellow-400 flex items-center gap-1 ml-1">
                    <Loader2 size={12} className="animate-spin" />审核中...
                  </span>
                ) : (
                  <>
                    {allActive ? (
                      <span className="text-xs text-green-400 flex items-center gap-1 ml-1">
                        <CheckCircle size={12} />已入库
                      </span>
                    ) : (hasUnreviewed || anyFailed) ? (
                      <button
                        onClick={() => handleSubmitAssets(false)}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded ml-1 ${anyFailed ? 'text-red-400 hover:text-red-300' : 'text-blue-400 hover:text-blue-300'}`}
                      >
                        <Upload size={12} />{anyFailed ? '部分失败，重试' : '提交审核'}
                      </button>
                    ) : null}
                    <button
                      onClick={() => handleSubmitAssets(true)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded ml-1 text-gray-400 hover:text-white"
                      title="强制重新提交（清空旧审核状态重新入库）"
                    >
                      重新提交
                    </button>
                  </>
                )
              )}

              {mode === 'image' && (
                <span className="text-xs text-gray-400 ml-1">已选参考图 {imageSelectedCount} 张，0 张时直接文生图</span>
              )}
            </div>

            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder={mode === 'video' ? '输入视频提示词，描述画面内容、动作、氛围...' : '输入图片提示词，0 张参考图时文生图，已选参考图时图生图'}
              className="w-full min-h-[260px] bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:border-blue-500 placeholder-gray-500"
              rows={12}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
            />

            <div className="flex items-center gap-2 flex-wrap">
              {mode === 'video' && (
                <>
                  <div className="relative">
                    <button
                      onClick={() => setShowDurationMenu(!showDurationMenu)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition"
                    >
                      <Clock size={14} />
                      {duration}s
                      <ChevronDown size={12} />
                    </button>
                    {showDurationMenu && (
                      <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden max-h-48 overflow-y-auto">
                        {Array.from({ length: 12 }, (_, i) => i + 4).map(s => (
                          <button
                            key={s}
                            onClick={() => { setDuration(s); setShowDurationMenu(false); }}
                            className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${s === duration ? 'text-blue-400' : ''}`}
                          >
                            {s}s
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <GenerationOptionSelector kind="videoRatio" value={ratio} onChange={setRatio} />

                  <GenerationOptionSelector kind="videoResolution" value={resolution} onChange={setResolution} />

                  <button
                    onClick={() => setGenerateAudio(!generateAudio)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition ${generateAudio ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-700 hover:bg-gray-600 text-gray-400'}`}
                    title={generateAudio ? '已开启声音' : '已关闭声音'}
                  >
                    {generateAudio ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    {generateAudio ? '有声' : '无声'}
                  </button>
                </>
              )}

              {mode === 'image' && (
                <>
                  <GenerationOptionSelector kind="imageSize" value={imageSize} onChange={setImageSize} />
                </>
              )}

              {showCreatenowModelSelect && activeModelSuggestions.length > 0 && (
                <CreatenowModelSelector
                  type={mode === 'image' ? 'image' : 'video'}
                  value={selectedModelOverride}
                  suggestions={activeModelSuggestions}
                  onChange={handleModelOverrideChange}
                  className="w-32 shrink-0"
                />
              )}

              <div className="flex-1" />

              <button
                onClick={handleGenerate}
                disabled={(mode === 'video' ? isGeneratingVideo : false) || !prompt.trim()}
                className="flex items-center gap-2 px-5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition"
              >
                {(mode === 'video' ? isGeneratingVideo : false) ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {mode === 'video' ? '生成视频' : (imageSelectedCount > 0 ? `图生图${pendingImageCount > 0 ? ` (${pendingImageCount})` : ''}` : `文生图${pendingImageCount > 0 ? ` (${pendingImageCount})` : ''}`)}
              </button>
            </div>
          </div>
        </div>
        </div>

        <div className="flex-1 lg:basis-[60%] min-w-0 min-h-0 flex flex-col bg-gray-900">
          {mode === 'video' ? (
            <div ref={videoListRef} onScroll={handleVideoListScroll} className="flex-1 overflow-y-auto p-4">
              {filteredVideos.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
                  <Film size={48} className="opacity-30" />
                  <p className="text-lg">视频库为空</p>
                  <p className="text-sm">可直接纯文生，也可添加图片/视频/音频参考后生成</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {hasMoreHistory && (
                    <div className="flex justify-center py-1">
                      <span className="text-xs text-gray-500">{isLoadingHistory ? '加载历史中...' : '向上滚动查看更多历史'}</span>
                    </div>
                  )}
                  {visibleVideos.map(video => (
                    <VideoItem
                      key={video.video_id}
                      video={video}
                      projectId={projectId}
                      isPolling={pollingIds.has(video.video_id)}
                      isPlaying={playingVideoId === video.video_id}
                      onPlay={() => setPlayingVideoId(playingVideoId === video.video_id ? null : video.video_id)}
                      onRegenerate={() => handleRegenerate(video)}
                      onPreviewMedia={(media) => setPreviewMedia(media)}
                      onRetryPoll={() => startPolling(video.video_id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div ref={videoListRef} onScroll={handleVideoListScroll} className="flex-1 overflow-y-auto p-4">
              {filteredImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
                  <Image size={48} className="opacity-30" />
                  <p className="text-lg">图片库为空</p>
                  <p className="text-sm">输入提示词直接文生图，或加参考图做图生图</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {hasMoreHistory && (
                    <div className="flex justify-center py-1">
                      <span className="text-xs text-gray-500">{isLoadingHistory ? '加载历史中...' : '向上滚动查看更多历史'}</span>
                    </div>
                  )}
                  {visibleImages.map(image => (
                    <ImageHistoryItem
                      key={image.image_id}
                      image={image}
                      projectId={projectId}
                      onPreview={() => setExpandedImage(image)}
                      onRegenerate={() => handleRegenerateImage(image)}
                      onEdit={() => handleEditImage(image)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showLibrary && (
        <VideoGallery
          projectId={projectId}
          onClose={() => setShowLibrary(false)}
          libraryOnly
          initialVideos={filteredVideos}
          onVideoCreated={handleLibraryVideoCreated}
        />
      )}

      {previewMedia && (
        <div
          className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-6"
          onClick={() => setPreviewMedia(null)}
        >
          <div className="max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {previewMedia.type === 'image' ? (
              <img
                src={previewMedia.url}
                alt={previewMedia.name}
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
            ) : previewMedia.type === 'video' ? (
              <video
                src={previewMedia.url}
                className="max-w-[90vw] max-h-[80vh] rounded-lg bg-black"
                controls
                autoPlay
                playsInline
              />
            ) : (
              <div className="min-w-[320px] rounded-lg bg-gray-800 border border-gray-700 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm text-gray-200">
                  <Music size={16} className="text-purple-400" />
                  <span className="truncate">{previewMedia.name || '参考音频'}</span>
                </div>
                <audio src={previewMedia.url} controls autoPlay className="w-full" />
              </div>
            )}
            <div className="mt-3 text-sm text-gray-200 break-all">
              {previewMedia.name || previewMedia.url}
            </div>
          </div>
        </div>
      )}

      {expandedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-6"
          onClick={() => setExpandedImage(null)}
        >
          <div className="max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={getImageRecordUrl(projectId, expandedImage)}
              alt={expandedImage.prompt}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            <div className="mt-3 text-sm text-gray-200">
              {expandedImage.prompt || '未命名图片'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ImageHistoryItemProps {
  image: ImageRecord;
  projectId: string;
  onPreview: () => void;
  onRegenerate: () => void;
  onEdit: () => void;
}

function ImageHistoryItem({ image, projectId, onPreview, onRegenerate, onEdit }: ImageHistoryItemProps) {
  const imageUrl = getImageRecordUrl(projectId, image);
  const thumbUrl = getThumbnailUrl(imageUrl);

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
      <button
        onClick={onRegenerate}
        className="w-full text-left hover:bg-gray-750 transition-colors group"
        title="点击回填提示词和比例"
      >
        <div className="flex items-start gap-3 p-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            className="w-24 h-24 bg-gray-900 rounded overflow-hidden flex-shrink-0 flex items-center justify-center"
            title="查看大图"
          >
            {image.status === 'pending' ? (
              <Loader2 size={20} className="animate-spin text-gray-400" />
            ) : thumbUrl ? (
              <img src={thumbUrl} alt={image.prompt} className="w-full h-full object-cover" />
            ) : (
              <Image size={20} className="text-gray-500" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <ExpandableText text={image.prompt || '未命名图片'} maxLines={2} className="text-sm text-gray-200 group-hover:text-white transition-colors" />
            <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 flex-wrap">
              <span>{new Date(image.created_at).toLocaleString('zh-CN')}</span>
              {(image.status === 'failed' || image.status === 'pending') && (
                <>
                  <span>·</span>
                  <span className={image.status === 'failed' ? 'text-red-400' : 'text-yellow-400'}>
                    {image.status === 'failed' ? '生成失败' : '生成中...'}
                  </span>
                </>
              )}
              {image.error && (
                <>
                  <span>·</span>
                  <span className="text-red-300 truncate">{image.error}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </button>
      <div className="border-t border-gray-700 px-3 py-2 flex justify-end">
        <button
          onClick={onEdit}
          disabled={image.status === 'pending'}
          className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-500"
        >
          选择
        </button>
      </div>
    </div>
  );
}

// 单个视频条目
interface VideoItemProps {
  video: VideoRecord;
  projectId: string;
  isPolling: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  onRegenerate: () => void;
  onPreviewMedia: (media: RefMedia) => void;
  onRetryPoll: () => void;
}

function VideoItem({ video, projectId, isPolling, isPlaying, onPlay, onRegenerate, onPreviewMedia, onRetryPoll }: VideoItemProps) {
  const videoUrl = getVideoUrl(video, projectId);
  const displayRatio = inferRatioFromVideo(video);
  const resLabel = `${displayRatio} ${normalizeResolutionValue(video.resolution)}`;
  const normRes = normalizeResolutionValue(video.resolution);
  const isPortrait = displayRatio === '9:16';
  const isUltraWide = displayRatio === '21:9';
  const baseHeight = normRes === '1080p' ? 270 : normRes === '480p' ? 150 : 210;
  const previewH = isPortrait ? (normRes === '1080p' ? 400 : normRes === '480p' ? 220 : 300) : baseHeight;
  const previewW = isPortrait ? Math.round(previewH * 9 / 16) : isUltraWide ? Math.round(previewH * 21 / 9) : Math.round(previewH * 16 / 9);

  const previewReferenceMedia = dedupeReferenceMedia(video.reference_media);
  const translatedError = translateError(video.error);

  const videoRef = useRef<HTMLVideoElement>(null);
  // 用 ref 命令式控制播放，避免 autoPlay 声明式失效
  useEffect(() => {
    if (!videoRef.current || !videoUrl) return;
    if (isPlaying) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [isPlaying, videoUrl]);

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
      {/* 元数据行（可点击恢复参数） */}
      <button
        onClick={onRegenerate}
        className="w-full text-left px-3 py-2 hover:bg-gray-750 transition-colors group"
        title="点击填入生成参数"
      >
        <div className="flex items-start gap-2">
          {/* 参考素材缩略图 */}
          {previewReferenceMedia.length > 0 && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {previewReferenceMedia.slice(0, 4).map((m, i) => (
                m.type === 'image' && m.url ? (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreviewMedia(m);
                    }}
                    className="w-7 h-7 rounded overflow-hidden border border-gray-600 hover:border-blue-400 transition-colors flex-shrink-0 cursor-zoom-in"
                    title="点击查看大图"
                  >
                    <img src={getThumbnailUrl(m.url)} alt={m.name} className="w-full h-full object-cover" />
                  </button>
                ) : m.type === 'video' ? (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreviewMedia(m);
                    }}
                    className="w-7 h-7 rounded bg-gray-700 border border-gray-600 hover:border-blue-400 transition-colors flex items-center justify-center flex-shrink-0"
                    title="点击播放视频"
                  >
                    <Film size={12} className="text-blue-400" />
                  </button>
                ) : (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPreviewMedia(m);
                    }}
                    className="w-7 h-7 rounded bg-gray-700 border border-gray-600 hover:border-purple-400 transition-colors flex items-center justify-center flex-shrink-0"
                    title="点击播放音频"
                  >
                    <Music size={12} className="text-purple-400" />
                  </button>
                )
              ))}
              {previewReferenceMedia.length > 4 && (
                <span className="text-xs text-gray-500">+{previewReferenceMedia.length - 4}</span>
              )}
            </div>
          )}
          {/* 提示词 */}
          <div className="flex-1">
            <ExpandableText
              text={video.prompt}
              maxLines={2}
              className="text-sm text-gray-300 group-hover:text-white transition-colors"
            />
          </div>
          {/* 状态 */}
          <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
            <VideoStatusIcon status={video.status} />
          </div>
        </div>
        {/* 参数行 */}
        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
          <span>{video.model}</span>
          <span>·</span>
          <span>{video.duration}s</span>
          <span>·</span>
          <span>{resLabel}</span>
          {video.generate_audio != null && (
            <>
              <span>·</span>
              <span>{video.generate_audio ? '有声' : '无声'}</span>
            </>
          )}
          <span>·</span>
          <VideoStatusText status={video.status} />
          <span className="ml-auto text-gray-600 group-hover:text-gray-400 transition-colors text-xs">点击填入 ↑</span>
        </div>
      </button>

      {/* 视频区域 */}
      {video.status === 'pending' || video.status === 'queued' || video.status === 'in_progress' ? (
        <div className="h-12 border-t border-gray-700 flex items-center px-3 gap-2 text-gray-500">
          <Loader2 size={14} className="animate-spin flex-shrink-0" />
          <span className="text-xs">生成中，请稍候...</span>
        </div>
      ) : video.status === 'failed' ? (
        <div className="h-12 border-t border-gray-700 flex items-center px-3 gap-2 text-red-400">
          <XCircle size={14} className="flex-shrink-0" />
          <span className="text-xs">生成失败{video.error ? `: ${translatedError || video.error}` : ''}</span>
        </div>
      ) : video.status === 'poll_failed' ? (
        <div className="border-t border-gray-700 px-3 py-2 text-orange-300 text-xs space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <XCircle size={14} className="flex-shrink-0" />
              <span>轮询异常</span>
            </div>
            <button
              onClick={onRetryPoll}
              disabled={isPolling}
              className="text-blue-400 hover:text-blue-300 disabled:text-gray-500"
            >
              手动继续
            </button>
          </div>
          {video.task_id && <div className="text-gray-400">Task: {video.task_id}</div>}
          <div className="text-gray-500">
            轮询次数: {video.poll_count ?? 0}
            {video.last_poll_time ? ` · 最近: ${new Date(video.last_poll_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
          </div>
        </div>
      ) : videoUrl ? (
        /* 固定容器尺寸（来自已知分辨率），单一 video 元素，preload none 避免自动加载 */
        <div className="border-t border-gray-700 px-3 py-2">
          <div
            className="relative overflow-hidden rounded flex-shrink-0"
            style={{ width: previewW, height: previewH }}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-contain"
              preload="none"
              controls={isPlaying}
              playsInline
            />
            {!isPlaying && (
              <div
                className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/10 hover:bg-black/30 transition-colors"
                onClick={onPlay}
              >
                <div className="w-9 h-9 bg-black/50 rounded-full flex items-center justify-center">
                  <Play size={16} className="text-white ml-1" />
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* 操作栏 */}
      {isPolling && (
        <div className="px-3 py-1.5 border-t border-gray-700">
          <span className="flex items-center gap-1 text-xs text-blue-400">
            <Loader2 size={11} className="animate-spin" />轮询中
          </span>
        </div>
      )}

      {(video.task_id || video.error || video.last_poll_response || video.poll_count || video.last_poll_time) && (
        <details className="border-t border-gray-700 px-3 py-2" open={video.status === 'poll_failed'}>
          <summary className="text-xs text-blue-400 cursor-pointer">调试信息</summary>
          <div className="mt-2 text-xs text-gray-400 space-y-1">
            {video.task_id && <div>Task: {video.task_id}</div>}
            {video.error && (
              <div className="text-red-300">
                {translatedError && <div className="text-yellow-300 font-medium">{translatedError}</div>}
                <div>错误: {video.error}</div>
              </div>
            )}
            <div>
              轮询次数: {video.poll_count ?? 0}
              {video.last_poll_time ? ` · 最近轮询: ${new Date(video.last_poll_time).toLocaleString('zh-CN')}` : ''}
            </div>
          </div>
          {video.last_poll_response && (
            <pre className="mt-2 p-2 bg-gray-900 rounded text-xs overflow-x-auto max-h-40 overflow-y-auto text-gray-300">
              {JSON.stringify(video.last_poll_response, null, 2)}
            </pre>
          )}
        </details>
      )}
    </div>
  );
}
