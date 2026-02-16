import { useState, useEffect, useRef } from 'react';
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
}

export function VideoGallery({
  projectId,
  storyboardId,
  episodeId,
  onClose,
  storyboardCount = 0,
  loadStoryboards,
  storyboardPrimaryImages
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
  const [displayedVideos, setDisplayedVideos] = useState<VideoRecord[]>([]); // 当前显示的视频
  const [displayCount] = useState(10);                                  // 每次显示的数量
  const [hasMore, setHasMore] = useState(true);                        // 是否还有更多
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

  // 加载所有视频（一次性从后端加载）
  const loadAllVideos = async () => {
    setLoading(true);
    try {
      const response = await generationApi.listVideos(projectId, episodeId);
      let videoList = response.data || [];

      // 如果指定了 storyboardId，过滤
      if (storyboardId) {
        videoList = videoList.filter((v: VideoRecord) => v.storyboard_id === storyboardId);
      }

      setAllVideos(videoList);  // 保存全部到内存
      setDisplayedVideos(videoList.slice(0, displayCount)); // 只显示前10个
      setHasMore(videoList.length > displayCount);
      setError('');
      return videoList;  // 返回视频列表
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || '加载视频失败');
      return [];  // 错误时返回空数组
    } finally {
      setLoading(false);
    }
  };

  // 加载更多（追加下一批）
  const loadMore = () => {
    if (!hasMore) return;

    const currentLength = displayedVideos.length;
    const nextBatch = allVideos.slice(currentLength, currentLength + displayCount);

    if (nextBatch.length > 0) {
      setDisplayedVideos(prev => [...prev, ...nextBatch]);
      setHasMore(currentLength + nextBatch.length < allVideos.length);
    } else {
      setHasMore(false);
    }
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
    const pendingVideos = videosRef.current.filter(v => v.status !== 'completed' && v.status !== 'failed');
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

      // 同时更新两个列表
      setAllVideos(prev => prev.map(v => updateMap.get(v.video_id) || v));
      setDisplayedVideos(prev => prev.map(v => updateMap.get(v.video_id) || v));
    }
  };

  // 轮询单个视频
  const pollSingleVideo = async (videoId: string): Promise<VideoRecord | null> => {
    if (pollingVideos.has(videoId)) return null; // 避免重复轮询

    setPollingVideos(prev => new Set(prev).add(videoId));

    try {
      const response = await generationApi.pollVideo(projectId, videoId);
      const updatedVideo = response.data;

      // 同时更新两个列表
      setAllVideos(prev => prev.map(v =>
        v.video_id === videoId ? updatedVideo : v
      ));
      setDisplayedVideos(prev => prev.map(v =>
        v.video_id === videoId ? updatedVideo : v
      ));

      if (updatedVideo.status === 'completed') {
        toast(`视频生成完成`, 'success');
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

  const handleDeleteVideo = async (videoId: string) => {
    if (!confirm('确定删除此视频？')) return;

    try {
      const response = await fetch(`/api/projects/${projectId}/videos/${videoId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // 同时从两个列表中删除
        setAllVideos(prev => prev.filter(v => v.video_id !== videoId));
        setDisplayedVideos(prev => {
          const filtered = prev.filter(v => v.video_id !== videoId);

          // 如果删除后displayedVideos变少，自动补充下一个
          const currentLength = filtered.length;
          if (currentLength < displayCount && allVideos.length > currentLength) {
            const nextVideo = allVideos.find((v, idx) =>
              idx >= currentLength && !filtered.find(d => d.video_id === v.video_id)
            );
            if (nextVideo) {
              return [...filtered, nextVideo];
            }
          }

          return filtered;
        });
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

      // 同时更新两个列表
      setAllVideos(updatePrimary);
      setDisplayedVideos(updatePrimary);
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
      // 动态计算高度（增加到480/580以避免溢出遮挡）
      const isWideScreen = window.innerWidth >= 768;
      return isWideScreen ? 480 : 580; // ✅ 双列480px，单列580px（考虑gap + 实际卡片高度）
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
          <h2 className="text-xl font-semibold">视频库 ({allVideos.length})</h2>
          <div className="flex items-center gap-2">
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
                            onDelete={handleDeleteVideo}
                            onPoll={pollSingleVideo}
                          />
                        )}
                        {video2 && (
                          <VideoCard
                            video={video2}
                            projectId={projectId}
                            isPolling={pollingVideos.has(video2.video_id)}
                            posterUrl={storyboardThumbnails.get(video2.storyboard_id)}
                            onSetPrimary={handleSetPrimaryVideo}
                            onDelete={handleDeleteVideo}
                            onPoll={pollSingleVideo}
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
            显示 {displayedVideos.length} / {allVideos.length} 个视频
            {allVideos.filter(v => v.status !== 'completed' && v.status !== 'failed').length > 0 && (
              <span className="ml-2 text-yellow-400">
                ({allVideos.filter(v => v.status !== 'completed' && v.status !== 'failed').length} 个生成中，每30秒自动轮询)
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className="w-full max-w-5xl">
        <div className="flex justify-between items-center mb-4 px-4">
          <h3 className="text-white text-lg">{video.prompt}</h3>
          <button onClick={onClose} className="text-white hover:text-gray-300">
            <X size={24} />
          </button>
        </div>
        <div className="aspect-video bg-black">
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
