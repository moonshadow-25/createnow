import { useState, useEffect } from 'react';
import { generationApi } from '@/services/api';

interface JianyingExportContext {
  projectId: string;
  episodeId?: string;
  selectedStoryboardIds: Set<string>;
  toast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const useJianyingExport = (context: JianyingExportContext) => {
  const { projectId, episodeId, selectedStoryboardIds, toast } = context;

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMethod, setExportMethod] = useState<'new' | 'existing' | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);

  /**
   * 导出到剪映
   * @param options 对话框返回的选项
   */
  const handleExportToJiaying = async (options: {
    mode: 'new' | 'existing';
    projectName?: string;
    existingProjectId?: string;
  }) => {
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
      setExportMethod(options.mode);

      const storyboardIds = Array.from(selectedStoryboardIds);

      await generationApi.exportToJiaying(
        projectId,
        episodeId,
        storyboardIds,
        options.mode,
        options.projectName,
        options.existingProjectId
      );

      const message = options.mode === 'new'
        ? `开始创建剪映项目：${options.projectName}...`
        : '开始导入到现有项目...';

      toast(message, 'info');
    } catch (error: any) {
      setIsExporting(false);
      toast('启动导出失败: ' + error.message, 'error');
    }
  };

  /**
   * 轮询导出状态
   */
  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let isCancelled = false;

    if (isExporting) {
      pollInterval = setInterval(async () => {
        if (isCancelled) return;

        try {
          const response = await generationApi.getJianyingExportStatus(projectId);
          const { status, progress, method, path, errors } = response.data;

          if (isCancelled) return;

          setExportProgress(progress || 0);
          setExportMethod(method);
          setExportPath(path);

          if (status === 'completed') {
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }
            setIsExporting(false);

            // 根据导出方式显示不同的提示
            if (method === 'new') {
              toast('✅ 已创建新项目！请在剪映中打开', 'success');
            } else {
              toast('✅ 已添加到现有项目！请在剪映中查看', 'success');
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
          console.error('Failed to poll jiaying export status:', error);
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
    exportMethod,
    exportPath,
    handleExportToJiaying,
  };
};
