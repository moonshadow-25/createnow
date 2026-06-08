import { useState, useEffect, useRef } from 'react';
import { Trash2, Images, ChevronDown, ChevronRight, Wand2, ImagePlus, Edit3, CheckCircle, AlertCircle, X, Users, Plus, Info, Mic, Upload, Play, Pause } from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import { ImageGallery } from './ImageGallery';
import { assetApi, generationApi } from '@/services/api';
import { ImageEditDialog } from '@/components/common/ImageEditDialog';
import { useVibeDramaStore } from '@/store/vibeDramaStore';
import { normalizeTags, toggleTag } from '@/utils/assetTags';

interface AssetCardProps {
  projectId: string;
  assetType: string;
  asset: any;
  onDeleted: () => void;
  childAssets?: any[];
  allTags?: string[];
}

export function AssetCard({ projectId, assetType, asset, onDeleted, childAssets = [], allTags = [] }: AssetCardProps) {
  const { toast } = useToast();
  const setVibeDramaContext = useVibeDramaStore(s => s.setContext);
  const openVibeDrama = useVibeDramaStore(s => s.open);
  const setPendingMessage = useVibeDramaStore(s => s.setPendingMessage);
  // 使用后端返回的主图URL和图片数量，初始化时直接使用
  const [primaryImage, setPrimaryImage] = useState<string | null>(asset.primary_image_url || null);
  const [imageCount, setImageCount] = useState(asset.image_count || 0);
  const [showGallery, setShowGallery] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showChildDialog, setShowChildDialog] = useState(false);
  const [images, setImages] = useState<any[]>([]);

  // 编辑状态
  const [editData, setEditData] = useState<any>({});
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [promptError, setPromptError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [imagePromptSectionExpanded, setImagePromptSectionExpanded] = useState(false);
  const [basicInfoExpanded, setBasicInfoExpanded] = useState(false);
  const [editImagePrompt, setEditImagePrompt] = useState('');
  const [generatingEditPrompt, setGeneratingEditPrompt] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  const [generatingCharacterSheet, setGeneratingCharacterSheet] = useState(false);  // 生成人设图状态
  // 图像编辑对话框状态
  const [showImageEditDialog, setShowImageEditDialog] = useState(false);
  // 隐藏图片状态
  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(new Set());

  // 音色状态（仅角色）
  const [voicePrompt, setVoicePrompt] = useState(asset.voice_prompt || '');
  const [voiceId, setVoiceId] = useState(asset.voice_id || '');
  const [voiceEnabled, setVoiceEnabled] = useState(asset.voice_enabled ?? true);
  const [sampleText, setSampleText] = useState('');
  const [voices, setVoices] = useState<any[]>([]);
  const [generatingVoice, setGeneratingVoice] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [voiceSectionExpanded, setVoiceSectionExpanded] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const voiceUploadRef = useRef<HTMLInputElement>(null);

  const isChildCharacter = assetType === 'character' && asset.parent_id;
  const availableTags = normalizeTags(allTags);
  const remainingTags = availableTags.filter(
    (tag) => !normalizeTags(draftTags).some((draftTag) => draftTag.toLocaleLowerCase() === tag.toLocaleLowerCase())
  );

  const addDraftTag = (tag: string) => {
    const normalized = normalizeTags([tag])[0];
    if (!normalized) return;
    setDraftTags((prev) => normalizeTags([...prev, normalized]));
    setNewTagInput('');
  };

  const removeDraftTag = (tag: string) => {
    setDraftTags((prev) => toggleTag(prev, tag));
  };

  // 当 asset 更新时同步主图和数量（父组件刷新时）
  useEffect(() => {
    setPrimaryImage(asset.primary_image_url || null);
    setImageCount(asset.image_count || 0);
  }, [asset.primary_image_url, asset.image_count]);

  useEffect(() => {
    setVoicePrompt(asset.voice_prompt || '');
    setVoiceId(asset.voice_id || '');
    setVoiceEnabled(asset.voice_enabled ?? true);
  }, [asset.voice_prompt, asset.voice_id, asset.voice_enabled]);

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
    setEditData({ ...asset, voice_enabled: asset.voice_enabled ?? true });
    setDraftTags(normalizeTags(asset.tags ?? []));
    setNewTagInput('');
    setImagePrompt(asset.image_prompt || '');
    setEditImagePrompt(asset.edit_image_prompt || '');
    setImagePromptSectionExpanded(!asset.parent_id);
    setBasicInfoExpanded(true);
    setPromptError('');
    setSaveSuccess(false);
    setShowEdit(true);
    // 加载图片列表用于编辑弹框中的图片预览
    await loadImages();
    // 加载角色音色列表
    if (assetType === 'character') {
      setVoicePrompt(asset.voice_prompt || '');
      setVoiceId(asset.voice_id || '');
      setVoiceEnabled(asset.voice_enabled ?? true);
      await loadVoices();
    }
  };

  const handleSave = async () => {
    setGenerating(true);
    setSaveSuccess(false);
    try {
      const dataToSave = {
        ...editData,
        tags: normalizeTags(draftTags),
        image_prompt: imagePrompt || undefined,
        edit_image_prompt: editImagePrompt || undefined,
        ...(assetType === 'character' ? { voice_enabled: voiceEnabled } : {})
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

  const handleGeneratePrompt = () => {
    const assetTypeLabel: Record<string, string> = { character: '角色', scene: '场景', prop: '道具' };
    const label = assetTypeLabel[assetType] || assetType;
    const key = `${projectId}_assets`;
    setVibeDramaContext({ projectId, projectName: '', tabName: 'assets', label: '资产面板' });
    openVibeDrama();
    setPendingMessage({
      key,
      message: `为${label}「${asset.name}」（asset_id: ${asset.asset_id}）生成图片提示词，只更新这一个资产，不要修改其他资产`,
    });
    setShowEdit(false);
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

  const handleGenerateCharacterSheet = async () => {
    // 检查是否是角色类型
    if (assetType !== 'character') {
      toast('此功能仅适用于角色资产', 'error');
      return;
    }

    // 检查是否有主图
    if (!asset.image_id) {
      toast('请先生成角色的主图', 'error');
      return;
    }

    setGeneratingCharacterSheet(true);
    try {
      await generationApi.editImage(projectId, {
        assetId: asset.asset_id,
        assetType: assetType,
        prompt: '',  // 留空，由模板填充
        referenceImageIds: [asset.image_id],
        template: 'character_sheet'  // 使用人设模板
      });

      await loadImages();
      toast('人设图生成成功', 'success');
    } catch (error: any) {
      const errorMsg = error.response?.data?.detail
        ? (typeof error.response.data.detail === 'string'
            ? error.response.data.detail
            : JSON.stringify(error.response.data.detail))
        : '生成人设图失败';
      toast(errorMsg, 'error');
    } finally {
      setGeneratingCharacterSheet(false);
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

  // 直接从卡片打开图像编辑对话框
  const handleOpenImageEdit = async () => {
    await loadImages();
    setShowImageEditDialog(true);
  };

  // ─── 音色处理函数（仅角色）────────────────────────────────────────────────

  const loadVoices = async () => {
    if (assetType !== 'character') return;
    try {
      const res = await generationApi.listCharacterVoices(projectId, asset.asset_id);
      setVoices(res.data || []);
    } catch (e) {
      // ignore
    }
  };

  const handleGenerateVoice = async () => {
    if (!voicePrompt.trim() || !sampleText.trim()) {
      toast('请填写音色描述和朗读文本', 'error');
      return;
    }
    setGeneratingVoice(true);
    try {
      await generationApi.generateCharacterVoice(projectId, asset.asset_id, {
        voice_prompt: voicePrompt,
        sample_text: sampleText,
        voice: voiceId || undefined,
      });
      toast('音色生成成功', 'success');
      await loadVoices();
    } catch (error: any) {
      toast(`生成失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setGeneratingVoice(false);
    }
  };

  const handleUploadVoice = async (file: File) => {
    setUploadingVoice(true);
    try {
      await generationApi.uploadCharacterVoice(projectId, asset.asset_id, file);
      toast('音色上传成功', 'success');
      await loadVoices();
    } catch (error: any) {
      toast(`上传失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setUploadingVoice(false);
    }
  };

  const handleSetPrimaryVoice = async (audioId: string) => {
    try {
      await generationApi.setCharacterPrimaryVoice(projectId, audioId, asset.asset_id);
      toast('已设为主音色', 'success');
      await loadVoices();
      onDeleted();
    } catch (error: any) {
      toast(`操作失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  const handleDeleteVoice = async (audioId: string) => {
    if (!confirm('确定删除该音色？')) return;
    try {
      await generationApi.deleteCharacterVoice(projectId, audioId);
      toast('已删除', 'success');
      await loadVoices();
      onDeleted();
    } catch (error: any) {
      toast(`删除失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  const togglePlayAudio = (audioId: string, audioSrc: string) => {
    const current = audioRefs.current[audioId];
    const voice = voices.find(v => v.audio_id === audioId);
    const fallbackUrl = voice?.audio_path;

    const bindAudioEvents = (el: HTMLAudioElement, isFallback = false) => {
      el.onended = () => setPlayingAudioId(null);
      el.onerror = () => {
        if (!isFallback && fallbackUrl && el.src !== fallbackUrl) {
          const fallbackEl = new Audio(fallbackUrl);
          audioRefs.current[audioId] = fallbackEl;
          bindAudioEvents(fallbackEl, true);
          fallbackEl.play().then(() => {
            setPlayingAudioId(audioId);
            toast('本地音频不可用，已切换到远程音频播放', 'error');
          }).catch(() => {
            setPlayingAudioId(null);
            toast('音频播放失败', 'error');
          });
          return;
        }
        setPlayingAudioId(null);
        toast('音频播放失败', 'error');
      };
    };

    if (!current) {
      const el = new Audio(audioSrc);
      audioRefs.current[audioId] = el;
      bindAudioEvents(el);
      el.play().then(() => {
        setPlayingAudioId(audioId);
      }).catch(() => {
        setPlayingAudioId(null);
        toast('音频播放失败', 'error');
      });
    } else if (playingAudioId === audioId) {
      current.pause();
      setPlayingAudioId(null);
    } else {
      Object.values(audioRefs.current).forEach(a => a.pause());
      current.currentTime = 0;
      current.play().then(() => {
        setPlayingAudioId(audioId);
      }).catch(() => {
        setPlayingAudioId(null);
        toast('音频播放失败', 'error');
      });
    }
  };

  const getAudioUrl = (v: any): string | null => {
    if (v.local_path) return `/api/projects/${projectId}/generate/audios/${v.audio_id}/file`;
    if (v.audio_path) return v.audio_path;
    return null;
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
              src={primaryImage.replace('/images/files/', '/thumbnails/')}
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
          {/* 类型标识 - 不同类型用不同颜色 */}
          <div className={`absolute top-2 right-2 bg-opacity-80 text-white text-xs px-2 py-1 rounded ${
            assetType === 'character' ? 'bg-blue-600' :
            assetType === 'scene' ? 'bg-green-600' :
            'bg-orange-500'
          }`}>
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
            {/* 详情按钮（进入编辑弹框） */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                openEditModal();
              }}
              className="flex-1 flex items-center justify-center gap-1 text-xs bg-gray-700 hover:bg-green-600 text-gray-300 hover:text-white px-2 py-1 rounded transition"
            >
              <Info size={12} />
              详情
            </button>
            {/* 编辑按钮（进入图像编辑对话框） */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleOpenImageEdit();
              }}
              className="flex-1 flex items-center justify-center gap-1 text-xs bg-gray-700 hover:bg-blue-600 text-gray-300 hover:text-white px-2 py-1 rounded transition"
            >
              <Edit3 size={12} />
              编辑
            </button>
            {/* 删除按钮 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
              className="flex items-center justify-center text-xs bg-gray-700 hover:bg-red-600 text-gray-400 hover:text-white px-2 py-1 rounded transition"
              title="删除"
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

                    {/* 标签 */}
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">标签</label>
                      <div className="space-y-2">
                        {draftTags.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {draftTags.map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => removeDraftTag(tag)}
                                className="inline-flex items-center gap-1 rounded-full bg-blue-600/25 border border-blue-500/60 px-2.5 py-1 text-xs text-blue-100 hover:bg-blue-600/40"
                                title="点击移除标签"
                              >
                                {tag}
                                <X size={12} />
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newTagInput}
                            onChange={(e) => setNewTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                addDraftTag(newTagInput);
                              }
                            }}
                            className="flex-1 bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white"
                            placeholder="输入新标签，如 主角、反派、顾长夜"
                          />
                          <button
                            type="button"
                            onClick={() => addDraftTag(newTagInput)}
                            className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-sm disabled:bg-gray-600 disabled:text-gray-400"
                            disabled={!newTagInput.trim()}
                          >
                            新增tag
                          </button>
                        </div>
                        {remainingTags.length > 0 && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">已有标签，点击添加</div>
                            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                              {remainingTags.map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => addDraftTag(tag)}
                                  className="rounded-full bg-gray-600 hover:bg-gray-500 px-2 py-0.5 text-xs text-gray-200"
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
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
                        disabled={generating || editingImage || generatingCharacterSheet}
                      >
                        <Wand2 size={16} />
                        {imagePrompt ? '重新生成提示词' : 'AI生成提示词'}
                      </button>
                      <button
                        onClick={handleGenerateImage}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
                        disabled={generating || generatingCharacterSheet}
                      >
                        <ImagePlus size={16} />
                        {generating ? '生成中...' : '生成图片'}
                      </button>
                      {/* 生成人设按钮 - 仅角色类型显示 */}
                      {assetType === 'character' && (
                        <button
                          onClick={handleGenerateCharacterSheet}
                          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg disabled:bg-gray-700 disabled:opacity-50"
                          disabled={generatingCharacterSheet || !asset.image_id}
                          title={!asset.image_id ? '请先生成角色主图' : '生成角色人设图（全身三视图+面部特写）'}
                        >
                          <Users size={16} />
                          {generatingCharacterSheet ? '生成中...' : '生成人设'}
                        </button>
                      )}
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

              {/* 音色管理区域 - 仅角色显示 */}
              {assetType === 'character' && (
                <div className="bg-gray-700 rounded overflow-hidden">
                  <button
                    onClick={() => {
                      setVoiceSectionExpanded(!voiceSectionExpanded);
                      if (!voiceSectionExpanded) loadVoices();
                    }}
                    className="flex items-center gap-2 hover:bg-gray-600 transition text-left w-full p-3"
                  >
                    {voiceSectionExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <Mic size={14} className="text-purple-400" />
                    <h3 className="text-sm font-semibold text-gray-300">音色管理</h3>
                    {!voiceEnabled && (
                      <span className="ml-1 text-xs bg-gray-600 text-gray-200 px-1.5 py-0.5 rounded">已关闭</span>
                    )}
                    {voiceEnabled && voices.some(v => v.is_primary) && (
                      <span className="ml-1 text-xs bg-purple-700 text-purple-200 px-1.5 py-0.5 rounded">已设置</span>
                    )}
                    <span className="text-xs text-gray-500 ml-1">{voiceSectionExpanded ? '收起' : '展开'}</span>
                  </button>

                  {voiceSectionExpanded && (
                    <div className="p-4 pt-0 space-y-3">
                      <div className="flex items-center justify-between rounded bg-gray-600 px-3 py-2">
                        <div>
                          <div className="text-sm text-gray-200">声音启用</div>
                          <div className="text-xs text-gray-400">关闭后将停止自动引用和 API 传输角色声音</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const nextEnabled = !voiceEnabled;
                            setVoiceEnabled(nextEnabled);
                            setEditData((prev: any) => ({ ...prev, voice_enabled: nextEnabled }));
                          }}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${voiceEnabled ? 'bg-purple-600' : 'bg-gray-500'}`}
                          title={voiceEnabled ? '关闭声音' : '启用声音'}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${voiceEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                          />
                        </button>
                      </div>

                      <div>
                        <label className="block text-sm text-gray-400 mb-1">音色描述</label>
                        <textarea
                          value={voicePrompt}
                          onChange={(e) => {
                            setVoicePrompt(e.target.value);
                            setEditData((prev: any) => ({ ...prev, voice_prompt: e.target.value }));
                          }}
                          className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white h-16 text-sm"
                          placeholder="如：年轻女性，声音温柔甜美"
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-gray-400 mb-1">音色名称（可选）</label>
                        <input
                          type="text"
                          value={voiceId}
                          onChange={(e) => {
                            setVoiceId(e.target.value);
                            setEditData((prev: any) => ({ ...prev, voice_id: e.target.value }));
                          }}
                          className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white text-sm"
                          placeholder="如：zhichu（留空则使用默认音色）"
                        />
                      </div>

                      <div>
                        <label className="block text-sm text-gray-400 mb-1">朗读文本（用于生成样本）</label>
                        <input
                          type="text"
                          value={sampleText}
                          onChange={(e) => setSampleText(e.target.value)}
                          className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white text-sm"
                          placeholder="输入一段台词或测试文本"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={handleGenerateVoice}
                          disabled={generatingVoice || uploadingVoice}
                          className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-3 py-2 rounded text-sm"
                        >
                          <Mic size={14} />
                          {generatingVoice ? '生成中...' : '生成音色'}
                        </button>
                        <button
                          onClick={() => voiceUploadRef.current?.click()}
                          disabled={generatingVoice || uploadingVoice}
                          className="flex items-center gap-1.5 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 px-3 py-2 rounded text-sm"
                        >
                          <Upload size={14} />
                          {uploadingVoice ? '上传中...' : '上传音色'}
                        </button>
                        <input
                          ref={voiceUploadRef}
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleUploadVoice(file);
                            e.target.value = '';
                          }}
                        />
                      </div>

                      {voices.length > 0 && (
                        <div className="space-y-2">
                          {voices.map((v) => {
                            const audioUrl = getAudioUrl(v);
                            return (
                              <div
                                key={v.audio_id}
                                className={v.is_primary ? 'flex items-center gap-2 p-2 rounded bg-purple-900 bg-opacity-40 border border-purple-700' : 'flex items-center gap-2 p-2 rounded bg-gray-600'}
                              >
                                {audioUrl && (
                                  <button
                                    onClick={() => togglePlayAudio(v.audio_id, audioUrl)}
                                    className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-gray-500 hover:bg-gray-400 rounded-full"
                                  >
                                    {playingAudioId === v.audio_id ? <Pause size={14} /> : <Play size={14} />}
                                  </button>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-gray-300 truncate">{v.text || '已上传音频'}</div>
                                  <div className="text-xs text-gray-500">{v.created_at?.slice(0, 10)}</div>
                                </div>
                                {v.is_primary && (
                                  <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded flex-shrink-0">主音色</span>
                                )}
                                {!v.is_primary && (
                                  <button
                                    onClick={() => handleSetPrimaryVoice(v.audio_id)}
                                    className="text-xs text-gray-400 hover:text-white flex-shrink-0 px-2 py-0.5 border border-gray-500 rounded"
                                  >
                                    设为主音色
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDeleteVoice(v.audio_id)}
                                  className="flex-shrink-0 text-gray-500 hover:text-red-400"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {voices.length === 0 && (
                        <div className="text-xs text-gray-500 text-center py-2">暂无音色样本，点击生成或上传</div>
                      )}
                    </div>
                  )}
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
                              src={getImageUrl(img).replace('/images/files/', '/thumbnails/')}
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
