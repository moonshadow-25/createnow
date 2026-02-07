import { useState, useEffect, useRef } from 'react';
import { generationApi } from '@/services/api';

interface SelectedStoryboardsExportContext {
  projectId: string;
  episodeId?: string;
  selectedStoryboardIds: Set<string>;
  toast: (message: string, type: 'success' | 'error' | 'info') => void;
}

/**
 * 选中分镜导出 Hook
 * 提供选中分镜的视频导出功能
 */
export const useSelectedStoryboardsExport = (context: SelectedStoryboardsExportContext) => {
  const { projectId, episodeId, selectedStoryboardIds, toast } = context;

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const lastExportUrlRef = useRef<string | null>(null);

  /**
   * 导出选中的分镜视频
   */
  const handleExportSelectedVideos = async () => {
    if (selectedStoryboardIds.size === 0) {
      toast('请先选择要导出的分镜', 'error');
      return;
    }

    if (!episodeId) {
      toast('请先选择剧集', 'error');
      return;
    }

    try {
      setIsExporting(true);
      setExportProgress(0);
      lastExportUrlRef.current = null;

      const storyboardIds = Array.from(selectedStoryboardIds);
      await generationApi.exportVideos(projectId, episodeId, storyboardIds);

      toast(`开始导出选中的 ${storyboardIds.length} 个分镜视频...`, 'info');
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
    let isCancelled = false;

    if (isExporting) {
      pollInterval = setInterval(async () => {
        if (isCancelled) return;

        try {
          const response = await generationApi.getVideoExportStatus(projectId);
          const { status, progress, download_url, errors } = response.data;

          if (isCancelled) return;

          setExportProgress(progress || 0);

          if (status === 'completed') {
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }

            // 检查是否已经下载过这个URL
            if (download_url && download_url !== lastExportUrlRef.current) {
              lastExportUrlRef.current = download_url;
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

  return {
    isExporting,
    exportProgress,
    handleExportSelectedVideos,
  };
};
