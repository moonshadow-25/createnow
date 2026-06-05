import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

// 解析 resolution（如 "1080x1920"），判断是否竖版
function isPortraitResolution(resolution?: string): boolean {
  if (!resolution) return false;
  const parts = resolution.split('x');
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  return !!(w && h && h > w);
}

// 根据 resolution 返回容器宽高比样式
function getAspectRatioStyle(resolution?: string): CSSProperties {
  if (!resolution) return { aspectRatio: '16/9' };
  const parts = resolution.split('x');
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!w || !h) return { aspectRatio: '16/9' };
  return { aspectRatio: `${w}/${h}` };
}
import { X, Download, Video, RefreshCw, Loader2, HardDrive } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useToast } from '@/components/common/Toast';
import { generationApi } from '@/services/api';
import { VideoCard, VideoRecord } from './VideoCard';
import { getVideoUrl } from './utils/mediaUtils';
import { useVideoExportDownload } from './hooks/useVideoExportDownload';
import { useIsVideoDownloading, useVideoDownloadProgress } from '@/store/videoDownloadStore';

interface Image {
  image_id: string;
  image_path: string;
  local_path?: string;
  is_downloaded?: boolean;
  prompt: string;
  is_primary: boolean;
}

interface VideoGalleryProps {
  projectId: string;
  storyboardId?: string;
  episodeId?: string;
  onClose?: () => void;
  storyboardCount?: number;
  loadStoryboards?: () => Promise<void>;
  storyboardPrimaryImages?: Map<string, string>; // 父组件提供的分镜主图 Map
  libraryOnly?: boolean;
  initialVideos?: any[];
}

