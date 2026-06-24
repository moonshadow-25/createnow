import { useState, useRef, useCallback } from 'react';
import { assetApi, generationApi, storyboardApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import { useStoryboardGenerationStore } from '@/store/storyboardGenerationStore';

interface UseVideoGenerationOptions {
  projectId: string;
  episodeId: string;
  onSuccess: () => void;
  characters?: any[];
  scenes?: any[];
  props?: any[];
  selectedStoryboardReferenceImageIds?: string[];
  multimodalReference?: boolean;
}

export const useVideoGeneration = ({ projectId, episodeId, onSuccess, characters, scenes, props, selectedStoryboardReferenceImageIds, multimodalReference }: UseVideoGenerationOptions) => {
  const { toast } = useToast();
  const { startTask, completeTask, failTask, hasRunningTask, getTaskStatus } = useStoryboardGenerationStore();

  const [videoPrompt, setVideoPromptState] = useState('');
  const [primaryImage, setPrimaryImage] = useState<any>(null);
  const [storyboardImages, setStoryboardImages] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [loadingImage, setLoadingImage] = useState(false);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showImageGallery, setShowImageGallery] = useState(false);
  const [showVideoGallery, setShowVideoGallery] = useState(false);
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(new Set());

  const editingStoryboardIdRef = useRef<string | null>(null);

  const loadPrimaryImage = useCallback(async (storyboard: any) => {
    setLoadingImage(true);
    try {
      const response = await generationApi.listImages(projectId, storyboard.asset_id);
      const images = response.data || [];
      setStoryboardImages(images);
      if (images.length > 0) {
        const primary = images.find((img: any) => img.is_primary) || images[0];
        setPrimaryImage(primary);
      } else {
        setPrimaryImage(null);
      }
      const storageKey = `hidden_images_${storyboard.asset_id}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try { setHiddenImageIds(new Set(JSON.parse(stored))); } catch { setHiddenImageIds(new Set()); }
      } else {
        setHiddenImageIds(new Set());
      }
    } catch (error) {
      console.error('Failed to load primary image:', error);
    } finally {
      setLoadingImage(false);
    }
  }, [projectId]);

  const loadVideos = useCallback(async (storyboard: any) => {
    setLoadingVideos(true);
    try {
      const response = await generationApi.listVideos(projectId, episodeId);
      const allVideos = response.data || [];
      setVideos(allVideos.filter((v: any) => v.storyboard_id === storyboard.asset_id));
    } catch (error) {
      console.error('Failed to load videos:', error);
    } finally {
      setLoadingVideos(false);
    }
  }, [projectId, episodeId]);

  const initForStoryboard = useCallback((storyboard: any) => {
    editingStoryboardIdRef.current = storyboard.asset_id;
    const vp = storyboard.video_prompt;
    setVideoPromptState(
      Array.isArray(vp) ? JSON.stringify(vp) : (vp || '')
    );
    loadPrimaryImage(storyboard);
    loadVideos(storyboard);
  }, [loadPrimaryImage, loadVideos]);

  const handlePromptChange = useCallback((newPrompt: string) => {
    setVideoPromptState(newPrompt);
  }, []);

  const handleDurationChange = useCallback((newDuration: number, _storyboard: any, setEditDuration: (v: number) => void) => {
    setEditDuration(newDuration);
  }, []);

  const handleGenerateVideoPrompt = useCallback(async (
    storyboard: any,
    editDescription: string,
    editDialogue: string,
    editAction: string,
    editShotType: string,
    editCameraAngle: string,
    editDuration: number,
  ) => {
    const requestId = storyboard.asset_id;
    startTask(requestId, 'video_prompt');
    try {
      const response = await generationApi.generateVideoPromptSubagent(projectId, {
        storyboard_id: storyboard.asset_id,
        description: editDescription,
        dialogue: editDialogue,
        action: editAction,
        shot_type: editShotType,
        camera_angle: editCameraAngle,
        duration: editDuration,
      });
      const newPrompt = response.data.prompt || '';
      // 后端保存：始终执行，与弹框状态无关
      await assetApi.update(projectId, 'storyboard', storyboard.asset_id, { video_prompt: newPrompt });
      onSuccess();
      // UI 更新：只在弹框仍显示同一分镜时执行
      if (editingStoryboardIdRef.current === requestId) {
        setVideoPromptState(newPrompt);
        toast('视频提示词已生成并保存', 'success');
      }
      completeTask(requestId, 'video_prompt');
    } catch (error: any) {
      if (editingStoryboardIdRef.current === requestId) {
        toast(`生成提示词失败: ${error.response?.data?.detail || error.message || '生成失败'}`, 'error');
      }
      failTask(requestId, 'video_prompt', error.message || '未知错误');
    }
  }, [projectId, toast, onSuccess, startTask, completeTask, failTask]);

  // 收集资产图片ID（兼容 scene_ids + 旧 scene_id）
  const collectAssetImageIds = useCallback((storyboard: any): string[] => {
    const ids: string[] = [];
    for (const charId of storyboard.character_ids || []) {
      const char = characters?.find((c: any) => c.asset_id === charId);
      if (char?.image_id) ids.push(char.image_id);
    }
    const sceneIds: string[] = storyboard.scene_ids?.length
      ? storyboard.scene_ids
      : (storyboard.scene_id ? [storyboard.scene_id] : []);
    for (const sid of sceneIds) {
      const scene = scenes?.find((s: any) => s.asset_id === sid);
      if (scene?.image_id) ids.push(scene.image_id);
    }
    for (const propId of storyboard.prop_ids || []) {
      const prop = props?.find((p: any) => p.asset_id === propId);
      if (prop?.image_id) ids.push(prop.image_id);
    }
    return ids;
  }, [characters, scenes, props]);

  const collectSelectedReferenceImageIds = useCallback((storyboard: any): string[] => {
    const assetImageIds = collectAssetImageIds(storyboard);
    const selectedStoryboardIds = selectedStoryboardReferenceImageIds || [];
    return Array.from(new Set([
      ...assetImageIds,
      ...selectedStoryboardIds,
    ].filter(Boolean)));
  }, [collectAssetImageIds, selectedStoryboardReferenceImageIds]);

  const handleGenerateVideo = useCallback(async (storyboard: any, editDuration: number, editRatio: string, editResolution: string, editDescription: string, editDialogue: string, editAction: string, editShotType: string, editCameraAngle: string, modelOverride?: string) => {
    if (!videoPrompt.trim()) { toast('请输入或生成视频提示词', 'error'); return; }

    const allImageIds = collectSelectedReferenceImageIds(storyboard);

    let prompts: string[];
    try {
      const parsed = JSON.parse(videoPrompt);
      prompts = Array.isArray(parsed) && parsed.length > 0 ? parsed : [videoPrompt];
    } catch {
      prompts = [videoPrompt];
    }
    const finalPrompt = prompts.length > 1 ? JSON.stringify(prompts) : prompts[0];
    const isMultiSegment = multimodalReference && prompts.length > 1;

    startTask(storyboard.asset_id, 'video');
    try {
      await assetApi.update(projectId, 'storyboard', storyboard.asset_id, {
        description: editDescription,
        dialogue: editDialogue,
        action: editAction,
        shot_type: editShotType,
        camera_angle: editCameraAngle,
        video_prompt: finalPrompt,
        duration: editDuration,
        resolution: editResolution,
      });
      setVideoPromptState(finalPrompt);
      if (isMultiSegment) {
        for (const segmentPrompt of prompts) {
          await generationApi.generateVideoMultimodal(projectId, {
            storyboard_id: storyboard.asset_id,
            episode_id: episodeId,
            image_ids: allImageIds,
            prompt: segmentPrompt,
            duration: 15,
            resolution: editResolution,
            ratio: editRatio,
            model: modelOverride?.trim() || undefined,
          });
        }
      } else if (multimodalReference) {
        await generationApi.generateVideoMultimodal(projectId, {
          storyboard_id: storyboard.asset_id,
          episode_id: episodeId,
          image_ids: allImageIds.length > 0 ? allImageIds : undefined,
          prompt: finalPrompt,
          duration: editDuration,
          resolution: editResolution,
          model: modelOverride?.trim() || undefined,
        });
      } else if (primaryImage) {
        await generationApi.generateVideo(projectId, {
          storyboard_id: storyboard.asset_id,
          episode_id: episodeId,
          image_id: primaryImage.image_id,
          prompt: finalPrompt,
          duration: editDuration,
          resolution: editResolution,
          model: modelOverride?.trim() || undefined,
        });
      } else {
        // 无主图时允许纯文生或多参考图 multimodal
        await generationApi.generateVideoMultimodal(projectId, {
          storyboard_id: storyboard.asset_id,
          episode_id: episodeId,
          image_ids: allImageIds.length > 0 ? allImageIds : undefined,
          prompt: finalPrompt,
          duration: editDuration,
          resolution: editResolution,
          model: modelOverride?.trim() || undefined,
        });
      }
      const successMsg = isMultiSegment
        ? `已提交 ${prompts.length} 段视频生成任务，请在已生成视频中查看进度`
        : '视频生成任务已提交，请在已生成视频中查看进度';
      toast(successMsg, 'success');
      loadVideos(storyboard);
      onSuccess();
      completeTask(storyboard.asset_id, 'video');
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail
        ? (typeof error.response.data.detail === 'string' ? error.response.data.detail : JSON.stringify(error.response.data.detail))
        : error.message || '生成失败';
      toast(`视频生成失败: ${errorMsg}`, 'error');
      failTask(storyboard.asset_id, 'video', errorMsg);
    }
  }, [projectId, episodeId, videoPrompt, multimodalReference, collectSelectedReferenceImageIds, toast, startTask, completeTask, failTask, loadVideos, onSuccess, primaryImage]);

  const handleGenerateVideoSegment = useCallback(async (storyboard: any, segmentIndex: number, editDuration: number, editRatio: string, editResolution: string, editDescription: string, editDialogue: string, editAction: string, editShotType: string, editCameraAngle: string, modelOverride?: string) => {
    let prompts: string[];
    try {
      const parsed = JSON.parse(videoPrompt);
      prompts = Array.isArray(parsed) && parsed.length > 0 ? parsed : [videoPrompt];
    } catch {
      prompts = [videoPrompt];
    }

    const allImageIds = collectSelectedReferenceImageIds(storyboard);

    const segmentPrompt = prompts[segmentIndex];
    if (!segmentPrompt?.trim()) { toast('该段提示词为空', 'error'); return; }

    const finalPrompt = prompts.length > 1 ? JSON.stringify(prompts) : prompts[0];

    startTask(storyboard.asset_id, 'video');
    try {
      await assetApi.update(projectId, 'storyboard', storyboard.asset_id, {
        description: editDescription,
        dialogue: editDialogue,
        action: editAction,
        shot_type: editShotType,
        camera_angle: editCameraAngle,
        video_prompt: finalPrompt,
        duration: editDuration,
        resolution: editResolution,
      });
      setVideoPromptState(finalPrompt);
      await generationApi.generateVideoMultimodal(projectId, {
        storyboard_id: storyboard.asset_id,
        episode_id: episodeId,
        image_ids: allImageIds.length > 0 ? allImageIds : undefined,
        prompt: segmentPrompt,
        duration: 15,
        ratio: editRatio,
        resolution: editResolution,
        model: modelOverride?.trim() || undefined,
      });
      toast(`第 ${segmentIndex + 1} 段视频任务已提交`, 'success');
      loadVideos(storyboard);
      onSuccess();
      completeTask(storyboard.asset_id, 'video');
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail
        ? (typeof error.response.data.detail === 'string' ? error.response.data.detail : JSON.stringify(error.response.data.detail))
        : error.message || '生成失败';
      toast(`视频生成失败: ${errorMsg}`, 'error');
      failTask(storyboard.asset_id, 'video', errorMsg);
    }
  }, [projectId, episodeId, videoPrompt, collectSelectedReferenceImageIds, toast, startTask, completeTask, failTask, loadVideos, onSuccess]);

  const handleExport = useCallback(async (storyboard: any) => {
    setIsExporting(true);
    try {
      const response = await storyboardApi.export(projectId, storyboard.asset_id);
      const data = response.data;
      if (data.video_prompt && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(data.video_prompt);
          toast(`导出成功！视频提示词已复制到剪贴板\n导出路径：${data.export_path}`, 'success');
        } catch {
          toast(`导出成功！\n导出路径：${data.export_path}\n（剪贴板复制失败，请手动复制）`, 'success');
        }
      } else {
        toast(`导出成功！\n导出路径：${data.export_path}`, 'success');
      }
    } catch (error: any) {
      toast(`导出失败: ${error.response?.data?.detail || error.message || '导出失败'}`, 'error');
    } finally {
      setIsExporting(false);
    }
  }, [projectId, toast]);

  const handleDownload = useCallback(async (storyboard: any) => {
    setIsDownloading(true);
    try {
      const response = await storyboardApi.download(projectId, storyboard.asset_id);

      // 从响应头获取文件名
      const contentDisposition = response.headers['content-disposition'];
      let filename = `分镜${storyboard.sequence}.zip`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
          // 解码 URL 编码的文件名
          filename = decodeURIComponent(filename);
        }
      }

      // 创建下载链接
      const blob = new Blob([response.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast('资源包下载成功！', 'success');
    } catch (error: any) {
      toast(`下载失败: ${error.response?.data?.detail || error.message || '下载失败'}`, 'error');
    } finally {
      setIsDownloading(false);
    }
  }, [projectId, toast]);

  const handleSetPrimaryImage = useCallback(async (storyboard: any, imageId: string) => {
    try {
      await generationApi.setPrimaryImage(projectId, storyboard.asset_id, imageId);
      await loadPrimaryImage(storyboard);
      onSuccess();
    } catch (error) {
      console.error('Failed to set primary image:', error);
    }
  }, [projectId, loadPrimaryImage, onSuccess]);

  let videoSegmentCount = 1;
  try {
    const parsed = JSON.parse(videoPrompt);
    if (Array.isArray(parsed) && parsed.length > 1) videoSegmentCount = parsed.length;
  } catch {}

  return {
    videoPrompt,
    videoSegmentCount,
    primaryImage,
    storyboardImages,
    videos,
    loadingImage,
    loadingVideos,
    isExporting,
    isDownloading,
    showImageGallery,
    setShowImageGallery,
    showVideoGallery,
    setShowVideoGallery,
    hiddenImageIds,
    hasRunningTask,
    getTaskStatus,
    initForStoryboard,
    loadPrimaryImage,
    loadVideos,
    handlePromptChange,
    handleDurationChange,
    handleGenerateVideoPrompt,
    handleGenerateVideo,
    handleGenerateVideoSegment,
    handleExport,
    handleDownload,
    handleSetPrimaryImage,
  };
};
