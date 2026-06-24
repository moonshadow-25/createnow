import { useState, useEffect } from 'react';
import { X, Check, ImagePlus, Loader2 } from 'lucide-react';
import { generationApi } from '@/services/api';
import { useCreatenowModelConfigStore, IMAGE_SIZE_OPTIONS } from '@/store/createnowModelConfigStore';
import { useStoryboardGenerationStore } from '@/store/storyboardGenerationStore';
import { useToast } from './Toast';

interface ImageEditDialogProps {
  projectId: string;
  assetId: string;
  assetType: string;
  assetName: string;
  images: any[]; // 当前资产的图片列表
  onCompleted: () => void; // 编辑完成后的回调
  onClose: () => void;
}

export function ImageEditDialog({
  projectId,
  assetId,
  assetType,
  assetName,
  images,
  onCompleted,
  onClose
}: ImageEditDialogProps) {
  const { toast } = useToast();
  const { startTask, completeTask, failTask, getTaskStatus } = useStoryboardGenerationStore();

  // 从 localStorage 读取隐藏图片状态
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const storageKey = `hidden_images_${assetId}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const hiddenIds = JSON.parse(stored);
        setHiddenImageIds(new Set(hiddenIds));
      } catch (e) {
        console.error('Failed to parse hidden images:', e);
      }
    }
  }, [assetId]);

  // 过滤非隐藏图片
  const visibleImages = images.filter(img => !hiddenImageIds.has(img.image_id));

  // 获取图片URL，优先使用本地路径
  const getImageUrl = (image: any) => {
    if (image.local_path) {
      return `/api/projects/${projectId}/images/files/${image.local_path}`;
    }
    return image.image_path;
  };

  // 选中的图片ID
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  // 提示词
  const [prompt, setPrompt] = useState('');
  const [selectedSize, setSelectedSize] = useState('16x9');
  const [selectedModel, setSelectedModel] = useState('');

  const modelConfig = useCreatenowModelConfigStore(state => state.config);
  const imageSuggestions = modelConfig.suggestions.image || [];
  const totalReferences = selectedImageIds.length;

  const isGenerating = getTaskStatus(assetId, 'image_edit') === 'generating';

  useEffect(() => {
    setSelectedModel(modelConfig.default_models.image || 'nova-max');
  }, [modelConfig.default_models.image]);

  // 切换图片选中状态
  const toggleImageSelection = (imageId: string) => {
    setSelectedImageIds(prev => {
      const isSelected = prev.includes(imageId);
      let newSelected: string[];

      if (isSelected) {
        newSelected = prev.filter(id => id !== imageId);
      } else {
        // 检查是否超过限制
        if (prev.length + 1 > 4) {
          toast('最多选择4张参考图片', 'error');
          return prev;
        }
        newSelected = [...prev, imageId];
      }

      return newSelected;
    });
  };

  // 开始编辑
  const handleStartEdit = async () => {
    const total = selectedImageIds.length;

    if (total === 0) {
      toast('请至少选择一张参考图片', 'error');
      return;
    }

    if (!prompt.trim()) {
      toast('请输入编辑提示词', 'error');
      return;
    }

    if (total > 4) {
      toast(`参考图片过多（${total}张），最多支持4张`, 'error');
      return;
    }

    startTask(assetId, 'image_edit');
    try {
      await generationApi.editImage(projectId, {
        assetId,
        assetType,
        prompt: prompt.trim(),
        referenceImageIds: selectedImageIds,
        referenceImageUrls: [],
        size: selectedSize,
        model: selectedModel.trim() || undefined
      });

      toast('图片编辑成功', 'success');
      completeTask(assetId, 'image_edit');

      // 先清空输入
      setSelectedImageIds([]);
      setPrompt('');

      // 等待回调完成后关闭弹框
      await onCompleted();
      onClose();
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail
        ? (typeof error.response.data.detail === 'string'
            ? error.response.data.detail
            : JSON.stringify(error.response.data.detail))
        : error.message || '编辑失败';
      toast(`编辑失败: ${errorMsg}`, 'error');
      failTask(assetId, 'image_edit', errorMsg);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* 标题栏 */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">编辑图片 - {assetName}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>

        <div className="space-y-6">
          {/* 参考图片选择区域 */}
          {visibleImages.length > 0 && (
            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-lg font-semibold text-gray-300">选择参考图片</h3>
                <span className="text-sm text-gray-400">
                  已选 {selectedImageIds.length} / 4
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {visibleImages.map((img) => {
                  const isSelected = selectedImageIds.includes(img.image_id);
                  return (
                    <div
                      key={img.image_id}
                      onClick={() => !isGenerating && toggleImageSelection(img.image_id)}
                      className={`
                        relative cursor-pointer rounded-lg overflow-hidden transition
                        ${isSelected ? 'ring-2 ring-blue-500' : 'ring-1 ring-gray-600 hover:ring-gray-500'}
                        ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <img
                        src={getImageUrl(img).replace('/images/files/', '/thumbnails/')}
                        alt={img.image_id}
                        className="w-full aspect-square object-cover"
                      />
                      {img.is_primary && (
                        <div className="absolute top-1 left-1 bg-blue-600 text-xs px-2 py-0.5 rounded">
                          主图
                        </div>
                      )}
                      {isSelected && (
                        <div className="absolute top-1 right-1 bg-blue-500 rounded-full p-1">
                          <Check size={14} className="text-white" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 生成设置 */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedSize}
              onChange={(e) => setSelectedSize(e.target.value)}
              disabled={isGenerating}
              className="h-9 w-28 bg-gray-700 border border-gray-600 rounded px-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            >
              {IMAGE_SIZE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <input
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isGenerating}
              list="image-edit-model-suggestions"
              placeholder="图片模型"
              className="h-9 w-36 bg-gray-700 border border-gray-600 rounded px-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <datalist id="image-edit-model-suggestions">
              {imageSuggestions.map((option) => (
                <option key={option.model} value={option.model}>{option.label}</option>
              ))}
            </datalist>
          </div>

          {/* 提示词输入区域 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-300 mb-3">编辑提示词</h3>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isGenerating}
              placeholder="描述你想要的图片效果，例如：&#10;- 将背景改为夕阳下的海滩&#10;- 让人物 wearing a red jacket&#10;- 添加一些 rain effects"
              className="w-full h-32 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200 resize-none focus:outline-none focus:border-blue-500 disabled:opacity-500"
            />
          </div>

          {/* 状态提示 */}
          {totalReferences > 0 && (
            <div className={`text-sm py-2 px-3 rounded ${
              totalReferences > 4
                ? 'bg-red-900 bg-opacity-30 text-red-300'
                : 'bg-blue-900 bg-opacity-30 text-blue-300'
            }`}>
              总参考图片: {totalReferences} / 4
              {totalReferences > 4 && '（超过限制，请减少）'}
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleStartEdit}
              disabled={isGenerating || totalReferences === 0 || totalReferences > 4 || !prompt.trim()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg flex items-center gap-2 disabled:bg-gray-700 disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  编辑中...
                </>
              ) : (
                <>
                  <ImagePlus size={16} />
                  开始编辑
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
