import { useState, useEffect, useRef, useCallback, useMemo } from 'react';import {
  Upload, X, Film, Plus, ChevronDown, Loader2, Play,
  Clock, CheckCircle, XCircle, Image, Volume2, VolumeX, Music
} from 'lucide-react';
import { useAssetStore } from '@/store/assetStore';
import { generationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import { getVideoUrl } from '@/components/storyboard/utils/mediaUtils';

interface RefMedia {
  type: 'image' | 'video' | 'audio';
  id?: string;      // image_id 或 media_id
  url: string;      // 图片展示 URL 或视频/音频公网 URL
  name: string;
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
  model: string;
  status: string;
  created_at: string;
  generate_audio?: boolean | null;
  reference_media?: RefMedia[];
}

interface GenerateTabProps {
  projectId: string;
  showAssetSubmit?: boolean;
}

const HISTORY_PAGE_SIZE = 60;

const RATIO_OPTIONS = [
  { label: '16:9 横版', value: '16:9' },
  { label: '9:16 竖版', value: '9:16' },
  { label: '21:9 超宽', value: '21:9' },
];

const RESOLUTION_OPTIONS = [
  { label: '480p', value: '480p' },
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' },
];

const LEGACY_RESOLUTION_MAP: Record<string, string> = {
  '1280x720': '720p',
  '720x1280': '720p',
  '21:9-720p': '720p',
};

function normalizeResolutionValue(resolution?: string): string {
  if (!resolution) return '720p';
  if (RESOLUTION_OPTIONS.some(r => r.value === resolution)) return resolution;
  return LEGACY_RESOLUTION_MAP[resolution] || '720p';
}

function inferRatioFromVideo(video: Pick<VideoRecord, 'ratio' | 'resolution'>): string {
  if (video.ratio && RATIO_OPTIONS.some(r => r.value === video.ratio)) return video.ratio;
  if (video.resolution === '720x1280') return '9:16';
  if (video.resolution === '21:9-720p') return '21:9';
  return '16:9';
}

function VideoStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle size={14} className="text-green-400" />;
  if (status === 'failed') return <XCircle size={14} className="text-red-400" />;
  return <Loader2 size={14} className="text-blue-400 animate-spin" />;
}

