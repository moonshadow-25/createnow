import { useState, useEffect, useRef } from 'react';
import { generationApi } from '@/services/api';
import { videoDownloadStore } from '@/store/videoDownloadStore';

interface VideoExportDownloadContext {
  projectId: string;
  episodeId?: string;
  toast: (message: string, type: 'success' | 'error' | 'info') => void;
  loadStoryboards?: () => Promise<void>;
}

/**
 * 视频导出和下载 Hook
 * 提供视频导出、下载和状态轮询功能
 *
 * @param context 操作上下文
 * @returns 导出下载函数和状态
 */
export const useVideoExportDownload = (context: VideoExportDownloadContext) => {
  const { projectId, episodeId, toast, loadStoryboards } = context;

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const lastExportUrlRef = useRef<string | null>(null);

  /**
   * 一键下载所有视频
   */
  const handleDownloadAllVideos = async () => {
    try {
      videoDownloadStore.startDownload(projectId);
      await generationApi.downloadAllVideos(projectId);
      toast('开始下载所有视频...', 'info');
    } catch (error: any) {
      videoDownloadStore.failDownload(projectId, error.message);
      toast('启动下载失败: ' + error.message, 'error');
    }
  };

  /**
   * 一键导出视频
   */
  const handleExportVideos = async () => {
    if (!episodeId) {
      toast('请先选择剧集', 'error');
      return;
    }

    try {
      setIsExporting(true);
      setExportProgress(0);
      lastExportUrlRef.current = null;  // 重置已下载URL
      await generationApi.exportVideos(projectId, episodeId);
      toast('视频导出任务已启动...', 'info');
    } catch (error: any) {
      setIsExporting(false);
      toast('启动导出失败: ' + error.message, 'error');
    }
  };

  /**
   * 轮询视频导出状态
   */
  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let isCancelled = false;  // 防止组件卸载后继续执行

    if (isExporting) {
      pollInterval = setInterval(async () => {
        if (isCancelled) return;

        try {
          const response = await generationApi.getVideoExportStatus(projectId);
          const { status, progress, download_url, errors } = response.data;

          if (isCancelled) return;

          setExportProgress(progress || 0);

          if (status === 'completed') {
            // 立即清除 interval，防止重复执行
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }

            // 检查是否已经下载过这个URL（使用 ref 的当前值）
            if (download_url && download_url !== lastExportUrlRef.current) {
              lastExportUrlRef.current = download_url;  // 立即标记为已下载
              setIsExporting(false);

              // 显示完成消息
              if (errors && errors.length > 0) {
                console.log('Export warnings/debug:', errors);
                const realErrors = errors.filter((e: string) => !e.startsWith('[DEBUG]'));
                if (realErrors.length > 0) {
                  toast(`导出完成（有 ${realErrors.length} 个警告）`, 'success');
                } else {
                  toast('导出完成！', 'success');
                }
              } else {
                toast('导出完成！', 'success');
              }

              // 自动触发下载
              const link = document.createElement('a');
              link.href = download_url;
              link.download = '';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            } else {
              // 已经下载过了，只需停止
              setIsExporting(false);
            }
          } else if (status === 'error') {
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            setIsExporting(false);
            const errorMsg = errors && errors.length > 0 ? errors[0] : '导出失败';
            toast(errorMsg, 'error');
          }
        } catch (error) {
          console.error('Failed to poll export status:', error);
        }
      }, 1000);
    }

    return () => {
      isCancelled = true;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [isExporting, projectId, toast]);

  /**
   * 轮询视频下载状态
   */
  useEffect(() => {
    const state = videoDownloadStore.getState(projectId);
    const isVideoDownloading = state.status === 'running';

    if (isVideoDownloading) {
      const pollInterval = setInterval(async () => {
        try {
          const response = await generationApi.getVideoDownloadStatus(projectId);
          videoDownloadStore.setState(projectId, {
            status: response.data.status,
            progress: response.data.progress,
            currentVideo: response.data.current || '',
            errors: response.data.errors || [],
          });

          if (response.data.status === 'completed') {
            videoDownloadStore.completeDownload(projectId);
            clearInterval(pollInterval);
            toast(`视频下载完成！已下载 ${response.data.progress.downloaded_videos} 个视频`, 'success');
            if (loadStoryboards) {
              loadStoryboards(); // 刷新以更新本地视频
            }
          } else if (response.data.status === 'error') {
            videoDownloadStore.failDownload(projectId, '下载过程中出错');
            clearInterval(pollInterval);
          }
        } catch (error) {
          console.error('Failed to poll video download status:', error);
        }
      }, 1000);

      return () => clearInterval(pollInterval);
    }
  }, [projectId, toast, loadStoryboards]);

  return {
    isExporting,
    exportProgress,
    handleDownloadAllVideos,
    handleExportVideos,
  };
};