export function VideoGallery({
  projectId,
  storyboardId,
  episodeId,
  onClose,
  storyboardCount = 0,
  loadStoryboards,
  storyboardPrimaryImages,
  libraryOnly = false,
  initialVideos,
}: VideoGalleryProps) {
  const { toast } = useToast();

  // 使用视频导出下载 hook
  const {
    isExporting,
    exportProgress,
    handleDownloadAllVideos,
    handleExportVideos
  } = useVideoExportDownload({
    projectId,
    episodeId,
    toast,
    loadStoryboards
  });

  // 从 store 获取下载状态
  const isDownloading = useIsVideoDownloading(projectId);
  const downloadProgress = useVideoDownloadProgress(projectId);

  const [allVideos, setAllVideos] = useState<VideoRecord[]>([]);        // 所有视频（内存）
  const [displayCount] = useState(10);                                  // 每次显示的数量
  const [visibleCount, setVisibleCount] = useState(10);
  const [authorFilter, setAuthorFilter] = useState('__all__');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pollingVideos, setPollingVideos] = useState<Set<string>>(new Set());
  const [storyboardThumbnails, setStoryboardThumbnails] = useState<Map<string, string>>(new Map()); // storyboardId -> thumbnail URL
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videosRef = useRef<VideoRecord[]>([]); // 存储最新的allVideos状态，供定时器访问
  const parentRef = useRef<HTMLDivElement>(null); // 虚拟滚动容器ref

  useEffect(() => {
    const init = async () => {
      const videoList = await loadAllVideos();

      // 优先使用父组件传入的分镜主图数据
      if (storyboardPrimaryImages && storyboardPrimaryImages.size > 0) {
        // 从父组件的 Map 构建缩略图 Map
        const thumbnailMap = new Map<string, string>();
        storyboardPrimaryImages.forEach((imageUrl, storyboardId) => {
          // 将原图路径转换为缩略图路径
          const thumbnailUrl = imageUrl.replace('/images/files/', '/thumbnails/');
          thumbnailMap.set(storyboardId, thumbnailUrl);
        });
        setStoryboardThumbnails(thumbnailMap);
      } else {
        // 没有父组件数据，才发起请求加载
        await loadStoryboardThumbnails(videoList);
      }

      // 手动更新ref，确保立即轮询时能读取到最新数据
      videosRef.current = videoList;
      // 立即执行一次轮询
      pollPendingVideos();

      // 设置自动轮询（每30秒）
      pollIntervalRef.current = setInterval(() => {
        pollPendingVideos();
      }, 30000);
    };

    init();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [projectId, storyboardId, episodeId, storyboardPrimaryImages]);

  // 同步allVideos状态到ref，供定时器访问最新值
  useEffect(() => {
    videosRef.current = allVideos;
  }, [allVideos]);

  const authorOptions = Array.from(new Set(
    allVideos.map(v => (v.created_by || '').trim() || '__unknown__')
  )).sort((a, b) => {
    if (a === '__unknown__') return 1;
    if (b === '__unknown__') return -1;
    return a.localeCompare(b, 'zh');
  });
  const filteredVideos = authorFilter === '__all__'
    ? allVideos
    : allVideos.filter(v => ((v.created_by || '').trim() || '__unknown__') === authorFilter);
  const displayedVideos = filteredVideos.slice(0, visibleCount);
  const hasMore = visibleCount < filteredVideos.length;

  useEffect(() => {
    setVisibleCount(displayCount);
    parentRef.current?.scrollTo({ top: 0 });
  }, [authorFilter, displayCount]);

  // 监听滚动，到底部时加载更多
  useEffect(() => {
    const scrollElement = parentRef.current;
    if (!scrollElement) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const scrolledToBottom = scrollHeight - scrollTop - clientHeight < 50; // 距底部50px

      // 滚动到底部且还有更多时，加载下一批
      if (scrolledToBottom && hasMore && !loading) {
        loadMore();
      }
    };

    scrollElement.addEventListener('scroll', handleScroll);
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, [hasMore, loading, displayedVideos.length]);

  // 加载所有视频（有 initialVideos 时直接用内存数据，跳过网络请求）
  const loadAllVideos = async (forceRemote = false) => {
    if (initialVideos && !forceRemote) {
      // 视频库要最新在上面（降序），广场传入的是升序，这里反转，不影响原数组
      const videoList = [...initialVideos].reverse();
      setAllVideos(videoList);
      setVisibleCount(displayCount);
      setLoading(false);
      setError('');
      return videoList;
    }

    setLoading(true);
    try {
      const response = libraryOnly
        ? await generationApi.listLibraryVideos(projectId)
        : await generationApi.listVideos(projectId, episodeId);
      let videoList = response.data || [];

      // 广场模式只保留非分镜视频，兜底过滤
      if (libraryOnly) {
        videoList = videoList.filter((v: VideoRecord) => !v.storyboard_id);
      }

      // 如果指定了 storyboardId，过滤
      if (storyboardId) {
        videoList = videoList.filter((v: VideoRecord) => v.storyboard_id === storyboardId);
      }

      setAllVideos(videoList);
      setVisibleCount(displayCount);
      setError('');
      return videoList;
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || '加载视频失败');
      return [];
    } finally {
      setLoading(false);
    }
  };

  // 加载更多（追加下一批）
  const loadMore = () => {
    if (!hasMore) return;
    setVisibleCount(prev => Math.min(prev + displayCount, filteredVideos.length));
  };

  // 加载分镜缩略图
  const loadStoryboardThumbnails = async (videos: VideoRecord[]) => {
    try {
      // 提取所有唯一的 storyboard_id
      const uniqueStoryboardIds = [...new Set(videos.map(v => v.storyboard_id))];

      if (uniqueStoryboardIds.length === 0) return;

      // 批量查询所有分镜（如果没有 episodeId，只能逐个查询）
      const storyboardPromises = uniqueStoryboardIds.map(async (sbId) => {
        try {
          // 通过 generationApi 获取分镜的图片列表
          const response = await generationApi.listImages(projectId, sbId);
          const images: Image[] = response.data || [];

          // 找到 primary image
          const primaryImage = images.find(img => img.is_primary);

          if (primaryImage && primaryImage.local_path) {
            // 构建缩略图 URL
            const thumbnailUrl = `/api/projects/${projectId}/thumbnails/${primaryImage.local_path}`;
            return { storyboardId: sbId, thumbnailUrl };
          }
          return null;
        } catch (err) {
          console.error(`Failed to load storyboard ${sbId}:`, err);
          return null;
        }
      });

      const results = await Promise.allSettled(storyboardPromises);

      // 构建 Map
      const thumbnailMap = new Map<string, string>();
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          thumbnailMap.set(result.value.storyboardId, result.value.thumbnailUrl);
        }
      });

      setStoryboardThumbnails(thumbnailMap);
    } catch (err) {
      console.error('Failed to load storyboard thumbnails:', err);
    }
  };

  // 轮询所有未完成状态的视频（并发）
  const pollPendingVideos = async () => {
    const pendingVideos = videosRef.current.filter(v => {
      const status = v.status || 'pending';
      return status === 'pending' || status === 'queued' || status === 'in_progress';
    });
    if (pendingVideos.length === 0) return;

    // 并发轮询所有pending视频
    const results = await Promise.allSettled(
      pendingVideos.map(video => pollSingleVideo(video.video_id))
    );

    // 收集成功的结果
    const successResults = results
      .filter((r): r is PromiseFulfilledResult<VideoRecord> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((v): v is VideoRecord => v !== null);

    // 批量更新状态（一次render而非多次）
    if (successResults.length > 0) {
      const updateMap = new Map(successResults.map(v => [v.video_id, v]));

      // 批量更新状态（一次render而非多次）
      setAllVideos(prev => prev.map(v => updateMap.get(v.video_id) || v));
    }
  };

  // 轮询单个视频
  const pollSingleVideo = async (videoId: string): Promise<VideoRecord | null> => {
    if (pollingVideos.has(videoId)) return null; // 避免重复轮询

    setPollingVideos(prev => new Set(prev).add(videoId));

    try {
      const response = await generationApi.pollVideo(projectId, videoId);
      const updatedVideo = response.data;

      setAllVideos(prev => prev.map(v =>
        v.video_id === videoId ? updatedVideo : v
      ));

      if (updatedVideo.status === 'completed') {
        toast(`视频生成完成`, 'success');
      } else if (updatedVideo.status === 'poll_failed') {
        toast(`轮询失败，已暂停自动轮询，可手动继续`, 'error');
      } else if (updatedVideo.status === 'failed') {
        toast(`视频生成失败: ${updatedVideo.error || '未知错误'}`, 'error');
      }

      return updatedVideo;
    } catch (err: any) {
      console.error('Poll video error:', err);
      return null;
    } finally {
      setPollingVideos(prev => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
    }
  };

  // 发起字幕擦除（创建新视频记录，不覆盖旧视频）
  const handleRemoveSubtitle = async (video: VideoRecord) => {
    const sourceVideoUrl = (video.video_path || '').trim();
    if (!sourceVideoUrl.startsWith('http://') && !sourceVideoUrl.startsWith('https://')) {
      toast('字幕擦除仅支持远程原始 URL', 'error');
      return;
    }

    try {
      const res = await generationApi.removeVideoSubtitle(projectId, {
        source_video_id: video.video_id,
        source_video_url: sourceVideoUrl,
        storyboard_id: video.storyboard_id,
        episode_id: video.episode_id,
        prompt: `去除字幕: ${video.prompt}`,
      });
      toast('已创建字幕擦除任务（新视频）', 'success');
      const newVideo: VideoRecord = res.data;
      if (initialVideos) {
        // 有内存数据模式：直接把新视频插到列表头部，不全量拉取
        setAllVideos(prev => [newVideo, ...prev]);
      } else {
        await loadAllVideos(true);
      }
      pollPendingVideos();
    } catch (err: any) {
      toast(err.response?.data?.detail || '字幕擦除任务创建失败', 'error');
    }
  };

  const handleDeleteVideo = async (videoId: string) => {
    if (!confirm('确定删除此视频？')) return;

    try {
      const response = await fetch(`/api/projects/${projectId}/videos/${videoId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setAllVideos(prev => prev.filter(v => v.video_id !== videoId));
        toast('视频已删除', 'success');
      } else {
        toast('删除失败', 'error');
      }
    } catch (err) {
      toast('删除失败', 'error');
    }
  };

  const handleSetPrimaryVideo = async (videoId: string, videoStoryboardId: string) => {
    try {
      await generationApi.setPrimaryVideo(projectId, videoId, videoStoryboardId);

      const updatePrimary = (videos: VideoRecord[]) =>
        videos.map(v => ({
          ...v,
          is_primary: v.video_id === videoId && v.storyboard_id === videoStoryboardId
            ? true
            : v.storyboard_id === videoStoryboardId
              ? false
              : v.is_primary
        }));

      setAllVideos(updatePrimary);
      toast('已设为主视频', 'success');
    } catch (err: any) {
      toast(err.response?.data?.detail || '设置失败', 'error');
    }
  };

  // 设置虚拟滚动
  const rowVirtualizer = useVirtualizer({
    count: Math.ceil(displayedVideos.length / 2), // ✅ 基于displayedVideos，2列布局
    getScrollElement: () => parentRef.current,
    estimateSize: () => {
      // 所有卡片容器统一 16:9，高度一致
      const isWideScreen = window.innerWidth >= 768;
      return isWideScreen ? 480 : 580;
    },
    overscan: 1, // ✅ 只预渲染1行（2个卡片）
  });

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
        <div className="text-white flex items-center gap-2">
          <Loader2 className="animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold">视频库 ({filteredVideos.length}/{allVideos.length})</h2>
          <div className="flex items-center gap-2">
            <select
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
              title="按作者筛选"
            >
              <option value="__all__">全部作者</option>
              {authorOptions.map(author => (
                <option key={author} value={author}>{author === '__unknown__' ? '未知作者' : author}</option>
              ))}
            </select>
            {/* 导出视频按钮 */}
            <button
              onClick={handleExportVideos}
              disabled={isExporting || storyboardCount === 0}
              className="flex items-center gap-1 px-3 py-1 bg-teal-600 hover:bg-teal-700 rounded text-sm disabled:bg-gray-600 disabled:cursor-not-allowed"
              title="导出该剧集所有分镜视频"
            >
              {isExporting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  导出中 {Math.round(exportProgress)}%
                </>
              ) : (
                <>
                  <Download size={14} />
                  导出视频
                </>
              )}
            </button>
            {/* 下载视频按钮 */}
            <button
              onClick={handleDownloadAllVideos}
              disabled={isDownloading}
              className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 rounded text-sm disabled:bg-gray-600 disabled:cursor-not-allowed"
              title="下载所有已完成的视频到本地"
            >
              {isDownloading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  下载中 {Math.round(downloadProgress)}%
                </>
              ) : (
                <>
                  <HardDrive size={14} />
                  下载视频
                </>
              )}
            </button>
            <button
              onClick={() => {
                loadAllVideos();
                pollPendingVideos();
              }}
              className="flex items-center gap-1 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              title="刷新并轮询"
            >
              <RefreshCw size={14} />
              刷新
            </button>
            {onClose && (
              <button onClick={onClose} className="text-gray-400 hover:text-white">
                <X size={24} />
              </button>
            )}
          </div>
        </div>

        {/* 内容 */}
        <div
          ref={parentRef}
          className="flex-1 overflow-y-auto p-4"
          style={{ height: 'calc(90vh - 180px)' }}
        >
          {error ? (
            <div className="text-red-400 text-center">{error}</div>
          ) : displayedVideos.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              <Video size={48} className="mx-auto mb-4 opacity-50" />
              <p>暂无视频</p>
              <p className="text-sm mt-2">生成分镜图后，点击"生成视频"按钮创建视频</p>
            </div>
          ) : (
            <>
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const startIndex = virtualRow.index * 2;
                  const video1 = displayedVideos[startIndex];
                  const video2 = displayedVideos[startIndex + 1];

                  return (
                    <div
                      key={virtualRow.key}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                        zIndex: 9999 - virtualRow.index, // 反转z-index，让前面的行在最上层
                      }}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-1">
                        {video1 && (
                          <VideoCard
                            video={video1}
                            projectId={projectId}
                            isPolling={pollingVideos.has(video1.video_id)}
                            posterUrl={storyboardThumbnails.get(video1.storyboard_id)}
                            onSetPrimary={handleSetPrimaryVideo}
                            showSetPrimary={!libraryOnly && !!video1.storyboard_id}
                            onDelete={handleDeleteVideo}
                            onPoll={pollSingleVideo}
                            onRemoveSubtitle={handleRemoveSubtitle}
                          />
                        )}
                        {video2 && (
                          <VideoCard
                            video={video2}
                            projectId={projectId}
                            isPolling={pollingVideos.has(video2.video_id)}
                            posterUrl={storyboardThumbnails.get(video2.storyboard_id)}
                            onSetPrimary={handleSetPrimaryVideo}
                            showSetPrimary={!libraryOnly && !!video2.storyboard_id}
                            onDelete={handleDeleteVideo}
                            onPoll={pollSingleVideo}
                            onRemoveSubtitle={handleRemoveSubtitle}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 加载更多指示器 */}
              {hasMore && (
                <div className="text-center py-4 text-gray-400">
                  <Loader2 className="animate-spin inline-block mr-2" size={16} />
                  <span className="text-sm">向下滚动加载更多...</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部 */}
        <div className="p-4 border-t border-gray-700 flex justify-between items-center">
          <div className="text-sm text-gray-400">
            显示 {displayedVideos.length} / {filteredVideos.length} 个视频
            {authorFilter !== '__all__' && <span className="ml-2 text-gray-500">（全部 {allVideos.length} 个）</span>}
            {allVideos.filter(v => {
              const status = v.status || 'pending';
              return status === 'pending' || status === 'queued' || status === 'in_progress';
            }).length > 0 && (
              <span className="ml-2 text-yellow-400">
                ({allVideos.filter(v => {
                  const status = v.status || 'pending';
                  return status === 'pending' || status === 'queued' || status === 'in_progress';
                }).length} 个生成中，每30秒自动轮询)
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">
            {hasMore ? '向下滚动加载更多' : displayedVideos.length > 0 ? '已显示全部视频' : '点击"手动轮询"立即查询状态'}
          </div>
        </div>
      </div>
    </div>
  );
}

// 视频播放器模态框
export function VideoPlayer({ video, projectId, onClose }: { video: VideoRecord; projectId: string; onClose: () => void }) {
  const videoUrl = getVideoUrl(video, projectId);
  const portrait = isPortraitResolution(video.resolution);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className={portrait ? 'flex flex-col max-h-[90vh]' : 'w-full max-w-5xl'}>
        <div className="flex justify-between items-center mb-4 px-4">
          <h3 className="text-white text-lg">{video.prompt}</h3>
          <button onClick={onClose} className="text-white hover:text-gray-300">
            <X size={24} />
          </button>
        </div>
        <div
          className="bg-black"
          style={{
            ...getAspectRatioStyle(video.resolution),
            maxHeight: '80vh',
            width: portrait ? 'auto' : '100%',
          }}
        >
          {videoUrl ? (
            <video
              src={videoUrl}
              className="w-full h-full"
              controls
              preload="none"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white">
              <div className="text-center">
                <Loader2 size={48} className="mx-auto mb-4 animate-spin" />
                <div>视频生成中...</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
