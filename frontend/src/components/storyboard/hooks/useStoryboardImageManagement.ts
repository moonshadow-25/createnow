import { useCallback, useRef } from 'react';
import { generationApi, storyboardApi } from '@/services/api';

interface ImageManagementContext {
  projectId: string;
  toast: (message: string, type: 'success' | 'error' | 'info') => void;
  startTask: (taskId: string, type: any) => void;
  completeTask: (taskId: string, type: any) => void;
  failTask: (taskId: string, type: any, error: string) => void;
  loadStoryboards: () => Promise<void>;
}

/**
 * 分镜图片管理 Hook
 * 提供图片编辑、主图设置、提示词生成、图片生成等功能
 *
 * @param context 操作上下文
 * @returns 图片管理函数
 */
export const useStoryboardImageManagement = (context: ImageManagementContext) => {
  const { projectId, toast, startTask, completeTask, failTask, loadStoryboards } = context;

  // 用于状态隔离的 ref
  const editingStoryboardIdRef = useRef<string | null>(null);

  /**
   * 设置当前编辑的分镜ID（用于状态隔离）
   */
  const setEditingStoryboardId = useCallback((storyboardId: string | null) => {
    editingStoryboardIdRef.current = storyboardId;
  }, []);

  /**
   * 打开图片编辑对话框
   * 加载指定分镜的所有图片
   */
  const handleEditImage = useCallback(async (
    storyboard: any,
    setCardImageEditStoryboard: (sb: any) => void,
    setCardImageEditImages: (images: any[]) => void,
    setShowCardImageEditDialog: (show: boolean) => void
  ) => {
    try {
      const imagesResponse = await generationApi.listImages(projectId, storyboard.asset_id);
      const images = imagesResponse.data || [];

      if (images.length === 0) {
        toast('请先通过"编辑分镜"界面生成分镜图', 'error');
        return;
      }

      const sortedImages = images.sort((a: any, b: any) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setCardImageEditStoryboard(storyboard);
      setCardImageEditImages(sortedImages);
      setShowCardImageEditDialog(true);
    } catch (error) {
      console.error('Failed to load images:', error);
      toast('加载图片失败', 'error');
    }
  }, [projectId, toast]);

  /**
   * 设置分镜主图
   */
  const handleSetPrimaryStoryboardImage = useCallback(async (
    editingStoryboard: any,
    imageId: string,
    setStoryboardImages: (images: any[]) => void
  ) => {
    if (!editingStoryboard) return;
    try {
      await generationApi.setPrimaryImage(projectId, editingStoryboard.asset_id, imageId);
      // 重新加载图片列表
      const response = await generationApi.listImages(projectId, editingStoryboard.asset_id);
      const sortedImages = (response.data || []).sort((a: any, b: any) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setStoryboardImages(sortedImages);
      loadStoryboards(); // 刷新分镜列表以更新主图显示
    } catch (error) {
      toast('设置主图失败', 'error');
    }
  }, [projectId, toast, loadStoryboards]);

  /**
   * 生成图片提示词
   */
  const handleGeneratePrompt = useCallback(async (
    editingStoryboard: any,
    selectedCharacters: string[],
    selectedScenes: string[],
    selectedProps: string[],
    characters: any[],
    scenes: any[],
    props: any[],
    setGeneratedPrompt: (prompt: string) => void
  ) => {
    if (!editingStoryboard) return;

    // 状态隔离：记录发起请求时的分镜ID
    const requestStoryboardId = editingStoryboard.asset_id;

    startTask(editingStoryboard.asset_id, 'prompt');
    try {
      // 判断是否有选中资产
      const hasSelectedAssets = selectedCharacters.length > 0 || selectedScenes.length > 0 || selectedProps.length > 0;

      let enhancedDescription: string;
      let useImageEdit = false;

      // 获取资产对象（两种模式都需要）
      // 重要：按照选择顺序获取，确保 image1, image2 与未来API传图顺序一致
      const selectedCharObjs = selectedCharacters
        .map(id => characters.find(c => c.asset_id === id))
        .filter(Boolean);

      const sceneObjs = selectedScenes
        .map(id => scenes.find(s => s.asset_id === id))
        .filter(Boolean);

      const selectedPropObjs = selectedProps
        .map(id => props.find(p => p.asset_id === id))
        .filter(Boolean);

      if (hasSelectedAssets) {
        // 图生图模式：使用 image 引用格式
        useImageEdit = true;

        // 构建参考图像描述（按选择顺序生成 image1, image2, ...）
        const referenceImages: string[] = [];
        let imageIndex = 1;

        // 角色引用：名字 + 年龄性别 + 描述
        selectedCharObjs.forEach(c => {
          const parts = [c.name];

          if (c.age || c.gender) {
            const ageGender = [c.age ? `${c.age}岁` : '', c.gender].filter(Boolean).join('');
            parts.push(ageGender);
          }

          if (c.appearance) {
            parts.push(c.appearance);
          } else if (c.description) {
            parts.push(c.description);
          }

          referenceImages.push(`image${imageIndex}: ${parts.join('，')}`);
          imageIndex++;
        });

        // 场景引用：名字 + 描述（支持多场景）
        sceneObjs.forEach(sceneObj => {
          const parts = [sceneObj.name];

          if (sceneObj.description) {
            parts.push(sceneObj.description);
          } else if (sceneObj.location) {
            parts.push(sceneObj.location);
          }

          referenceImages.push(`image${imageIndex}: ${parts.join('，')}`);
          imageIndex++;
        });

        // 道具引用：名字 + 描述
        selectedPropObjs.forEach(p => {
          const parts = [p.name];

          if (p.description) {
            parts.push(p.description);
          }

          referenceImages.push(`image${imageIndex}: ${parts.join('，')}`);
          imageIndex++;
        });

        // 构建完整描述
        const referenceBlock = referenceImages.join('\n');
        const storyboardParts = [
          editingStoryboard.description,
          editingStoryboard.action ? `动作: ${editingStoryboard.action}` : '',
          editingStoryboard.dialogue ? `对白: "${editingStoryboard.dialogue}"` : '',
          editingStoryboard.camera_angle ? `镜头角度: ${editingStoryboard.camera_angle}` : '',
        ].filter(Boolean).join('\n');

        enhancedDescription = `[Reference Images]\n${referenceBlock}\n\n[Storyboard Description]\n${storyboardParts}`;
      } else {
        // 原有模式：使用中文名称格式
        const charDetails = selectedCharObjs.map(c => {
          const info = [c.name];
          if (c.gender) info.push(`性别${c.gender}`);
          if (c.age) info.push(`${c.age}岁`);
          return info.join(' - ');
        });

        const sceneDetail = sceneObjs.length > 0
          ? sceneObjs.map(s => `${s.name}${s.location ? ` (${s.location})` : ''}`).join(', ')
          : '';

        const propObjs = props
          .filter(p => selectedProps.includes(p.asset_id))
          .map(p => p.name);

        enhancedDescription = [
          editingStoryboard.description,
          editingStoryboard.action ? `动作: ${editingStoryboard.action}` : '',
          editingStoryboard.dialogue ? `对白: "${editingStoryboard.dialogue}"` : '',
          charDetails.length > 0 ? `角色: ${charDetails.join(', ')}` : '',
          sceneDetail ? `场景: ${sceneDetail}` : '',
          propObjs.length > 0 ? `道具: ${propObjs.join(', ')}` : '',
          editingStoryboard.camera_angle ? `镜头角度: ${editingStoryboard.camera_angle}` : '',
        ].filter(Boolean).join('\n');
      }

      const response = await generationApi.generateImagePrompt(projectId, {
        asset_type: 'storyboard',
        description: enhancedDescription,
        shot_type: editingStoryboard.shot_type || '',
        action: editingStoryboard.action || '',
        camera_angle: editingStoryboard.camera_angle || '',
        use_image_edit: useImageEdit,
        asset_id: requestStoryboardId,  // 传入 storyboard ID，后端会自动保存
      });

      const generatedPrompt = response.data?.prompt;
      if (generatedPrompt) {
        // 后端已自动保存，只需更新前端状态
        // 状态隔离：只有弹框仍打开且是同一分镜时，才更新前端状态
        if (editingStoryboardIdRef.current === requestStoryboardId) {
          setGeneratedPrompt(generatedPrompt);
        }
      }
      completeTask(requestStoryboardId, 'prompt');
    } catch (error: any) {
      // 状态隔离：错误提示只在同一分镜时显示
      if (editingStoryboardIdRef.current === requestStoryboardId) {
        toast(`生成提示词失败: ${error.response?.data?.detail || error.message}`, 'error');
      }
      failTask(requestStoryboardId, 'prompt', error.message || '未知错误');
    }
  }, [projectId, toast, startTask, completeTask, failTask]);

  /**
   * 从编辑对话框生成图片
   */
  const handleGenerateImageFromEdit = useCallback(async (
    editingStoryboard: any,
    generatedPrompt: string,
    selectedCharacters: string[],
    selectedScenes: string[],
    selectedProps: string[],
    characters: any[],
    scenes: any[],
    props: any[],
    setStoryboardImages: (images: any[]) => void
  ) => {
    if (!editingStoryboard || !generatedPrompt) {
      toast('请先生成提示词', 'error');
      return;
    }

    // 状态隔离：记录发起请求时的分镜ID
    const requestStoryboardId = editingStoryboard.asset_id;

    startTask(editingStoryboard.asset_id, 'image');
    try {
      // 判断是否选择了资产
      const hasAssets = selectedCharacters.length > 0 ||
                        selectedProps.length > 0 ||
                        selectedScenes.length > 0;

      if (hasAssets) {
        // 收集所有选中资产的主图ID
        const refImageIds: string[] = [];

        // 获取角色主图
        for (const charId of selectedCharacters) {
          const char = characters.find(c => c.asset_id === charId);
          if (char?.image_id) {
            refImageIds.push(char.image_id);
          }
        }

        // 获取场景主图（多场景）
        for (const sceneId of selectedScenes) {
          const scene = scenes.find(s => s.asset_id === sceneId);
          if (scene?.image_id) {
            refImageIds.push(scene.image_id);
          }
        }

        // 获取道具主图
        for (const propId of selectedProps) {
          const prop = props.find(p => p.asset_id === propId);
          if (prop?.image_id) {
            refImageIds.push(prop.image_id);
          }
        }

        // 调用图像编辑接口（图生图）
        // 不传递 size 参数，使用后端配置的比例格式（如 16x9）
        await generationApi.editImage(projectId, {
          assetId: editingStoryboard.asset_id,
          assetType: 'storyboard',
          prompt: generatedPrompt,
          referenceImageIds: refImageIds
        });
      } else {
        // 没有选择资产，使用文生图
        await generationApi.generateImage(projectId, {
          asset_id: editingStoryboard.asset_id,
          asset_type: 'storyboard',
          prompt: generatedPrompt,
          negative_prompt: '',
          width: 1920,
          height: 1080,
        });
      }

      toast('图片生成成功', 'success');
      // 始终刷新分镜列表（更新卡片显示）
      await loadStoryboards();
      completeTask(requestStoryboardId, 'image');

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
      const errorMsg = error.response?.data?.detail
        ? (typeof error.response.data.detail === 'string'
            ? error.response.data.detail
            : JSON.stringify(error.response.data.detail))
        : error.message || '生成失败';
      // 状态隔离：错误提示只在同一分镜时显示
      if (editingStoryboardIdRef.current === requestStoryboardId) {
        toast(`生成失败: ${errorMsg}`, 'error');
      }
      failTask(requestStoryboardId, 'image', errorMsg);
    }
  }, [projectId, toast, startTask, completeTask, failTask, loadStoryboards]);

  /**
   * 自动匹配资产
   */
  const handleAutoMatchAssets = useCallback(async (
    editingStoryboard: any,
    setSelectedScenes: (v: string[]) => void,
    setSelectedCharacters: (v: string[]) => void,
    setSelectedProps: (v: string[]) => void
  ) => {
    if (!editingStoryboard) return;

    const requestStoryboardId = editingStoryboard.asset_id;
    startTask(requestStoryboardId, 'auto_match');
    try {
      const response = await storyboardApi.autoMatchAssets(projectId, requestStoryboardId);
      const matched = response.data;

      if (editingStoryboardIdRef.current === requestStoryboardId) {
        const matchedScenes = matched.scene_ids?.length
          ? matched.scene_ids
          : (matched.scene_id ? [matched.scene_id] : []);
        setSelectedScenes(matchedScenes);
        setSelectedCharacters(matched.character_ids || []);
        setSelectedProps(matched.prop_ids || []);
        if (matched.explanation) {
          toast(`已自动匹配资产：${matched.explanation}`, 'success');
        } else {
          toast('已自动匹配资产', 'success');
        }
      }
      completeTask(requestStoryboardId, 'auto_match');
    } catch (error: any) {
      if (editingStoryboardIdRef.current === requestStoryboardId) {
        toast(error.response?.data?.detail || '自动匹配失败', 'error');
      }
      failTask(requestStoryboardId, 'auto_match', error.message || '未知错误');
    }
  }, [projectId, toast, startTask, completeTask, failTask]);

  /**
   * 生成九宫格提示词
   */
  const handleGenerateNineGridPrompts = useCallback(async (
    editingStoryboard: any,
    setGeneratedPrompt: (prompt: string) => void,
    setVideoPrompt?: (prompt: string) => void
  ) => {
    if (!editingStoryboard) return;

    const requestStoryboardId = editingStoryboard.asset_id;
    startTask(requestStoryboardId, 'nine_grid');
    try {
      const response = await storyboardApi.generateNineGridPrompts(projectId, requestStoryboardId);
      if (editingStoryboardIdRef.current === requestStoryboardId) {
        setGeneratedPrompt(response.data.image_prompt || '');
        setVideoPrompt?.(response.data.video_prompt || '');
        toast('九宫格提示词生成成功', 'success');
      }
      completeTask(requestStoryboardId, 'nine_grid');
    } catch (error: any) {
      if (editingStoryboardIdRef.current === requestStoryboardId) {
        toast('生成失败: ' + (error.response?.data?.detail || error.message), 'error');
      }
      failTask(requestStoryboardId, 'nine_grid', error.message || '未知错误');
    }
  }, [projectId, toast, startTask, completeTask, failTask]);

  return {
    setEditingStoryboardId,
    handleEditImage,
    handleSetPrimaryStoryboardImage,
    handleGeneratePrompt,
    handleGenerateImageFromEdit,
    handleAutoMatchAssets,
    handleGenerateNineGridPrompts,
  };
};
