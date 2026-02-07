import { useState, useEffect } from 'react';
import { Edit, Trash2, Images, ChevronDown, ChevronRight, Wand2, ImagePlus, Edit3, CheckCircle, AlertCircle, X, Users, Plus } from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import { ImageGallery } from './ImageGallery';
import { assetApi, generationApi } from '@/services/api';
import { ImageEditDialog } from '@/components/common/ImageEditDialog';

interface AssetCardProps {
  projectId: string;
  assetType: string;
  asset: any;
  onDeleted: () => void;
  childAssets?: any[];
}

export function AssetCard({ projectId, assetType, asset, onDeleted, childAssets = [] }: AssetCardProps) {
  const { toast } = useToast();
  // 使用后端返回的主图URL和图片数量，初始化时直接使用
  const [primaryImage, setPrimaryImage] = useState<string | null>(asset.primary_image_url || null);
  const [imageCount, setImageCount] = useState(asset.image_count || 0);
  const [showGallery, setShowGallery] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showChildDialog, setShowChildDialog] = useState(false);
  const [images, setImages] = useState<any[]>([]);

  // 编辑状态
  const [editData, setEditData] = useState<any>({});
  const [imagePrompt, setImagePrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [imagePromptSectionExpanded, setImagePromptSectionExpanded] = useState(false);
  const [basicInfoExpanded, setBasicInfoExpanded] = useState(false);
  const [editImagePrompt, setEditImagePrompt] = useState('');
  const [generatingEditPrompt, setGeneratingEditPrompt] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  // 图像编辑对话框状态
  const [showImageEditDialog, setShowImageEditDialog] = useState(false);
  // 隐藏图片状态
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(new Set());

  const isChildCharacter = assetType === 'character' && asset.parent_id;

  // 当 asset 更新时同步主图和数量（父组件刷新时）
  useEffect(() => {
    setPrimaryImage(asset.primary_image_url || null);
    setImageCount(asset.image_count || 0);
  }, [asset.primary_image_url, asset.image_count]);

  // 读取隐藏图片状态
  useEffect(() => {
    if (!asset.asset_id) return;
    const storageKey = `hidden_images_${asset.asset_id}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const hiddenIds = JSON.parse(stored);
        setHiddenImageIds(new Set(hiddenIds));
      } catch (e) {
        console.error('Failed to parse hidden images:', e);
      }
    }
  }, [asset.asset_id, images]);

  // 仅在需要时加载完整图片列表（打开图库或编辑弹框时）
  const loadImages = async () => {
    try {
      const response = await generationApi.listImages(projectId, asset.asset_id);
      const imgs = response.data || [];
      const sorted = imgs.sort((a: any, b: any) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      setImages(sorted);
      setImageCount(sorted.length);
      // 更新主图
      const primary = sorted.find((img: any) => img.is_primary) || sorted[0];
      if (primary) {
        const imageUrl = primary.local_path
          ? `/api/projects/${projectId}/images/files/${primary.local_path}`
          : primary.image_path;
        setPrimaryImage(imageUrl);
      }
    } catch (error) {
      console.error('Failed to load images:', error);
    }
  };

  // 获取图片URL，优先使用本地路径（用于编辑预览等）
  const getImageUrl = (image: any) => {
    if (image.local_path) {
      return `/api/projects/${projectId}/images/files/${image.local_path}`;
    }
    return image.image_path;
  };

  const handleDelete = async () => {
    if (confirm('确定删除此资产吗？')) {
      try {
        await assetApi.delete(projectId, assetType, asset.asset_id);
        onDeleted();
      } catch (error) {
        toast('删除失败', 'error');
      }
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    try {
      await generationApi.setPrimaryImage(projectId, asset.asset_id, imageId);
      await loadImages();
      onDeleted();
    } catch (error) {
      toast('设置主图失败', 'error');
    }
  };

  // 打开编辑弹框
  const openEditModal = async () => {
    setEditData({ ...asset });
    setImagePrompt(asset.image_prompt || '');
    setEditImagePrompt(asset.edit_image_prompt || '');
    setImagePromptSectionExpanded(!asset.parent_id);
    setPromptError('');
    setSaveSuccess(false);
    setShowEdit(true);
    // 加载图片列表用于编辑弹框中的图片预览
    await loadImages();
  };

  const handleSave = async () => {
    setGenerating(true);
    setSaveSuccess(false);
    try {
      const dataToSave = {
        ...editData,
        image_prompt: imagePrompt || undefined,
        edit_image_prompt: editImagePrompt || undefined
      };
      await assetApi.update(projectId, assetType, asset.asset_id, dataToSave);
      setSaveSuccess(true);
      onDeleted();
      setTimeout(() => {
        setSaveSuccess(false);
      }, 2000);
    } catch (error) {
      toast('保存失败', 'error');
      setSaveSuccess(false);
    } finally {
      setGenerating(false);
    }
  };

  const handleGeneratePrompt = async () => {
    setGeneratingPrompt(true);
    setPromptError('');
    try {
      let enhancedDescription = editData.description || asset.description || '';
      if (assetType === 'character') {
        const details = [];
        if (editData.gender || asset.gender) details.push(`性别: ${editData.gender || asset.gender}`);
        if (editData.age || asset.age) details.push(`年龄: ${editData.age || asset.age}`);
        if (details.length > 0) enhancedDescription += `\n${details.join(', ')}`;
      } else if (assetType === 'scene') {
        if (editData.location || asset.location) enhancedDescription += `\n地点: ${editData.location || asset.location}`;
      }
      const response = await generationApi.generateImagePrompt(projectId, {
        asset_type: assetType,
        description: enhancedDescription,
      });
      const newPrompt = response.data.positive_prompt;
      setImagePrompt(newPrompt);
      setImagePromptSectionExpanded(true);
      setEditData((prev: any) => ({ ...prev, image_prompt: newPrompt }));

      // 自动保存提示词到资产
      try {
        await assetApi.update(projectId, assetType, asset.asset_id, {
          image_prompt: newPrompt
        });
        toast('提示词已生成并保存', 'success');
      } catch (saveError) {
        console.error('保存提示词失败:', saveError);
        toast('提示词已生成，但保存失败', 'error');
      }
    } catch (error: any) {
      setPromptError(error.response?.data?.detail || '生成提示词失败');
    } finally {
      setGeneratingPrompt(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim()) {
      toast('请先生成或输入提示词', 'error');
      return;
    }
    setGenerating(true);
    try {
      await generationApi.generateImage(projectId, {
        asset_id: asset.asset_id,
        asset_type: assetType,
        prompt: imagePrompt,
        negative_prompt: '',
        width: 1024,
        height: 1024,
      });
      await loadImages();
      toast('图片生成成功', 'success');
    } catch (error) {
      toast('生成图片失败', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateEditPrompt = async () => {
    if (!asset.parent_id) {
      toast('此功能仅适用于子角色', 'error');
      return;
    }
    setGeneratingEditPrompt(true);
    setPromptError('');
    try {
      const response = await generationApi.generateImageEditPrompt(projectId, asset.parent_id, asset.asset_id);
      const newPrompt = response.data.prompt || '';
      setEditImagePrompt(newPrompt);
      setEditData((prev: any) => ({ ...prev, edit_image_prompt: newPrompt }));
      toast('图像编辑提示词生成成功', 'success');
    } catch (error: any) {
      setPromptError(error.response?.data?.detail || '生成图像编辑提示词失败');
      toast('生成图像编辑提示词失败', 'error');
    } finally {
      setGeneratingEditPrompt(false);
    }
  };

  const handleEditImage = async () => {
    if (!editImagePrompt.trim()) {
      toast('请先生成图像编辑提示词', 'error');
      return;
    }
    setEditingImage(true);
    try {
      // 如果是子角色，获取父角色主图ID作为参考图
      let refImageIds: string[] = [];
      if (asset.parent_id) {
        const parent = await assetApi.get(projectId, assetType, asset.parent_id);
        if (parent.data?.image_id) {
          refImageIds = [parent.data.image_id];
        }
      }

      await generationApi.editImage(projectId, {
        assetId: asset.asset_id,
        assetType: assetType,
        prompt: editImagePrompt,
        size: '1024x1024',
        referenceImageIds: refImageIds
      });
      await loadImages();
      toast('图像编辑成功', 'success');
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail
        ? (typeof error.response.data.detail === 'string'
            ? error.response.data.detail
            : JSON.stringify(error.response.data.detail))
        : '图像编辑失败';
      toast(errorMsg, 'error');
    } finally {
      setEditingImage(false);
    }
  };

  const truncateDescription = (text: string, maxLength: number = 35) => {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  const getTypeLabel = () => {
    if (assetType === 'character') return '角色';
    if (assetType === 'scene') return '场景';
    if (assetType === 'prop') return '道具';
    return '';
  };

  // 创建子角色
  const handleCreateChild = async () => {
    const name = prompt(`创建 ${asset.name} 的子角色\n请输入子角色名称:`);
    if (!name) return;
    try {
      await assetApi.createChild(projectId, 'character', asset.asset_id, {
        asset_type: 'character',
        name,
        description: asset.description,
        gender: asset.gender,
        age: asset.age,
      });
      onDeleted();
      setShowChildDialog(false);
      toast('子角色创建成功！已继承父角色的图片。', 'success');
    } catch (error: any) {
      toast(`创建失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  // 打开图库时先加载完整图片列表
  const handleOpenGallery = async () => {
    await loadImages();
    setShowGallery(true);
  };

  return (
    <>
      <div className="bg-gray-800 rounded-lg overflow-hidden hover:bg-gray-750 transition group flex flex-col h-full">
        {/* 主图区域 - 可点击进入图片库 */}
        <div
          className="relative aspect-square bg-gray-700 cursor-pointer hover:opacity-90 transition"
          onClick={handleOpenGallery}
          title="点击查看图片库"
        >
          {primaryImage ? (
            <img
              src={primaryImage}
              alt={asset.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500 text-4xl font-bold">
              {asset.name?.[0]?.toUpperCase() || '?'}
            </div>
          )}
          {/* 图片数量标识 */}
          {imageCount > 0 && (
            <div className="absolute top-2 left-2 bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
              <Images size={12} />
              {imageCount}
            </div>
          )}
          {/* 类型标识 */}
          <div className="absolute top-2 right-2 bg-blue-600 bg-opacity-80 text-white text-xs px-2 py-1 rounded">
            {getTypeLabel()}
          </div>
        </div>

        {/* 内容区域 */}
        <div className="p-2 flex flex-col">
          {/* 名称 */}
          <h3 className="font-semibold text-white text-sm truncate mb-1" title={asset.name}>
            {asset.name}
          </h3>

          {/* 简短描述 */}
          <p className="text-gray-400 text-xs mb-1 line-clamp-1" title={asset.description}>
            {truncateDescription(asset.description, 35)}
          </p>

          {/* 操作按钮 */}
          <div className="flex gap-2">
            {/* 主角色显示子角色按钮 */}
            {!isChildCharacter && assetType === 'character' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowChildDialog(true);
                }}
                className="flex-1 flex items-center justify-center gap-1 text-xs bg-gray-700 hover:bg-blue-600 text-gray-300 hover:text-white px-2 py-1 rounded transition"
              >
                <Users size={12} />
                子角色
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                openEditModal();
              }}
              className="flex-1 flex items-center justify-center gap-1 text-xs bg-gray-700 hover:bg-green-600 text-gray-300 hover:text-white px-2 py-1 rounded transition"
            >
              <Edit size={12} />
              编辑
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              className="flex items-center justify-center gap-1 text-xs bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white px-2 py-1 rounded transition"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* 图片库 */}
      {showGallery && (
        <ImageGallery
          images={images}
          assetName={asset.name}
          assetId={asset.asset_id}
          projectId={projectId}
          assetType={assetType}
          onSelectPrimary={handleSetPrimary}
          onClose={() => setShowGallery(false)}
          onImagesUpdated={loadImages}
        />
      )}

      {/* 子角色弹框 */}
      {showChildDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-8">
          <div className="bg-gray-800 rounded-lg p-8 w-full max-w-7xl max-h-[90vh] overflow-y-auto">
            {/* 标题栏 */}
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-semibold">{asset.name} - 子角色</h2>
                <p className="text-sm text-gray-400">共 {childAssets.length} 个子角色</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCreateChild}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm"
                >
                  <Plus size={16} />
                  新增子角色
                </button>
                <button
                  onClick={() => setShowChildDialog(false)}
                  className="text-gray-400 hover:text-white p-2"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            {/* 子角色网格 - 减少列数使卡片更大 */}
            {childAssets.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {childAssets.map((child) => (
                  <AssetCard
                    key={child.asset_id}
                    projectId={projectId}
                    assetType="character"
                    asset={child}
                    onDeleted={onDeleted}
                    childAssets={childAssets.filter(c => c.parent_id === child.asset_id)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 text-gray-500 text-lg">
                暂无子角色，点击"新增子角色"创建
              </div>
            )}
          </div>
        </div>
      )}

      {/* 编辑弹框 - 直接显示完整编辑界面 */}
      {showEdit && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            {/* 标题栏 */}
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">
                编辑{assetType === 'character' ? '角色' : assetType === 'scene' ? '场景' : '道具'}
              </h2>
              <button
                onClick={() => setShowEdit(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>

            {/* 保存成功提示 */}
            {saveSuccess && (
              <div className="mb-4 flex items-center gap-2 text-sm text-green-400 bg-green-900 bg-opacity-20 px-3 py-2 rounded">
                <CheckCircle size={16} />
                保存成功！
              </div>
            )}

            <div className="space-y-4">
              {/* 基本信息编辑 - 可收起/展开 */}
              <div className="bg-gray-700 rounded overflow-hidden">
                <button
                  onClick={() => setBasicInfoExpanded(!basicInfoExpanded)}
                  className="w-full flex items-center justify-between p-3 hover:bg-gray-600 transition text-left"
                >
                  <div className="flex items-center gap-2">
                    {basicInfoExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <h3 className="text-sm font-semibold text-gray-300">基本信息</h3>
                  </div>
                  <span className="text-xs text-gray-500">
                    {basicInfoExpanded ? '收起' : '展开'}
                  </span>
                </button>

                {basicInfoExpanded && (
                  <div className="p-4 pt-0 space-y-3">
                    {/* 名称、性别、年龄 - 角色放在一行 */}
                    {assetType === 'character' ? (
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-sm text-gray-400 mb-2">名称 *</label>
                          <input
                            type="text"
                            value={editData.name || ''}
                            onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                            className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white"
                            placeholder="角色名"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-400 mb-2">性别</label>
                          <input
                            type="text"
                            value={editData.gender || ''}
                            onChange={(e) => setEditData({ ...editData, gender: e.target.value })}
                            className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white"
                            placeholder="男/女"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-400 mb-2">年龄</label>
                          <input
                            type="text"
                            value={editData.age || ''}
                            onChange={(e) => setEditData({ ...editData, age: e.target.value })}
                            className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white"
                            placeholder="年龄"
                          />
                        </div>
                      </div>
                    ) : (
                      /* 非角色 - 名称独占一行 */
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">名称 *</label>
                        <input
                          type="text"
                          value={editData.name || ''}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white"
                          placeholder="输入名称"
                        />
                      </div>
                    )}

                    {/* 描述 */}
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">描述 *</label>
                      <textarea
                        value={editData.description || ''}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white h-24"
                        placeholder="详细描述"
                      />
                    </div>

                    {/* 场景特有字段 */}
                    {assetType === 'scene' && (
                      <div>
                        <label className="block text-sm text-gray-400 mb-2">地点 *</label>
                        <input
                          type="text"
                          value={editData.location || ''}
                          onChange={(e) => setEditData({ ...editData, location: e.target.value })}
                          className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white"
                          placeholder="地点"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 错误提示 */}
              {promptError && (
                <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900 bg-opacity-20 px-3 py-2 rounded">
                  <AlertCircle size={16} />
                  {promptError}
                </div>
              )}

              {/* 图片提示词区域 - 默认展开 */}
              <div className="bg-gray-700 rounded overflow-hidden">
                <div className="flex items-center justify-between p-3">
                  <button
                    onClick={() => setImagePromptSectionExpanded(!imagePromptSectionExpanded)}
                    className="flex items-center gap-2 hover:bg-gray-600 transition text-left flex-1"
                  >
                    {imagePromptSectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <h3 className="text-sm font-semibold text-gray-300">图片提示词</h3>
                    <span className="text-xs text-gray-500">
                      {imagePromptSectionExpanded ? '收起' : '展开'}
                    </span>
                  </button>
                  <button
                    onClick={() => setShowImageEditDialog(true)}
                    className="flex items-center gap-1 bg-orange-600 hover:bg-orange-700 px-3 py-1.5 rounded text-sm"
                    title="基于参考图片编辑生成新图片"
                    disabled={generating}
                  >
                    <Edit3 size={14} />
                    编辑图片
                  </button>
                </div>

                {imagePromptSectionExpanded && (
                  <div className="p-4 pt-0 space-y-3">
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">提示词内容</label>
                      <textarea
                        value={imagePrompt}
                        onChange={(e) => {
                          const newPrompt = e.target.value;
                          setImagePrompt(newPrompt);
                          setEditData((prev: any) => ({ ...prev, image_prompt: newPrompt }));
                        }}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white h-64"
                        placeholder="AI生成的提示词，你也可以手动修改..."
                      />
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={handleGeneratePrompt}
                        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg"
                        disabled={generatingPrompt || generating || editingImage}
                      >
                        <Wand2 size={16} />
                        {generatingPrompt ? '生成中...' : imagePrompt ? '重新生成提示词' : 'AI生成提示词'}
                      </button>
                      <button
                        onClick={handleGenerateImage}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
                        disabled={generating}
                      >
                        <ImagePlus size={16} />
                        {generating ? '生成中...' : '生成图片'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 图像编辑提示词区域 - 仅子角色显示 */}
              {isChildCharacter && (
                <div className="bg-orange-900 bg-opacity-20 rounded-lg p-4 space-y-3 border border-orange-700">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm text-orange-300">图像编辑提示词（基于父角色主图编辑）</label>
                      <button
                        onClick={() => {
                          setEditImagePrompt('');
                          setEditData((prev: any) => ({ ...prev, edit_image_prompt: undefined }));
                        }}
                        className="text-xs text-gray-400 hover:text-white"
                      >
                        清除
                      </button>
                    </div>
                    <textarea
                      value={editImagePrompt}
                      onChange={(e) => {
                        const newPrompt = e.target.value;
                        setEditImagePrompt(newPrompt);
                        setEditData((prev: any) => ({ ...prev, edit_image_prompt: newPrompt }));
                      }}
                      className="w-full bg-gray-600 border border-orange-700 rounded px-3 py-2 text-white h-24"
                      placeholder="基于父角色主图的编辑提示词..."
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleGenerateEditPrompt}
                      className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg"
                      disabled={generatingEditPrompt || generating || editingImage}
                    >
                      <Wand2 size={16} />
                      {generatingEditPrompt ? '生成中...' : 'AI生成提示词'}
                    </button>
                    <button
                      onClick={handleEditImage}
                      className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 px-4 py-2 rounded-lg"
                      disabled={editingImage}
                    >
                      <Edit3 size={16} />
                      {editingImage ? '编辑中...' : '执行图像编辑'}
                    </button>
                  </div>
                </div>
              )}

              {/* 图片库预览 */}
              {images.length > 0 && (() => {
                // 过滤隐藏的图片并排序（主图在前）
                const visibleImages = images
                  .filter(img => !hiddenImageIds.has(img.image_id))
                  .sort((a, b) => {
                    if (a.is_primary && !b.is_primary) return -1;
                    if (!a.is_primary && b.is_primary) return 1;
                    return 0;
                  });

                if (visibleImages.length === 0) return null;

                return (
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-gray-300">
                      已生成图片 ({visibleImages.length})
                    </span>
                    <div className="flex items-center gap-2 flex-1">
                      <div
                        onClick={() => {
                          setShowEdit(false);
                          setShowGallery(true);
                        }}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        {visibleImages.slice(0, 3).map((img) => (
                          <div key={img.image_id} className="relative group">
                            <img
                              src={getImageUrl(img)}
                              alt={asset.name}
                              className="w-16 h-16 object-cover rounded-lg border-2 border-transparent hover:border-blue-500 transition"
                              loading="lazy"
                            />
                            {img.is_primary && (
                              <div className="absolute top-0 right-0 bg-blue-600 text-xs px-1 rounded-tl rounded-br">
                                主
                              </div>
                            )}
                          </div>
                        ))}
                        {visibleImages.length > 3 && (
                          <div className="w-16 h-16 bg-gray-600 rounded-lg flex items-center justify-center text-gray-300 font-semibold border-2 border-transparent hover:border-blue-500 transition">
                            +{visibleImages.length - 3}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setShowEdit(false);
                          setShowGallery(true);
                        }}
                        className="flex items-center gap-1 text-green-400 hover:text-green-300 text-sm ml-auto"
                      >
                        <Images size={14} />
                        管理
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 底部按钮 */}
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-700">
              <button
                onClick={() => setShowEdit(false)}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-2"
                disabled={generating || !editData.name || !editData.description}
              >
                {generating ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded"></div>
                    保存中...
                  </>
                ) : (
                  <>
                    <CheckCircle size={16} />
                    保存更改
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图像编辑对话框 */}
      {showImageEditDialog && (
        <ImageEditDialog
          projectId={projectId}
          assetId={asset.asset_id}
          assetType={assetType}
          assetName={asset.name}
          images={images}
          onCompleted={async () => {
            await loadImages();
            onDeleted();
          }}
          onClose={() => setShowImageEditDialog(false)}
        />
      )}
    </>
  );
}