function VideoStatusText({ status }: { status: string }) {
  if (status === 'completed') return <span className="text-green-400">已完成</span>;
  if (status === 'failed') return <span className="text-red-400">生成失败</span>;
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

export function GenerateTab({ projectId, showAssetSubmit = false }: GenerateTabProps) {
  const { toast } = useToast();
  const { characters, scenes, props } = useAssetStore();

  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(6);
  const [resolution, setResolution] = useState('720p');
  const [ratio, setRatio] = useState('16:9');
  const [generateAudio, setGenerateAudio] = useState(true);
  const [selectedMedia, setSelectedMedia] = useState<RefMedia[]>([]);
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [assetPickerTab, setAssetPickerTab] = useState<'character' | 'scene' | 'prop'>('character');
  const [showRatioMenu, setShowRatioMenu] = useState(false);
  const [showResolutionMenu, setShowResolutionMenu] = useState(false);
  const [showDurationMenu, setShowDurationMenu] = useState(false);
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  // 素材审核
  const [isSubmittingAssets, setIsSubmittingAssets] = useState(false);
  const [assetStatuses, setAssetStatuses] = useState<Record<string, { assetId?: string; status?: string }>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const assetPickerRef = useRef<HTMLDivElement>(null);
  const videoListRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (videoListRef.current) {
      videoListRef.current.scrollTop = videoListRef.current.scrollHeight;
    }
  }, []);

  // 加载视频库
  const loadLibraryVideos = useCallback(async () => {
    try {
      const res = await generationApi.listLibraryVideos(projectId);
      const list: VideoRecord[] = res.data || [];
      // 保持时间顺序：旧 -> 新（最新在底部）
      const asc = [...list].reverse();
      setVideos(asc);
      const initialCount = Math.min(HISTORY_PAGE_SIZE, asc.length);
      setVisibleCount(initialCount);
      setHasMoreHistory(asc.length > initialCount);
      shouldStickToBottomRef.current = true;
    } catch { /* ignore */ }
  }, [projectId]);

  const visibleVideos = useMemo(() => {
    if (visibleCount <= 0) return [];
    return videos.slice(-visibleCount);
  }, [videos, visibleCount]);

  const loadMoreHistory = useCallback(() => {
    if (!hasMoreHistory || isLoadingHistory) return;
    const container = videoListRef.current;
    const prevHeight = container?.scrollHeight || 0;
    setIsLoadingHistory(true);
    setVisibleCount(prev => {
      const next = Math.min(videos.length, prev + HISTORY_PAGE_SIZE);
      return next;
    });
    requestAnimationFrame(() => {
      if (container) {
        const nextHeight = container.scrollHeight;
        container.scrollTop = nextHeight - prevHeight + container.scrollTop;
      }
      setIsLoadingHistory(false);
    });
  }, [hasMoreHistory, isLoadingHistory, videos.length]);

  useEffect(() => { loadLibraryVideos(); }, [loadLibraryVideos]);

  useEffect(() => {
    setHasMoreHistory(videos.length > visibleCount);
  }, [videos.length, visibleCount]);

  // 视频加载/新增后滚动到底部（仅在用户停留底部时）
  useEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    setTimeout(scrollToBottom, 50);
  }, [visibleVideos.length, scrollToBottom]);

  const handleVideoListScroll = useCallback(() => {
    const el = videoListRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    shouldStickToBottomRef.current = nearBottom;
    if (el.scrollTop < 80 && hasMoreHistory && !isLoadingHistory) {
      loadMoreHistory();
    }
  }, [hasMoreHistory, isLoadingHistory, loadMoreHistory]);

  // 点击外部关闭弹窗
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (assetPickerRef.current && !assetPickerRef.current.contains(e.target as Node)) {
        setShowAssetPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 启动视频轮询
  const startPolling = useCallback((videoId: string) => {
    if (pollingRef.current.has(videoId)) return;
    setPollingIds(prev => new Set([...prev, videoId]));
    const timer = setInterval(async () => {
      try {
        const res = await generationApi.pollVideo(projectId, videoId);
        const updated: VideoRecord = res.data;
        setVideos(prev => prev.map(v => v.video_id === videoId ? updated : v));
        if (updated.status === 'completed' || updated.status === 'failed') {
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
    videos.forEach(v => {
      if ((v.status === 'pending' || v.status === 'in_progress') && !pollingRef.current.has(v.video_id)) {
        startPolling(v.video_id);
      }
    });
  }, [videos, startPolling]);

  // 生成视频
  const handleGenerate = async () => {
    if (!prompt.trim()) { toast('请输入视频提示词', 'error'); return; }
    if (selectedMedia.length === 0) { toast('请至少选择一个参考素材', 'error'); return; }

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

    setIsGenerating(true);
    try {
      const res = await generationApi.generateVideo(projectId, {
        storyboard_id: null,
        episode_id: null,
        image_ids: imageItems.map(m => m.id!),
        video_urls: resolvedVideoUrls.length > 0 ? resolvedVideoUrls : undefined,
        audio_urls: audioItems.length > 0 ? audioItems.map(m => m.url) : undefined,
        prompt: prompt.trim(),
        duration,
        resolution,
        ratio,
        generate_audio: generateAudio,
        reference_media: selectedMedia.map(m => ({ type: m.type, id: m.id, url: m.url, name: m.name })),
      });
      const newVideo: VideoRecord = res.data;
      setVideos(prev => [...prev, newVideo]);
      setVisibleCount(prev => {
        const base = prev > 0 ? prev : Math.min(HISTORY_PAGE_SIZE, videos.length + 1);
        return Math.min(videos.length + 1, base + 1);
      });
      shouldStickToBottomRef.current = true;
      startPolling(newVideo.video_id);
      const estimatedCost = typeof newVideo.estimated_cost === 'number'
        ? newVideo.estimated_cost
        : newVideo.duration;
      toast(`视频生成任务已提交（预计消耗 ${estimatedCost} 元）`, 'success');
    } catch (e: any) {
      toast(e?.response?.data?.detail || '生成失败，请检查配置', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // 重新生成（恢复参数）
  const handleRegenerate = (video: VideoRecord) => {
    setPrompt(video.prompt);
    setDuration(video.duration);
    setResolution(normalizeResolutionValue(video.resolution));
    setRatio(inferRatioFromVideo(video));
    if (video.generate_audio != null) setGenerateAudio(video.generate_audio);
    if (video.reference_media && video.reference_media.length > 0) {
      setSelectedMedia(video.reference_media);
      // 清空审核状态，让用户重新触发（若需要）
      setAssetStatuses({});
    }
  };

  // 从项目资产添加参考图
  const handleAddAsset = (asset: any) => {
    const imgId = asset.image_id;
    if (!imgId) { toast('该资产暂无主图', 'error'); return; }
    if (selectedMedia.find(m => m.id === imgId)) { toast('已添加过该图片', 'error'); return; }
    if (selectedMedia.filter(m => m.type === 'image').length >= 10) { toast('最多支持10张参考图片', 'error'); return; }
    const newItem: RefMedia = { type: 'image', id: imgId, url: asset.primary_image_url || '', name: asset.name };
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
  const handleSubmitAssets = async () => {
    const imageIds = selectedMedia.filter(m => m.type === 'image' && m.id).map(m => m.id!);
    const videoItems = selectedMedia.filter(m => m.type === 'video' && m.url);
    const videoUrls = videoItems.map(m => m.url);
    if (imageIds.length === 0 && videoUrls.length === 0) return;
    setIsSubmittingAssets(true);
    try {
      const res = await generationApi.submitAsset(projectId, {
        image_ids: imageIds,
        video_urls: videoUrls,
        project_name: 'default',
      });
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
  const showSubmitButton = showAssetSubmit && reviewItems.length > 0;

  const allAssets = assetPickerTab === 'character' ? characters
    : assetPickerTab === 'scene' ? scenes : props;

  const ratioLabel = RATIO_OPTIONS.find(r => r.value === ratio)?.label || ratio;
  const resolutionLabel = RESOLUTION_OPTIONS.find(r => r.value === resolution)?.label || resolution;
  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* 视频库（正序：最旧在上，最新在下，默认滚到底部） */}
      <div ref={videoListRef} onScroll={handleVideoListScroll} className="flex-1 overflow-y-auto p-4">
        {videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <Film size={48} className="opacity-30" />
            <p className="text-lg">视频库为空</p>
            <p className="text-sm">选择参考素材并输入提示词，点击"生成"开始创作</p>
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
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部输入区 */}
      <div className="border-t border-gray-700 bg-gray-800 p-4 space-y-3">
        {/* 参考素材区 */}
        <div className="flex flex-wrap gap-2 items-center min-h-[44px]">
          {selectedMedia.map((item, idx) => {
            const statusKey = getAssetStatusKey(item);
            const volStatus = statusKey ? assetStatuses[statusKey]?.status : undefined;
            return (
              <div key={`${item.type}-${idx}`} className="relative group flex-shrink-0">
                {item.type === 'image' ? (
                  <div className="w-10 h-10">
                    {item.url ? (
                      <img src={item.url} alt={item.name} className="w-10 h-10 object-cover rounded border border-gray-600" />
                    ) : (
                      <div className="w-10 h-10 bg-gray-700 rounded border border-gray-600 flex items-center justify-center">
                        <Image size={16} className="text-gray-400" />
                      </div>
                    )}
                    {/* 审核状态角标 */}
                    {showAssetSubmit && volStatus && (
                      <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center
                        ${volStatus === 'Active' ? 'bg-green-500' : volStatus === 'Processing' ? 'bg-yellow-500' : volStatus === 'Failed' ? 'bg-red-500' : 'bg-gray-500'}`}
                      />
                    )}
                  </div>
                ) : item.type === 'video' ? (
                  <div className="w-10 h-10 relative">
                    <div className="w-10 h-10 bg-gray-700 rounded border border-gray-600 flex items-center justify-center">
                      <Film size={16} className="text-blue-400" />
                    </div>
                    {showAssetSubmit && volStatus && (
                      <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center
                        ${volStatus === 'Active' ? 'bg-green-500' : volStatus === 'Processing' ? 'bg-yellow-500' : volStatus === 'Failed' ? 'bg-red-500' : 'bg-gray-500'}`}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1 h-10 px-2 bg-gray-700 rounded border border-gray-600 max-w-[120px]" title={item.name}>
                    <Music size={14} className="text-purple-400 flex-shrink-0" />
                    <span className="text-xs text-gray-300 truncate">{item.name}</span>
                  </div>
                )}
                <button
                  onClick={() => setSelectedMedia(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}

          {/* 从项目资产选择 */}
          <div className="relative" ref={assetPickerRef}>
            <button
              onClick={() => setShowAssetPicker(!showAssetPicker)}
              className="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded border border-dashed border-gray-500 flex items-center justify-center transition-colors"
              title="从项目资产选择"
            >
              <Plus size={18} className="text-gray-400" />
            </button>

            {showAssetPicker && (
              <div className="absolute bottom-full mb-2 left-0 w-80 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50">
                <div className="flex border-b border-gray-700">
                  {(['character', 'scene', 'prop'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setAssetPickerTab(tab)}
                      className={`flex-1 py-2 text-sm transition ${assetPickerTab === tab ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                      {tab === 'character' ? '角色' : tab === 'scene' ? '场景' : '道具'}
                    </button>
                  ))}
                </div>
                <div className="max-h-48 overflow-y-auto p-2 grid grid-cols-4 gap-1">
                  {allAssets.length === 0 ? (
                    <div className="col-span-4 text-center text-gray-500 text-sm py-4">暂无资产</div>
                  ) : (
                    (allAssets as any[]).map((asset: any) => (
                      <button
                        key={asset.asset_id}
                        onClick={() => { handleAddAsset(asset); setShowAssetPicker(false); }}
                        disabled={!asset.image_id}
                        className="flex flex-col items-center gap-1 p-1 rounded hover:bg-gray-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        title={asset.name}
                      >
                        {asset.primary_image_url ? (
                          <img src={asset.primary_image_url.replace('/images/files/', '/thumbnails/')} alt={asset.name} className="w-14 h-14 object-cover rounded" />
                        ) : (
                          <div className="w-14 h-14 bg-gray-700 rounded flex items-center justify-center">
                            <Image size={20} className="text-gray-500" />
                          </div>
                        )}
                        <span className="text-xs text-gray-300 truncate w-full text-center">{asset.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 上传本地文件（图片/视频/音频自动识别） */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-10 h-10 bg-gray-700 hover:bg-gray-600 rounded border border-dashed border-gray-500 flex items-center justify-center transition-colors disabled:opacity-50"
            title="上传图片、视频或音频"
          >
            {isUploading ? <Loader2 size={16} className="text-gray-400 animate-spin" /> : <Upload size={16} className="text-gray-400" />}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden"
            onChange={async e => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              for (const f of files) await handleUploadFile(f);
            }}
          />

          {/* 提交审核按钮 */}
          {showSubmitButton && (
            isSubmittingAssets || anyProcessing ? (
              <span className="text-xs text-yellow-400 flex items-center gap-1 ml-1">
                <Loader2 size={12} className="animate-spin" />审核中...
              </span>
            ) : allActive ? (
              <span className="text-xs text-green-400 flex items-center gap-1 ml-1">
                <CheckCircle size={12} />已入库
              </span>
            ) : (hasUnreviewed || anyFailed) ? (
              <button
                onClick={handleSubmitAssets}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded ml-1 ${anyFailed ? 'text-red-400 hover:text-red-300' : 'text-blue-400 hover:text-blue-300'}`}
              >
                <Upload size={12} />{anyFailed ? '部分失败，重试' : '提交审核'}
              </button>
            ) : null
          )}
        </div>

        {/* 提示词输入 */}
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="输入视频提示词，描述画面内容、动作、氛围..."
          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:border-blue-500 placeholder-gray-500"
          rows={5}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
        />

        {/* 设置行 */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* 时长（上拉选择） */}
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

          {/* 比例 */}
          <div className="relative">
            <button
              onClick={() => setShowRatioMenu(!showRatioMenu)}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition"
            >
              <Film size={14} />
              {ratioLabel}
              <ChevronDown size={12} />
            </button>
            {showRatioMenu && (
              <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
                {RATIO_OPTIONS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => { setRatio(r.value); setShowRatioMenu(false); }}
                    className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${r.value === ratio ? 'text-blue-400' : ''}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 分辨率 */}
          <div className="relative">
            <button
              onClick={() => setShowResolutionMenu(!showResolutionMenu)}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition"
            >
              <Film size={14} />
              {resolutionLabel}
              <ChevronDown size={12} />
            </button>
            {showResolutionMenu && (
              <div className="absolute bottom-full mb-1 left-0 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 overflow-hidden">
                {RESOLUTION_OPTIONS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => { setResolution(r.value); setShowResolutionMenu(false); }}
                    className={`block w-full text-left px-4 py-1.5 text-sm hover:bg-gray-600 whitespace-nowrap ${r.value === resolution ? 'text-blue-400' : ''}`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 声音开关 */}
          <button
            onClick={() => setGenerateAudio(!generateAudio)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition ${generateAudio ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-700 hover:bg-gray-600 text-gray-400'}`}
            title={generateAudio ? '已开启声音' : '已关闭声音'}
          >
            {generateAudio ? <Volume2 size={14} /> : <VolumeX size={14} />}
            {generateAudio ? '有声' : '无声'}
          </button>

          <div className="flex-1" />

          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim() || selectedMedia.length === 0}
            className="flex items-center gap-2 px-5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition"
          >
            {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            生成
          </button>
        </div>
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
}

function VideoItem({ video, projectId, isPolling, isPlaying, onPlay, onRegenerate }: VideoItemProps) {
  const videoUrl = getVideoUrl(video, projectId);
  const displayRatio = inferRatioFromVideo(video);
  const resLabel = `${displayRatio} ${normalizeResolutionValue(video.resolution)}`;
  const normRes = normalizeResolutionValue(video.resolution);
  const isPortrait = displayRatio === '9:16';
  const isUltraWide = displayRatio === '21:9';
  const baseHeight = normRes === '1080p' ? 270 : normRes === '480p' ? 150 : 210;
  const previewH = isPortrait ? (normRes === '1080p' ? 400 : normRes === '480p' ? 220 : 300) : baseHeight;
  const previewW = isPortrait ? Math.round(previewH * 9 / 16) : isUltraWide ? Math.round(previewH * 21 / 9) : Math.round(previewH * 16 / 9);

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
          {video.reference_media && video.reference_media.length > 0 && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {video.reference_media.slice(0, 4).map((m, i) => (
                m.type === 'image' && m.url ? (
                  <img key={i} src={getThumbnailUrl(m.url)} alt={m.name} className="w-7 h-7 rounded object-cover border border-gray-600 flex-shrink-0" />
                ) : m.type === 'video' ? (
                  <div key={i} className="w-7 h-7 rounded bg-gray-700 border border-gray-600 flex items-center justify-center flex-shrink-0">
                    <Film size={12} className="text-blue-400" />
                  </div>
                ) : (
                  <div key={i} className="w-7 h-7 rounded bg-gray-700 border border-gray-600 flex items-center justify-center flex-shrink-0">
                    <Music size={12} className="text-purple-400" />
                  </div>
                )
              ))}
              {video.reference_media.length > 4 && (
                <span className="text-xs text-gray-500">+{video.reference_media.length - 4}</span>
              )}
            </div>
          )}
          {/* 提示词 */}
          <span className="flex-1 text-sm text-gray-300 line-clamp-2 group-hover:text-white transition-colors">
            {video.prompt}
          </span>
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
      {video.status === 'pending' || video.status === 'in_progress' ? (
        <div className="h-12 border-t border-gray-700 flex items-center px-3 gap-2 text-gray-500">
          <Loader2 size={14} className="animate-spin flex-shrink-0" />
          <span className="text-xs">生成中，请稍候...</span>
        </div>
      ) : video.status === 'failed' ? (
        <div className="h-12 border-t border-gray-700 flex items-center px-3 gap-2 text-red-400">
          <XCircle size={14} className="flex-shrink-0" />
          <span className="text-xs">生成失败</span>
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
    </div>
  );
}
