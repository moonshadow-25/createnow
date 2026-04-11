import { useState, useEffect, useRef } from 'react';
import { X, Check, ZoomIn, Download, EyeOff, RotateCcw, Upload, Loader2 } from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import { generationApi } from '@/services/api';

interface Image {
  image_id: string;
  image_path: string;
  local_path?: string;  // 本地路径
  is_downloaded?: boolean;  // 是否已下载
  prompt: string;
  is_primary: boolean;
  created_at: string;
}

interface ImageGalleryProps {
  images: Image[];
  assetName: string;
  assetId?: string;
  projectId?: string;
  assetType: string;  // 新增：资产类型 'character' | 'scene' | 'prop' | 'storyboard'
  onSelectPrimary: (imageId: string) => void;
  onClose: () => void;
  onImagesUpdated?: () => void;  // 新增：图片更新后的回调
}

export function ImageGallery({ images, assetName, assetId, projectId, assetType, onSelectPrimary, onClose, onImagesUpdated }: ImageGalleryProps) {
  const { toast } = useToast();
  const [selectedForComparison, setSelectedForComparison] = useState<string[]>([]);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 从 localStorage 读取隐藏状态
  useEffect(() => {
    if (!assetId) return;
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

  // 保存隐藏状态到 localStorage
  const saveHiddenState = (hiddenIds: Set<string>) => {
    if (!assetId) return;
    const storageKey = `hidden_images_${assetId}`;
    localStorage.setItem(storageKey, JSON.stringify(Array.from(hiddenIds)));
  };

  // 隐藏图片
  const handleHideImage = (imageId: string) => {
    const newHiddenIds = new Set(hiddenImageIds);
    newHiddenIds.add(imageId);
    setHiddenImageIds(newHiddenIds);
    saveHiddenState(newHiddenIds);
  };

  // 恢复全部图片
  const handleRestoreAll = () => {
    setHiddenImageIds(new Set());
    if (assetId) {
      localStorage.removeItem(`hidden_images_${assetId}`);
    }
  };

  // 上传图片
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      toast('不支持的文件类型，请上传JPG、PNG或WEBP格式', 'error');
      return;
    }

    // 验证文件大小（10MB）
    if (file.size > 10 * 1024 * 1024) {
      toast('文件过大，请上传小于10MB的图片', 'error');
      return;
    }

    if (!projectId || !assetId) {
      toast('缺少必要参数', 'error');
      return;
    }

    setUploading(true);
    try {
      await generationApi.uploadImage(projectId, {
        asset_id: assetId,
        asset_type: assetType,
        file: file,
        prompt: `手动上传: ${file.name}`
      });

      toast('图片上传成功', 'success');

      // 通知父组件刷新图片列表
      if (onImagesUpdated) {
        onImagesUpdated();
      }
    } catch (error: any) {
      toast(`上传失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setUploading(false);
      // 清空input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 过滤后的图片列表（排除隐藏的）并排序
  const visibleImages = images
    .filter(img => !hiddenImageIds.has(img.image_id))
    .sort((a, b) => {
      // 主图排第一
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;

      // 检查时间戳是否存在且有效
      const hasTimeA = a.created_at && !isNaN(new Date(a.created_at).getTime());
      const hasTimeB = b.created_at && !isNaN(new Date(b.created_at).getTime());

      // 如果一个有时间戳，另一个没有，把没有时间戳的排到后面
      if (hasTimeA && !hasTimeB) return -1;
      if (!hasTimeA && hasTimeB) return 1;

      // 如果两个都没有时间戳，保持原有顺序
      if (!hasTimeA && !hasTimeB) return 0;

      // 两个都有时间戳，按创建时间倒序（新的在前）
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return timeB - timeA;
    });

  const handleToggleCompare = (imageId: string) => {
    if (selectedForComparison.includes(imageId)) {
      setSelectedForComparison(selectedForComparison.filter(id => id !== imageId));
    } else if (selectedForComparison.length < 2) {
      setSelectedForComparison([...selectedForComparison, imageId]);
    }
  };

  // 获取图片URL，优先使用本地路径
  const getImageUrl = (image: Image) => {
    // 如果有本地路径，优先使用
    if (image.local_path && projectId) {
      return `/api/projects/${projectId}/images/files/${image.local_path}`;
    }
    // 否则使用原始路径
    if (image.image_path.startsWith('/')) {
      return `/api/projects/placeholder${image.image_path}`;
    }
    return image.image_path;
  };

  // 获取缩略图URL（用于列表显示）
  const getThumbnailUrl = (image: Image) => {
    const originalUrl = getImageUrl(image);
    // 只有本地图片才有缩略图
    if (originalUrl.includes('/images/files/')) {
      return originalUrl.replace('/images/files/', '/thumbnails/');
    }
    // 外部URL直接返回原图
    return originalUrl;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <div>
            <h2 className="text-xl font-semibold">{assetName} - 图片库</h2>
            <p className="text-sm text-gray-400">
              {visibleImages.length} 张图片
              {hiddenImageIds.size > 0 && <span className="text-orange-400 ml-2">（已隐藏 {hiddenImageIds.size} 张）</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 隐藏的文件input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/jpg"
              onChange={handleFileSelect}
              className="hidden"
            />
            {/* 上传图片按钮 */}
            <button
              onClick={handleUploadClick}
              disabled={uploading}
              className="flex items-center gap-1 px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-sm disabled:bg-gray-600 disabled:cursor-not-allowed"
              title="上传本地图片"
            >
              {uploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  上传中...
                </>
              ) : (
                <>
                  <Upload size={14} />
                  上传图片
                </>
              )}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={24} />
            </button>
          </div>
        </div>

        {/* 并排比较视图 */}
        {selectedForComparison.length === 2 && (
          <div className="p-4 bg-gray-900 border-b border-gray-700">
            <div className="grid grid-cols-2 gap-4">
              {selectedForComparison.map(id => {
                const img = visibleImages.find(i => i.image_id === id);
                if (!img) return null;
                return (
                  <div key={id} className="relative">
                    <img
                      src={getImageUrl(img)}
                      alt={assetName}
                      className="w-full h-64 object-cover rounded"
                      loading="lazy"
                    />
                    <div className="absolute bottom-2 left-2 right-2 bg-black bg-opacity-70 text-xs p-2 rounded" style={{color: 'rgba(255,255,255,0.95)'}}>
                      <div className="line-clamp-2">{img.prompt}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-sm text-gray-400 mt-2">并排比较模式</p>
          </div>
        )}

        {/* 图片网格 */}
        <div className="flex-1 overflow-y-auto p-4">
          {visibleImages.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center h-full min-h-64 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:border-gray-400 hover:bg-gray-700 transition"
              onClick={handleUploadClick}
            >
              <Upload size={48} className="text-gray-500 mb-4" />
              <p className="text-gray-400 text-lg mb-1">暂无图片</p>
              <p className="text-gray-500 text-sm">点击此处上传本地图片</p>
            </div>
          ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {visibleImages.map((img) => (
              <div
                key={img.image_id}
                className={`relative group rounded-lg overflow-hidden ${
                  selectedForComparison.includes(img.image_id) ? 'ring-2 ring-blue-500' : ''
                }`}
              >
                <img
                  src={getThumbnailUrl(img)}
                  alt={assetName}
                  className="w-full aspect-square object-cover cursor-pointer"
                  onClick={() => setExpandedImage(img.image_id)}
                  loading="lazy"
                />

                {/* 悬停遮罩 */}
                <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                  <button
                    onClick={() => setExpandedImage(img.image_id)}
                    className="p-2 bg-white rounded-full hover:bg-gray-200"
                    title="放大"
                  >
                    <ZoomIn size={16} className="text-gray-800" />
                  </button>
                  <button
                    onClick={() => handleToggleCompare(img.image_id)}
                    className={`p-2 rounded-full ${
                      selectedForComparison.includes(img.image_id)
                        ? 'bg-blue-500 hover:bg-blue-600'
                        : 'bg-white hover:bg-gray-200'
                    }`}
                    title={selectedForComparison.includes(img.image_id) ? '取消比较' : '加入比较'}
                  >
                    <Check size={16} className={selectedForComparison.includes(img.image_id) ? 'text-white' : 'text-gray-800'} />
                  </button>
                  <a
                    href={getImageUrl(img)}
                    download
                    className="p-2 bg-white rounded-full hover:bg-gray-200"
                    title="下载"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download size={16} className="text-gray-800" />
                  </a>
                  <button
                    onClick={() => handleHideImage(img.image_id)}
                    className="p-2 bg-red-600 rounded-full hover:bg-red-700"
                    title="隐藏图片"
                  >
                    <EyeOff size={16} className="text-white" />
                  </button>
                  {!img.is_primary && (
                    <button
                      onClick={() => onSelectPrimary(img.image_id)}
                      className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                    >
                      设为主图
                    </button>
                  )}
                </div>

                {/* 主图标记 */}
                {img.is_primary && (
                  <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded">
                    主图
                  </div>
                )}

                {/* 图片信息 */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-2">
                  <p className="text-xs line-clamp-2" style={{color: 'rgba(255,255,255,0.95)'}}>{img.prompt}</p>
                  <p className="text-xs mt-1" style={{color: 'rgba(255,255,255,0.6)'}}>
                    {new Date(img.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="p-4 border-t border-gray-700 flex justify-between items-center">
          <div className="text-sm text-gray-400">
            {selectedForComparison.length > 0 && (
              <span>已选择 {selectedForComparison.length} 张图片进行比较</span>
            )}
            {hiddenImageIds.size > 0 && selectedForComparison.length === 0 && (
              <span className="text-orange-400">已隐藏 {hiddenImageIds.size} 张图片</span>
            )}
          </div>
          <div className="flex gap-2">
            {hiddenImageIds.size > 0 && (
              <button
                onClick={handleRestoreAll}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded"
              >
                <RotateCcw size={16} />
                恢复全部
              </button>
            )}
            {selectedForComparison.length > 0 && (
              <button
                onClick={() => setSelectedForComparison([])}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded"
              >
                清除选择
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
            >
              关闭
            </button>
          </div>
        </div>
      </div>

      {/* 大图预览 */}
      {expandedImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-60"
          onClick={() => setExpandedImage(null)}
        >
          <div className="max-w-5xl max-h-full p-4">
            {(() => {
              const img = visibleImages.find(i => i.image_id === expandedImage);
              if (!img) return null;
              return (
                <div>
                  <img
                    src={getImageUrl(img)}
                    alt={assetName}
                    className="max-w-full max-h-[85vh] object-contain rounded"
                    loading="lazy"
                  />
                  <div className="mt-4 text-center">
                    <p className="text-sm" style={{color: 'rgba(255,255,255,0.95)'}}>{img.prompt}</p>
                    <p className="text-xs mt-2" style={{color: 'rgba(255,255,255,0.6)'}}>
                      {new Date(img.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
