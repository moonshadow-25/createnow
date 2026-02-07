import { useCallback, useState, useEffect } from 'react';
import { generationApi } from '@/services/api';

interface TripleGridOperationsContext {
  projectId: string;
  toast: (message: string, type: 'success' | 'error' | 'info') => void;
  startTask: (taskId: string, type: any) => void;
  completeTask: (taskId: string, type: any) => void;
  failTask: (taskId: string, type: any, error: string) => void;
  loadStoryboards: () => Promise<void>;
  onUpdated: () => void;
  editingStoryboardIdRef: React.MutableRefObject<string | null>;
}

/**
 * 三宫格操作 Hook
 * 提供三宫格生成、拆解和模板加载功能
 *
 * @param context 操作上下文
 * @returns 三宫格操作函数和状态
 */
export const useTripleGridOperations = (context: TripleGridOperationsContext) => {
  const {
    projectId,
    toast,
    startTask,
    completeTask,
    failTask,
    loadStoryboards,
    onUpdated,
    editingStoryboardIdRef
  } = context;

  const [tripleGridPromptTemplate, setTripleGridPromptTemplate] = useState('');
  const [isSplittingTripleGrid, setIsSplittingTripleGrid] = useState(false);

  /**
   * 加载三宫格提示词模板
   */
  useEffect(() => {
    const loadTripleGridTemplate = async () => {
      try {
        const response = await generationApi.getPromptTemplates(projectId);
        if (response.data?.triple_grid_prompt_template) {
          setTripleGridPromptTemplate(response.data.triple_grid_prompt_template);
        }
      } catch (error) {
        console.error('Failed to load triple grid template:', error);
      }
    };
    loadTripleGridTemplate();
  }, [projectId]);

  /**
   * 生成三宫格分镜图
   */
  const handleGenerateTripleGrid = useCallback(async (
    editingStoryboard: any,
    storyboardImages: any[],
    prompt: string,
    setStoryboardImages: (images: any[]) => void,
    setShowTripleGridDialog: (show: boolean) => void
  ) => {
    if (!editingStoryboard) return;

    const primaryImage = storyboardImages.find(img => img.is_primary) || storyboardImages[0];
    if (!primaryImage) {
      toast('请先生成分镜图片', 'error');
      return;
    }

    // 状态隔离：记录发起请求时的分镜ID
    const requestStoryboardId = editingStoryboard.asset_id;

    setShowTripleGridDialog(false);
    startTask(editingStoryboard.asset_id, 'triple_grid');

    try {
      await generationApi.editImage(projectId, {
        assetId: editingStoryboard.asset_id,
        assetType: 'storyboard',
        prompt,
        referenceImageIds: [primaryImage.image_id],
        size: '6:19',
      });

      toast('三宫格生成成功', 'success');
      completeTask(requestStoryboardId, 'triple_grid');

      // 始终刷新分镜列表（更新卡片显示）
      await loadStoryboards();

      // 状态隔离：只有弹框仍打开且是同一分镜时，才更新弹框内的图片列表
      if (editingStoryboardIdRef.current === requestStoryboardId) {
        const imagesResponse = await generationApi.listImages(projectId, requestStoryboardId);
        const sortedImages = (imagesResponse.data || []).sort((a: any, b: any) => {
          if (a.is_primary && !b.is_primary) return -1;
          if (!a.is_primary && b.is_primary) return 1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        setStoryboardImages(sortedImages);
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '生成失败';
      // 状态隔离：错误提示只在同一分镜时显示
      if (editingStoryboardIdRef.current === requestStoryboardId) {
        toast(`三宫格生成失败: ${errorMsg}`, 'error');
      }
      failTask(requestStoryboardId, 'triple_grid', errorMsg);
    }
  }, [projectId, toast, startTask, completeTask, failTask, loadStoryboards, editingStoryboardIdRef]);

  /**
   * 拆解三宫格分镜
   */
  const handleSplitTripleGrid = useCallback(async (
    editingStoryboard: any,
    storyboardImages: any[],
    setShowStoryboardEdit: (show: boolean) => void,
    setEditingStoryboard: (storyboard: any) => void,
    setEditingStoryboardId: (id: string | null) => void
  ) => {
    if (!editingStoryboard) return;

    const primaryImage = storyboardImages.find(img => img.is_primary) || storyboardImages[0];
    if (!primaryImage) {
      toast('请先生成分镜图片', 'error');
      return;
    }

    setIsSplittingTripleGrid(true);
    try {
      await generationApi.splitTripleGrid(projectId, editingStoryboard.asset_id);
      toast('三宫格拆解成功，已创建3个新分镜', 'success');
      await loadStoryboards();
      onUpdated();
      // 关闭编辑弹框
      setShowStoryboardEdit(false);
      setEditingStoryboard(null);
      setEditingStoryboardId(null); // 状态隔离：清空
      editingStoryboardIdRef.current = null; // 保持兼容性
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '拆解失败';
      toast(`拆解失败: ${errorMsg}`, 'error');
    } finally {
      setIsSplittingTripleGrid(false);
    }
  }, [projectId, toast, loadStoryboards, onUpdated, editingStoryboardIdRef]);

  return {
    tripleGridPromptTemplate,
    isSplittingTripleGrid,
    handleGenerateTripleGrid,
    handleSplitTripleGrid,
  };
};
