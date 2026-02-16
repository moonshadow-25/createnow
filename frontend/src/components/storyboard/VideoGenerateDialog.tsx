import { useState, useEffect, useRef } from 'react';
import { X, ChevronDown, ChevronRight, Wand2, Film, Loader2, Images, Video, Play, Eye, Download } from 'lucide-react';
import { assetApi, generationApi, storyboardApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import { ImageGallery } from '@/components/assets/ImageGallery';
import { VideoGallery } from './VideoGallery';
import { useStoryboardGenerationStore } from '@/store/storyboardGenerationStore';
import { getImageUrl, getVideoUrl } from './utils/mediaUtils';
import { useStoryboardContentEdit } from './hooks/useStoryboardContentEdit';

interface VideoGenerateDialogProps {
  projectId: string;
  storyboard: any;
  episodeId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function VideoGenerateDialog({
  projectId,
  storyboard,
  episodeId,
  onClose,
  onSuccess
}: VideoGenerateDialogProps) {
  const { toast } = useToast();

  // 使用全局任务管理 store
  const { startTask, completeTask, failTask, hasRunningTask } = useStoryboardGenerationStore();

  // 分镜内容编辑状态（使用 hook）
  const contentEdit = useStoryboardContentEdit();
  const {
    contentExpanded,
    setContentExpanded,
    editDescription,
    setEditDescription,
    editDialogue,
    setEditDialogue,
    editAction,
    setEditAction,
    editShotType,
    setEditShotType,
    editCameraAngle,
    setEditCameraAngle,
    resetEditState
  } = contentEdit;

  // 视频参数状态
  const [duration, setDuration] = useState(6);
  const [resolution, setResolution] = useState('1920x1080');
  const [videoPrompt, setVideoPrompt] = useState('');

  // 生成状态
  const isGenerating = hasRunningTask(storyboard.asset_id);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

  // 主图信息
  const [primaryImage, setPrimaryImage] = useState<any>(null);
  const [storyboardImages, setStoryboardImages] = useState<any[]>([]);
  const [loadingImage, setLoadingImage] = useState(true);

  // 已生成视频
  const [videos, setVideos] = useState<any[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);

  // 弹框状态
  const [showImageGallery, setShowImageGallery] = useState(false);
  const [showVideoGallery, setShowVideoGallery] = useState(false);
  // 隐藏图片状态
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(new Set());

  // 防抖保存定时器
  const promptSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初始化加载分镜数据和主图
  useEffect(() => {
    if (storyboard) {
      // 初始化分镜内容编辑字段
      resetEditState(storyboard); // 使用 hook 的重置函数
      // 加载已保存的视频提示词和时长
      setVideoPrompt(storyboard.video_prompt || '');
      setDuration(storyboard.duration || 6);

      // 加载主图和视频
      loadPrimaryImage();
      loadVideos();
    }
  }, [storyboard]);

  // 加载分镜主图
  const loadPrimaryImage = async () => {
    setLoadingImage(true);
    try {
      const response = await generationApi.listImages(projectId, storyboard.asset_id);
      const images = response.data || [];
      setStoryboardImages(images);
      if (images.length > 0) {
        const primary = images.find((img: any) => img.is_primary) || images[0];
        setPrimaryImage(primary);
      }

      // 读取隐藏图片状态
      const storageKey = `hidden_images_${storyboard.asset_id}`;
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const hiddenIds = JSON.parse(stored);
          setHiddenImageIds(new Set(hiddenIds));
        } catch (e) {
          console.error('Failed to parse hidden images:', e);
        }
      } else {
        setHiddenImageIds(new Set());
      }
    } catch (error) {
      console.error('Failed to load primary image:', error);
    } finally {
      setLoadingImage(false);
    }
  };

  // 加载已生成视频
  const loadVideos = async () => {
    setLoadingVideos(true);
    try {
      const response = await generationApi.listVideos(projectId, episodeId);
      const allVideos = response.data || [];
      // 过滤当前分镜的视频
      const storyboardVideos = allVideos.filter((v: any) => v.storyboard_id === storyboard.asset_id);
      setVideos(storyboardVideos);
    } catch (error) {
      console.error('Failed to load videos:', error);
    } finally {
      setLoadingVideos(false);
    }
  };

  // 保存视频提示词到分镜
  const saveVideoPrompt = async (prompt: string, showToast: boolean = false) => {
    try {
      await assetApi.update(projectId, 'storyboard', storyboard.asset_id, {
        video_prompt: prompt,
      });
      if (showToast) {
        toast('提示词已保存', 'success');
      }
      // 通知父组件刷新数据
      onSuccess();
    } catch (error) {
      console.error('Failed to save video prompt:', error);
      toast('保存提示词失败', 'error');
    }
  };

  // 保存分镜内容和参数（防抖）
  const saveStoryboardContent = async (updates: any) => {
    try {
      await assetApi.update(projectId, 'storyboard', storyboard.asset_id, updates);
      // 通知父组件刷新数据
      onSuccess();
    } catch (error) {
      console.error('Failed to save storyboard content:', error);
    }
  };

  // 防抖保存分镜内容
  const debounceSaveContent = (updates: any) => {
    if (contentSaveTimeoutRef.current) {
      clearTimeout(contentSaveTimeoutRef.current);
    }
    contentSaveTimeoutRef.current = setTimeout(() => {
      saveStoryboardContent(updates);
    }, 1000);
  };

  // 防抖保存时长
  const handleDurationChange = (newDuration: number) => {
    setDuration(newDuration);
    if (durationSaveTimeoutRef.current) {
      clearTimeout(durationSaveTimeoutRef.current);
    }
    durationSaveTimeoutRef.current = setTimeout(() => {
      saveStoryboardContent({ duration: newDuration });
    }, 1000);
  };

  // AI生成视频提示词
  const handleGeneratePrompt = async () => {
    setIsGeneratingPrompt(true);
    try {
      const response = await generationApi.generateVideoPrompt(projectId, {
        storyboard_id: storyboard.asset_id,
        description: editDescription,
        dialogue: editDialogue,
        action: editAction,
        shot_type: editShotType,
        camera_angle: editCameraAngle,
        characters: storyboard.character_ids || [],
        scene: storyboard.scene_id || '',
        props: storyboard.prop_ids || [],
        duration: duration,
      });
      const newPrompt = response.data.prompt || '';
      setVideoPrompt(newPrompt);
      // 自动保存提示词
      await saveVideoPrompt(newPrompt);
      toast('视频提示词已生成并保存', 'success');
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '生成失败';
      toast(`生成提示词失败: ${errorMsg}`, 'error');
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  // AI反推视频提示词（使用VLM分析图片）
  const [isReversingPrompt, setIsReversingPrompt] = useState(false);

  const handleReversePrompt = async () => {
    if (!primaryImage) {
      toast('请先生成分镜图', 'error');
      return;
    }

    setIsReversingPrompt(true);
    try {
      // 获取图片的base64编码
      const imageUrl = getImageUrl(primaryImage, projectId);
      let imageBase64 = '';

      // 如果是本地路径，需要先获取图片并转为base64
      if (imageUrl.startsWith('/api/')) {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        imageBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } else if (imageUrl.startsWith('data:')) {
        imageBase64 = imageUrl;
      } else {
        // 外部URL，尝试通过fetch获取
        try {
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          imageBase64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch {
          toast('无法获取图片，请检查图片URL', 'error');
          setIsReversingPrompt(false);
          return;
        }
      }

      const response = await generationApi.generateVideoReversePrompt(projectId, {
        storyboard_id: storyboard.asset_id,
        image_base64: imageBase64,
        description: editDescription,
        dialogue: editDialogue,
        action: editAction,
        shot_type: editShotType,
        camera_angle: editCameraAngle,
        characters: storyboard.character_ids || [],
        scene: storyboard.scene_id || '',
        props: storyboard.prop_ids || [],
        duration: duration,
      });
      const newPrompt = response.data.prompt || '';
      setVideoPrompt(newPrompt);
      // 自动保存提示词
      await saveVideoPrompt(newPrompt);
      toast('视频提示词已反推并保存', 'success');
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '反推失败';
      toast(`反推提示词失败: ${errorMsg}`, 'error');
    } finally {
      setIsReversingPrompt(false);
    }
  };

  // 生成视频
  const handleGenerateVideo = async () => {
    if (!primaryImage) {
      toast('请先生成分镜图', 'error');
      return;
    }

    if (!videoPrompt.trim()) {
      toast('请输入或生成视频提示词', 'error');
      return;
    }

    // 使用全局任务管理 store
    startTask(storyboard.asset_id, 'video');

    try {
      // 1. 先保存分镜内容修改（包括视频提示词和时长）
      await assetApi.update(projectId, 'storyboard', storyboard.asset_id, {
        description: editDescription,
        dialogue: editDialogue,
        action: editAction,
        shot_type: editShotType,
        camera_angle: editCameraAngle,
        video_prompt: videoPrompt,
        duration: duration,
      });

      // 2. 调用视频生成API
      await generationApi.generateVideo(projectId, {
        storyboard_id: storyboard.asset_id,
        episode_id: episodeId,
        image_id: primaryImage.image_id,
        prompt: videoPrompt,
        duration: duration,
        resolution: resolution,
      });

      toast('视频生成任务已提交，请在已生成视频中查看进度', 'success');
      // 刷新视频列表
      loadVideos();
      onSuccess();
      completeTask(storyboard.asset_id, 'video');
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail
        ? (typeof error.response.data.detail === 'string'
            ? error.response.data.detail
            : JSON.stringify(error.response.data.detail))
        : error.message || '生成失败';
      toast(`视频生成失败: ${errorMsg}`, 'error');
      failTask(storyboard.asset_id, 'video', errorMsg);
    }
  };

  // 手动编辑提示词时自动保存（防抖）
  const handlePromptChange = (newPrompt: string) => {
    setVideoPrompt(newPrompt);
    // 使用防抖保存
    if (promptSaveTimeoutRef.current) {
      clearTimeout(promptSaveTimeoutRef.current);
    }
    promptSaveTimeoutRef.current = setTimeout(() => {
      saveVideoPrompt(newPrompt);
    }, 1000);
  };

  // 导出分镜
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await storyboardApi.export(projectId, storyboard.asset_id);
      const data = response.data;

      // 复制视频提示词到剪贴板
      if (data.video_prompt && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(data.video_prompt);
          toast(`导出成功！视频提示词已复制到剪贴板\n导出路径：${data.export_path}`, 'success');
        } catch (err) {
          toast(`导出成功！\n导出路径：${data.export_path}\n（剪贴板复制失败，请手动复制）`, 'success');
        }
      } else {
        toast(`导出成功！\n导出路径：${data.export_path}`, 'success');
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail || error.message || '导出失败';
      toast(`导出失败: ${errorMsg}`, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  // 清理定时器
  useEffect(() => {
    return () => {
      if (promptSaveTimeoutRef.current) {
        clearTimeout(promptSaveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
          {/* 标题栏 */}
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">
              生成视频 - 第{storyboard.sequence}镜
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              <X size={20} />
            </button>
          </div>

          <div className="space-y-4">
            {/* 分镜内容编辑 - 可收起/展开 */}
            <div className="bg-gray-700 rounded overflow-hidden">
              <button
                onClick={() => setContentExpanded(!contentExpanded)}
                className="w-full flex items-center justify-between p-3 hover:bg-gray-600 transition text-left"
              >
                <div className="flex items-center gap-2">
                  {contentExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <h3 className="text-sm font-semibold text-gray-300">分镜内容</h3>
                </div>
                <span className="text-xs text-gray-500">
                  {contentExpanded ? '收起' : '展开编辑'}
                </span>
              </button>

              {contentExpanded && (
                <div className="p-4 pt-0 space-y-3">
                  {/* 画面描述 */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">画面描述 *</label>
                    <textarea
                      value={editDescription}
                      onChange={(e) => {
                        setEditDescription(e.target.value);
                        debounceSaveContent({ description: e.target.value });
                      }}
                      className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      rows={3}
                      placeholder="描述画面内容..."
                    />
                  </div>

                  {/* 对白 */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">对白</label>
                    <input
                      type="text"
                      value={editDialogue}
                      onChange={(e) => {
                        setEditDialogue(e.target.value);
                        debounceSaveContent({ dialogue: e.target.value });
                      }}
                      className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      placeholder="角色对白（如有）"
                    />
                  </div>

                  {/* 动作 */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">动作</label>
                    <textarea
                      value={editAction}
                      onChange={(e) => {
                        setEditAction(e.target.value);
                        debounceSaveContent({ action: e.target.value });
                      }}
                      className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      rows={2}
                      placeholder="描述动作..."
                    />
                  </div>

                  {/* 镜头设置 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">景别</label>
                      <select
                        value={editShotType}
                        onChange={(e) => {
                          setEditShotType(e.target.value);
                          debounceSaveContent({ shot_type: e.target.value });
                        }}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="特写">特写</option>
                        <option value="近景">近景</option>
                        <option value="中景">中景</option>
                        <option value="全景">全景</option>
                        <option value="远景">远景</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">角度</label>
                      <select
                        value={editCameraAngle}
                        onChange={(e) => {
                          setEditCameraAngle(e.target.value);
                          debounceSaveContent({ camera_angle: e.target.value });
                        }}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="平视">平视</option>
                        <option value="仰视">仰视</option>
                        <option value="俯视">俯视</option>
                        <option value="鸟瞰">鸟瞰</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 参考图片 - 小图预览 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-400">
                  参考图片 {(() => {
                    const visibleCount = storyboardImages.filter(img => !hiddenImageIds.has(img.image_id)).length;
                    return visibleCount > 0 ? `(${visibleCount})` : '';
                  })()}
                </label>
              </div>
              <div
                onClick={() => {
                  const visibleCount = storyboardImages.filter(img => !hiddenImageIds.has(img.image_id)).length;
                  if (visibleCount > 0) setShowImageGallery(true);
                }}
                className={`flex items-center gap-2 ${storyboardImages.filter(img => !hiddenImageIds.has(img.image_id)).length > 0 ? 'cursor-pointer' : ''}`}
              >
                {loadingImage ? (
                  <div className="w-16 h-16 bg-gray-700 rounded-lg flex items-center justify-center">
                    <Loader2 className="animate-spin text-gray-500" size={20} />
                  </div>
                ) : (() => {
                  // 过滤隐藏的图片并排序（主图在前）
                  const visibleStoryboardImages = storyboardImages
                    .filter(img => !hiddenImageIds.has(img.image_id))
                    .sort((a, b) => {
                      if (a.is_primary && !b.is_primary) return -1;
                      if (!a.is_primary && b.is_primary) return 1;
                      return 0;
                    });

                  if (visibleStoryboardImages.length === 0) {
                    return (
                      <div className="flex items-center gap-2 text-gray-500 text-sm">
                        <Film size={20} className="opacity-50" />
                        <span>暂无图片，请先生成分镜图</span>
                      </div>
                    );
                  }

                  return (
                    <>
                      {/* 显示最多3张小图 */}
                      {visibleStoryboardImages.slice(0, 3).map((img) => (
                        <div key={img.image_id} className="relative group">
                          <img
                            src={getImageUrl(img, projectId).replace('/images/files/', '/thumbnails/')}
                            alt="分镜图片"
                            className="w-16 h-16 object-cover rounded-lg border-2 border-transparent hover:border-blue-500 transition"
                            loading="lazy"
                          />
                          {img.is_primary && (
                            <div className="absolute top-0 right-0 bg-blue-600 text-xs px-1 rounded-bl rounded-tr-lg">
                              主
                            </div>
                          )}
                        </div>
                      ))}
                      {/* 更多图片计数器 */}
                      {visibleStoryboardImages.length > 3 && (
                        <div className="w-16 h-16 bg-gray-600 rounded-lg flex items-center justify-center text-gray-300 font-semibold border-2 border-transparent hover:border-blue-500 transition">
                          +{visibleStoryboardImages.length - 3}
                        </div>
                      )}
                      {/* 管理按钮 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowImageGallery(true);
                        }}
                        className="flex items-center gap-1 text-green-400 hover:text-green-300 text-sm ml-auto"
                      >
                        <Images size={14} />
                        管理
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* 视频参数设置 */}
            <div>
              <label className="block text-sm font-semibold text-gray-400 mb-2">视频参数</label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">时长（秒）</label>
                  <input
                    type="number"
                    value={duration}
                    onChange={(e) => handleDurationChange(Math.max(1, parseInt(e.target.value) || 6))}
                    min={1}
                    max={60}
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">分辨率</label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="1920x1080">1920x1080 (横屏)</option>
                    <option value="1280x720">1280x720 (横屏)</option>
                    <option value="1080x1920">1080x1920 (竖屏)</option>
                    <option value="720x1280">720x1280 (竖屏)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 视频提示词 - 扩大输入框 */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-semibold text-gray-400">视频提示词</label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleGeneratePrompt}
                    disabled={isGeneratingPrompt || isReversingPrompt || !editDescription}
                    className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 disabled:text-gray-600"
                  >
                    {isGeneratingPrompt ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Wand2 size={12} />
                    )}
                    {isGeneratingPrompt ? '生成中...' : 'AI生成提示词'}
                  </button>
                  <button
                    onClick={handleReversePrompt}
                    disabled={isReversingPrompt || isGeneratingPrompt || !primaryImage}
                    className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 disabled:text-gray-600"
                    title={!primaryImage ? '需要先生成分镜图' : '根据分镜图反推提示词'}
                  >
                    {isReversingPrompt ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Eye size={12} />
                    )}
                    {isReversingPrompt ? '反推中...' : 'AI反推提示词'}
                  </button>
                </div>
              </div>
              <textarea
                value={videoPrompt}
                onChange={(e) => handlePromptChange(e.target.value)}
                className="w-full h-48 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                placeholder="输入视频生成提示词，或点击右上角按钮AI生成..."
              />
            </div>

            {/* 已生成视频 - 小预览区 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-400">
                  已生成视频 {videos.length > 0 && `(${videos.length})`}
                </label>
              </div>
              <div
                onClick={() => videos.length > 0 && setShowVideoGallery(true)}
                className={`flex items-center gap-2 ${videos.length > 0 ? 'cursor-pointer' : ''}`}
              >
                {loadingVideos ? (
                  <div className="w-20 h-12 bg-gray-700 rounded-lg flex items-center justify-center">
                    <Loader2 className="animate-spin text-gray-500" size={16} />
                  </div>
                ) : videos.length > 0 ? (
                  <>
                    {/* 显示最多3个小视频预览 */}
                    {videos.slice(0, 3).map((video) => (
                      <div key={video.video_id} className="relative group">
                        <div className="w-20 h-12 bg-gray-700 rounded-lg border-2 border-transparent hover:border-blue-500 transition flex items-center justify-center overflow-hidden">
                          {video.status === 'completed' && video.video_path ? (
                            <video
                              src={getVideoUrl(video, projectId)}
                              className="w-full h-full object-cover"
                              muted
                              poster={primaryImage ? getImageUrl(primaryImage, projectId).replace('/images/files/', '/thumbnails/') : undefined}
                              preload="none"
                            />
                          ) : video.status === 'failed' ? (
                            <div className="text-red-400 text-xs">失败</div>
                          ) : (
                            <Loader2 size={16} className="animate-spin text-yellow-400" />
                          )}
                        </div>
                        {/* 主视频标记 */}
                        {video.is_primary && (
                          <div className="absolute top-0 right-0 bg-blue-600 text-xs px-1 rounded-bl rounded-tr-lg">
                            主
                          </div>
                        )}
                        {/* 状态标记 */}
                        {video.status === 'completed' && (
                          <div className="absolute bottom-0 left-0 right-0 bg-green-600 bg-opacity-80 text-xs text-center">
                            <Play size={10} className="inline" />
                          </div>
                        )}
                      </div>
                    ))}
                    {/* 更多视频计数器 */}
                    {videos.length > 3 && (
                      <div className="w-20 h-12 bg-gray-600 rounded-lg flex items-center justify-center text-gray-300 font-semibold border-2 border-transparent hover:border-blue-500 transition">
                        +{videos.length - 3}
                      </div>
                    )}
                    {/* 管理按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowVideoGallery(true);
                      }}
                      className="flex items-center gap-1 text-green-400 hover:text-green-300 text-sm ml-auto"
                    >
                      <Video size={14} />
                      管理
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                    <Video size={20} className="opacity-50" />
                    <span>暂无视频，点击下方按钮生成</span>
                  </div>
                )}
              </div>
            </div>

            {/* 生成状态提示 */}
            {isGenerating && (
              <div className="bg-blue-900 bg-opacity-30 border border-blue-700 rounded p-3">
                <div className="flex items-center gap-2 text-blue-300">
                  <Loader2 className="animate-spin" size={16} />
                  <span className="text-sm">视频生成中，请耐心等待...（每30秒查询一次状态）</span>
                </div>
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="flex justify-between items-center gap-3 mt-6">
            {/* 左侧：导出按钮 */}
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center gap-2"
              title="导出分镜主图、资产主图和视频提示词到桌面"
            >
              {isExporting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <Download size={16} />
                  导出
                </>
              )}
            </button>

            {/* 右侧：取消和生成视频按钮 */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
              >
                取消
              </button>
              <button
                onClick={handleGenerateVideo}
                disabled={isGenerating || !primaryImage || !videoPrompt.trim()}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Film size={16} />
                    生成视频
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 图片库弹框 */}
      {showImageGallery && (
        <ImageGallery
          images={storyboardImages}
          projectId={projectId}
          assetId={storyboard.asset_id}
          assetName={`分镜 ${storyboard.sequence}`}
          assetType="storyboard"
          onClose={() => setShowImageGallery(false)}
          onSelectPrimary={async (imageId) => {
            try {
              await generationApi.setPrimaryImage(projectId, storyboard.asset_id, imageId);
              await loadPrimaryImage();
              onSuccess();
            } catch (error) {
              console.error('Failed to set primary image:', error);
            }
          }}
          onImagesUpdated={async () => {
            // 重新加载图片列表
            await loadPrimaryImage();
          }}
        />
      )}

      {/* 视频库弹框 */}
      {showVideoGallery && (
        <VideoGallery
          projectId={projectId}
          storyboardId={storyboard.asset_id}
          episodeId={episodeId}
          onClose={() => {
            setShowVideoGallery(false);
            loadVideos(); // 关闭时刷新视频列表
          }}
        />
      )}
    </>
  );
}
