import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Plus, Wand2, ImagePlus, Edit3, Grid3X3, Scissors, RefreshCcw, CheckCircle, Sparkles, Film, Loader2, Download, Video, Play, Upload } from 'lucide-react';
import { generationApi } from '@/services/api';
import { VideoGallery } from './VideoGallery';
import { useVideoGeneration } from './hooks/useVideoGeneration';
import { getVideoUrl } from './utils/mediaUtils';

export interface StoryboardEditDialogProps {
  show: boolean;
  isCreating: boolean;
  storyboardsCount: number;
  editingStoryboard: any;
  projectId: string;
  episodeId: string;

  // tab 控制
  initialTab?: 'edit' | 'video';

  // 保存成功提示
  saveSuccess: boolean;

  // 分镜内容编辑
  contentExpanded: boolean;
  setContentExpanded: (v: boolean) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editDialogue: string;
  setEditDialogue: (v: string) => void;
  editAction: string;
  setEditAction: (v: string) => void;
  editShotType: string;
  setEditShotType: (v: string) => void;
  editCameraAngle: string;
  setEditCameraAngle: (v: string) => void;
  editDuration: number;
  setEditDuration: (v: number) => void;
  editResolution: string;
  setEditResolution: (v: string) => void;

  // 资产选择
  selectedCharacters: string[];
  setSelectedCharacters: (v: string[]) => void;
  selectedProps: string[];
  setSelectedProps: (v: string[]) => void;
  selectedScenes: string[];
  setSelectedScenes: (v: string[]) => void;
  characters: any[];
  scenes: any[];
  props: any[];
  onOpenAssetSelector: () => void;
  onAutoMatchAssets: () => void;

  // 提示词
  generatedPrompt: string;
  setGeneratedPrompt: (v: string) => void;
  onImagePromptChange: (v: string) => void;
  onGeneratePrompt: () => void;
  videoGen: ReturnType<typeof useVideoGeneration>;

  // 保存状态
  isSaving: boolean;

  // 图片
  storyboardImages: any[];
  hiddenImageIds: Set<string>;
  getImageUrl: (img: any) => string;
  onOpenImageGallery: () => void;

  // 任务状态
  getTaskStatus: (storyboardId: string, taskType: 'prompt' | 'image' | 'video' | 'auto_generate' | 'image_edit' | 'triple_grid' | 'auto_match' | 'nine_grid') => string | null;
  hasRunningTask: (storyboardId?: string) => boolean;

  // 操作
  onSave: () => void;
  onGenerateImage: () => void;
  onOpenImageEdit: () => void;
  onOpenTripleGridDialog: () => void;
  isSplittingTripleGrid: boolean;
  onSplitTripleGrid: () => void;
  onClose: () => void;
  onSuccess: () => void;
  onRefreshImages?: () => Promise<void>;
  onSaveBeforeGenerate: () => Promise<void>;
  multimodalReference?: boolean;
  showAssetSubmit?: boolean;
}

export function StoryboardEditDialog({
  show,
  isCreating,
  storyboardsCount,
  editingStoryboard,
  projectId,
  episodeId,
  initialTab = 'edit',
  saveSuccess,
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
  editDuration,
  setEditDuration,
  editResolution,
  setEditResolution,
  selectedCharacters,
  setSelectedCharacters,
  selectedProps,
  setSelectedProps,
  selectedScenes,
  setSelectedScenes,
  characters,
  scenes,
  props,
  onOpenAssetSelector,
  onAutoMatchAssets,
  generatedPrompt,
  onImagePromptChange,
  onGeneratePrompt,
  videoGen,
  isSaving,
  storyboardImages,
  hiddenImageIds,
  getImageUrl: getImageUrlProp,
  onOpenImageGallery,
  getTaskStatus,
  hasRunningTask,
  onSave,
  onGenerateImage,
  onOpenImageEdit,
  onOpenTripleGridDialog,
  isSplittingTripleGrid,
  onSplitTripleGrid,
  onClose,
  onSuccess,
  onRefreshImages,
  onSaveBeforeGenerate,
  multimodalReference = false,
  showAssetSubmit = false,
}: StoryboardEditDialogProps) {
  const [activeTab, setActiveTab] = useState<'edit' | 'video'>(initialTab);

  // 素材提交状态（分镜主图 image_id -> bool）
  const [assetSubmitting, setAssetSubmitting] = useState<Record<string, boolean>>({});
  // 关联资产主图的 volcengine 状态（image_id -> { asset_id?, status? }）
  const [assetImageStatuses, setAssetImageStatuses] = useState<Record<string, { asset_id?: string; status?: string; image_id?: string }>>({});

  const loadAssetImageStatuses = async (storyboard: any) => {
    if (!storyboard) return;
    const updates: Record<string, { asset_id?: string; status?: string; image_id?: string }> = {};
    const assetIds: string[] = [];
    for (const charId of storyboard.character_ids || []) {
      assetIds.push(charId);
    }
    const sceneIds: string[] = storyboard.scene_ids?.length
      ? storyboard.scene_ids
      : (storyboard.scene_id ? [storyboard.scene_id] : []);
    for (const sceneId of sceneIds) {
      assetIds.push(sceneId);
    }
    for (const propId of storyboard.prop_ids || []) {
      assetIds.push(propId);
    }
    await Promise.all(assetIds.map(async (assetId) => {
      try {
        const res = await generationApi.listImages(projectId, assetId);
        const imgs: any[] = res.data || [];
        const primary = imgs.find(i => i.is_primary) || imgs[0];
        if (primary) updates[assetId] = { asset_id: primary.volcengine_asset_id, status: primary.volcengine_asset_status, image_id: primary.image_id };
      } catch {}
    }));
    setAssetImageStatuses(prev => ({ ...prev, ...updates }));
  };

  // 当 initialTab 或 show 变化时重置 tab
  useEffect(() => {
    if (show) setActiveTab(initialTab);
  }, [show, initialTab]);

  // 当选择的资产变化时，补充加载新资产的 volcengine 状态
  useEffect(() => {
    if (!show) return;
    const allSelectedIds = [...selectedCharacters, ...selectedScenes, ...selectedProps];
    if (allSelectedIds.length === 0) return;
    // 构造一个临时 storyboard 对象，只包含当前选择的资产
    const tempSb = {
      character_ids: selectedCharacters,
      scene_ids: selectedScenes,
      prop_ids: selectedProps,
    };
    loadAssetImageStatuses(tempSb);
  }, [show, selectedCharacters.join(','), selectedScenes.join(','), selectedProps.join(',')]);

  // 弹框打开时加载关联资产的 volcengine 状态，并对非 Active 的已有 asset_id 自动轮询
  useEffect(() => {
    if (!show || !editingStoryboard) return;
    loadAssetImageStatuses(editingStoryboard);
    // 对主图中非 Active 的 asset_id 自动轮询一次，同步最新状态
    const autoSync = async () => {
      if (!onRefreshImages) return;
      const nonActiveImages = storyboardImages.filter(
        img => img.volcengine_asset_id && img.volcengine_asset_status !== 'Active'
      );
      if (nonActiveImages.length === 0) return;
      await Promise.all(nonActiveImages.map(img =>
        generationApi.getAssetStatus(projectId, img.volcengine_asset_id).catch(() => {})
      ));
      if (onRefreshImages) await onRefreshImages();
    };
    autoSync();
  }, [show, editingStoryboard?.asset_id]);

  // 当切换到 video tab 或弹框打开时初始化视频数据
  useEffect(() => {
    if (show && editingStoryboard && activeTab === 'video') {
      videoGen.initForStoryboard(editingStoryboard);
    }
  }, [show, activeTab, editingStoryboard?.asset_id, editingStoryboard?.video_prompt]);

  if (!show) return null;

  // 过滤隐藏的图片并排序（主图在前）
  const visibleStoryboardImages = storyboardImages
    .filter(img => !hiddenImageIds.has(img.image_id))
    .sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return 0;
    });

  // 共享的主图和 trackingId，确保 handleSubmitAsset 与两个 Tab 的渲染使用同一个 key
  const sharedPrimaryImg = visibleStoryboardImages.find(i => i.is_primary) || visibleStoryboardImages[0];
  const sharedTrackingId = sharedPrimaryImg?.image_id ?? editingStoryboard?.asset_id ?? '';

  const handleSubmitAsset = async () => {
    if (!editingStoryboard) return;
    const primaryImg = sharedPrimaryImg;

    // 收集所有需要提交的 image_id，以 selectedCharacters/Scenes/Props（当前UI选择）为准，
    // 而非 editingStoryboard 原始数据（用户在对话框内新增的资产不在原始数据中）
    // image_id 优先取 assetImageStatuses（API 刷新），兜底取 props 数组（可能陈旧但同步可用）
    const imageIds: string[] = [];
    if (primaryImg?.image_id) imageIds.push(primaryImg.image_id);
    for (const charId of selectedCharacters) {
      const imgId = assetImageStatuses[charId]?.image_id
        || characters.find((c: any) => c.asset_id === charId)?.image_id;
      if (imgId && !imageIds.includes(imgId)) imageIds.push(imgId);
    }
    for (const sceneId of selectedScenes) {
      const imgId = assetImageStatuses[sceneId]?.image_id
        || scenes.find((s: any) => s.asset_id === sceneId)?.image_id;
      if (imgId && !imageIds.includes(imgId)) imageIds.push(imgId);
    }
    for (const propId of selectedProps) {
      const imgId = assetImageStatuses[propId]?.image_id
        || props.find((p: any) => p.asset_id === propId)?.image_id;
      if (imgId && !imageIds.includes(imgId)) imageIds.push(imgId);
    }
    if (imageIds.length === 0) return;

    const trackingId = sharedTrackingId;
    setAssetSubmitting(prev => ({ ...prev, [trackingId]: true }));
    try {
      const res = await generationApi.submitAsset(projectId, imageIds);
      const submitted: { image_id: string; asset_id: string; status: string }[] = res.data.submitted || [];

      // 对每个 Processing 的 asset_id 轮询，直接用响应中的 asset_id，不依赖闭包
      const pollOne = async (assetId: string, imageId: string) => {
        try {
          const r = await generationApi.getAssetStatus(projectId, assetId);
          setAssetImageStatuses(prev => ({
            ...prev,
            [imageId]: { asset_id: assetId, status: r.data.status }
          }));
          if (r.data.status === 'Processing') {
            setTimeout(() => pollOne(assetId, imageId), 5000);
          }
        } catch {}
      };
      const processingItems = submitted.filter(s => s.status === 'Processing');
      const refreshAll = async () => {
        onSuccess();
        if (onRefreshImages) await onRefreshImages();
        await videoGen.loadPrimaryImage(editingStoryboard);
        loadAssetImageStatuses(editingStoryboard);
      };
      if (processingItems.length > 0) {
        setTimeout(async () => {
          await Promise.all(processingItems.map(s => pollOne(s.asset_id, s.image_id)));
          setAssetSubmitting(prev => ({ ...prev, [trackingId]: false }));
          await refreshAll();
        }, 3000);
      } else {
        setAssetSubmitting(prev => ({ ...prev, [trackingId]: false }));
        await refreshAll();
      }
    } catch (e) {
      setAssetSubmitting(prev => ({ ...prev, [trackingId]: false }));
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-[80vw] h-[95vh] overflow-y-auto">
        {/* 标题 + 关闭 */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">
            {isCreating ? `添加分镜 #${storyboardsCount + 1}` : `编辑分镜 - ${editingStoryboard?.sequence}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        {/* Tab 栏（仅编辑模式显示） */}
        {!isCreating && (
          <div className="flex border-b border-gray-700 mb-4">
            <button
              onClick={() => setActiveTab('edit')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === 'edit' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
            >
              编辑分镜
            </button>
            <button
              onClick={() => {
                setActiveTab('video');
                if (editingStoryboard) videoGen.initForStoryboard(editingStoryboard);
              }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === 'video' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
            >
              生成视频
            </button>
          </div>
        )}

        {/* 保存成功提示 */}
        {saveSuccess && activeTab === 'edit' && (
          <div className="mb-4 flex items-center gap-2 text-sm text-green-400 bg-green-900 bg-opacity-20 px-3 py-2 rounded">
            <CheckCircle size={16} />
            保存成功！
          </div>
        )}

        {/* ===== EDIT TAB ===== */}
        {activeTab === 'edit' && (
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
                <span className="text-xs text-gray-500">{contentExpanded ? '收起' : '展开'}</span>
              </button>

              {contentExpanded && (
                <div className="p-4 pt-0 space-y-3">
                  {/* 画面描述 */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">画面描述 *</label>
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      rows={6}
                      placeholder="描述画面内容..."
                    />
                  </div>

                  {/* 对白 + 动作 同行 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">对白</label>
                      <input
                        type="text"
                        value={editDialogue}
                        onChange={(e) => setEditDialogue(e.target.value)}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        placeholder="角色对白（如有）"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">动作</label>
                      <input
                        type="text"
                        value={editAction}
                        onChange={(e) => setEditAction(e.target.value)}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        placeholder="描述动作..."
                      />
                    </div>
                  </div>

                  {/* 镜头设置 - 4列：景别/角度/时长/分辨率 */}
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">景别</label>
                      <select
                        value={editShotType}
                        onChange={(e) => setEditShotType(e.target.value)}
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
                        onChange={(e) => setEditCameraAngle(e.target.value)}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="平视">平视</option>
                        <option value="仰视">仰视</option>
                        <option value="俯视">俯视</option>
                        <option value="鸟瞰">鸟瞰</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">时长（秒）</label>
                      <input
                        type="number"
                        value={editDuration}
                        onChange={(e) => setEditDuration(Math.max(1, parseInt(e.target.value) || 6))}
                        min={1}
                        max={60}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">分辨率</label>
                      <select
                        value={editResolution}
                        onChange={(e) => setEditResolution(e.target.value)}
                        className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="1920x1080">1920x1080</option>
                        <option value="1280x720">1280x720</option>
                        <option value="1080x1920">1080x1920</option>
                        <option value="720x1280">720x1280</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 选择资产 */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-semibold text-gray-400">
                  已选资产 ({selectedCharacters.length + selectedProps.length + selectedScenes.length})
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={onAutoMatchAssets}
                    disabled={!editingStoryboard || getTaskStatus(editingStoryboard.asset_id, 'auto_match') === 'generating'}
                    className="text-xs text-purple-400 hover:text-purple-300 disabled:text-gray-500 flex items-center gap-1"
                    title="根据分镜描述自动匹配资产"
                  >
                    {getTaskStatus(editingStoryboard?.asset_id, 'auto_match') === 'generating' ? (
                      <><RefreshCcw size={12} className="animate-spin" />匹配中...</>
                    ) : (
                      <><Sparkles size={12} />自动匹配</>
                    )}
                  </button>
                  <button
                    onClick={onOpenAssetSelector}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    <Plus size={12} />选择资产
                  </button>
                </div>
              </div>

              {(selectedCharacters.length > 0 || selectedProps.length > 0 || selectedScenes.length > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {selectedCharacters.map((charId) => {
                    const char = characters.find(c => c.asset_id === charId);
                    if (!char) return null;
                    const imgStatus = assetImageStatuses[charId]?.status;
                    return (
                      <div key={charId} className="flex items-center gap-2 bg-blue-900 text-blue-300 rounded px-3 py-2">
                        <span className="text-sm">{char.name}</span>
                        {imgStatus === 'Active' && <CheckCircle size={12} className="text-green-400" />}
                        {imgStatus === 'Processing' && <Loader2 size={12} className="text-yellow-400 animate-spin" />}
                        {imgStatus === 'Failed' && <span className="text-red-400 text-xs">!</span>}
                        <button onClick={() => setSelectedCharacters(selectedCharacters.filter(id => id !== charId))} className="text-red-400 hover:text-red-300">✕</button>
                      </div>
                    );
                  })}
                  {selectedScenes.map((sceneId) => {
                    const scene = scenes.find(s => s.asset_id === sceneId);
                    if (!scene) return null;
                    const imgStatus = assetImageStatuses[sceneId]?.status;
                    return (
                      <div key={sceneId} className="flex items-center gap-2 bg-green-900 text-green-300 rounded px-3 py-2">
                        <span className="text-sm">{scene.name}</span>
                        {imgStatus === 'Active' && <CheckCircle size={12} className="text-green-400" />}
                        {imgStatus === 'Processing' && <Loader2 size={12} className="text-yellow-400 animate-spin" />}
                        {imgStatus === 'Failed' && <span className="text-red-400 text-xs">!</span>}
                        <button onClick={() => setSelectedScenes(selectedScenes.filter(id => id !== sceneId))} className="text-red-400 hover:text-red-300">✕</button>
                      </div>
                    );
                  })}
                  {selectedProps.map((propId) => {
                    const prop = props.find(p => p.asset_id === propId);
                    if (!prop) return null;
                    const imgStatus = assetImageStatuses[propId]?.status;
                    return (
                      <div key={propId} className="flex items-center gap-2 bg-purple-900 text-purple-300 rounded px-3 py-2">
                        <span className="text-sm">{prop.name}</span>
                        {imgStatus === 'Active' && <CheckCircle size={12} className="text-green-400" />}
                        {imgStatus === 'Processing' && <Loader2 size={12} className="text-yellow-400 animate-spin" />}
                        {imgStatus === 'Failed' && <span className="text-red-400 text-xs">!</span>}
                        <button onClick={() => setSelectedProps(selectedProps.filter(id => id !== propId))} className="text-red-400 hover:text-red-300">✕</button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-gray-500 italic bg-gray-700 rounded p-3">未选择资产</div>
              )}
            </div>

            {/* AI生成提示词 */}
            <div className="border-t border-gray-700 pt-4">
              <div className="flex gap-2 mb-3">
                <button
                  onClick={onGeneratePrompt}
                  disabled={!editingStoryboard || getTaskStatus(editingStoryboard.asset_id, 'prompt') === 'generating'}
                  className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 px-4 py-2 rounded"
                >
                  <Wand2 size={16} />
                  {editingStoryboard && getTaskStatus(editingStoryboard.asset_id, 'prompt') === 'generating' ? '生成中...' : generatedPrompt ? '重新生成提示词' : 'AI生成提示词'}
                </button>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-semibold text-gray-400">图片提示词</label>
                </div>
                <textarea
                  value={generatedPrompt}
                  onChange={(e) => onImagePromptChange(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm resize-y min-h-[400px]"
                  placeholder="点击上方按钮生成AI提示词，或手动输入提示词..."
                />
              </div>
            </div>

            {/* 分镜图片集 */}
            {visibleStoryboardImages.length > 0 && (
              <div className="border-t border-gray-700 pt-4">
                <div className="flex items-center gap-4">
                  <h3 className="text-sm font-medium text-gray-300">已生成图片 ({visibleStoryboardImages.length})</h3>
                  <div className="flex items-center gap-2 flex-1">
                    <div onClick={onOpenImageGallery} className="flex items-center gap-2 cursor-pointer">
                      {visibleStoryboardImages.slice(0, 3).map((img) => (
                        <div key={img.image_id} className="relative group">
                          <img
                            src={getImageUrlProp(img).replace('/images/files/', '/thumbnails/')}
                            alt="分镜图片"
                            className="w-16 h-16 object-cover rounded-lg border-2 border-transparent hover:border-blue-500 transition"
                            loading="lazy"
                          />
                          {img.is_primary && (
                            <div className="absolute top-0 right-0 bg-blue-600 text-xs px-1 rounded-tl rounded-br">主</div>
                          )}
                        </div>
                      ))}
                      {visibleStoryboardImages.length > 3 && (
                        <div className="w-16 h-16 bg-gray-600 rounded-lg flex items-center justify-center text-gray-300 font-semibold border-2 border-transparent hover:border-blue-500 transition">
                          +{visibleStoryboardImages.length - 3}
                        </div>
                      )}
                    </div>
                    <button onClick={onOpenImageGallery} className="flex items-center gap-1 text-green-400 hover:text-green-300 text-sm ml-auto">
                      <ImagePlus size={14} />管理
                    </button>
                    {/* 提交素材按钮（主图） */}
                    {showAssetSubmit && (() => {
                      const primaryImg = sharedPrimaryImg;
                      if (!primaryImg) return null;
                      const isSubmitting = assetSubmitting[sharedTrackingId];

                      // 收集所有关联资产的 volcengine 状态，主图优先从 assetImageStatuses 读实时状态
                      const primaryImgStatus = primaryImg.image_id
                        ? (assetImageStatuses[primaryImg.image_id]?.status ?? primaryImg.volcengine_asset_status)
                        : primaryImg.volcengine_asset_status;
                      const allStatuses: (string | undefined)[] = [primaryImgStatus];
                      for (const charId of selectedCharacters) {
                        allStatuses.push(assetImageStatuses[charId]?.status);
                      }
                      for (const sceneId of selectedScenes) {
                        allStatuses.push(assetImageStatuses[sceneId]?.status);
                      }
                      for (const propId of selectedProps) {
                        allStatuses.push(assetImageStatuses[propId]?.status);
                      }

                      const anyFailed = allStatuses.some(s => s === 'Failed');
                      const anyProcessing = allStatuses.some(s => s === 'Processing');
                      const allActive = allStatuses.length > 0 && allStatuses.every(s => s === 'Active');

                      if (isSubmitting || anyProcessing) {
                        return <span className="text-xs text-yellow-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" />审核中...</span>;
                      }
                      if (allActive) {
                        return <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={12} />已入库</span>;
                      }
                      return (
                        <button
                          onClick={() => handleSubmitAsset()}
                          className={`text-xs flex items-center gap-1 ${anyFailed ? 'text-red-400 hover:text-red-300' : 'text-blue-400 hover:text-blue-300'}`}
                        >
                          <Upload size={12} />{anyFailed ? '部分失败，重试' : '提交素材'}
                        </button>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== VIDEO TAB ===== */}
        {activeTab === 'video' && editingStoryboard && (
          <VideoTab
            projectId={projectId}
            storyboard={editingStoryboard}
            episodeId={episodeId}
            contentExpanded={contentExpanded}
            setContentExpanded={setContentExpanded}
            editDescription={editDescription}
            setEditDescription={setEditDescription}
            editDialogue={editDialogue}
            setEditDialogue={setEditDialogue}
            editAction={editAction}
            setEditAction={setEditAction}
            editShotType={editShotType}
            setEditShotType={setEditShotType}
            editCameraAngle={editCameraAngle}
            setEditCameraAngle={setEditCameraAngle}
            editDuration={editDuration}
            setEditDuration={setEditDuration}
            editResolution={editResolution}
            setEditResolution={setEditResolution}
            videoGen={videoGen}
            onSuccess={onSuccess}
            onSaveBeforeGenerate={onSaveBeforeGenerate}
            multimodalReference={multimodalReference}
            assetSubmitting={assetSubmitting}
            assetImageStatuses={assetImageStatuses}
            characters={characters}
            scenes={scenes}
            props={props}
            selectedCharacters={selectedCharacters}
            setSelectedCharacters={setSelectedCharacters}
            selectedScenes={selectedScenes}
            setSelectedScenes={setSelectedScenes}
            selectedProps={selectedProps}
            setSelectedProps={setSelectedProps}
            onOpenAssetSelector={onOpenAssetSelector}
            onAutoMatchAssets={onAutoMatchAssets}
            handleSubmitAsset={handleSubmitAsset}
            showAssetSubmit={showAssetSubmit}
            submitTrackingId={sharedTrackingId}
            submitPrimaryImg={sharedPrimaryImg}
            getTaskStatus={getTaskStatus}
          />
        )}

        {/* 底部按钮 */}
        {activeTab === 'edit' && (
          <div className="flex justify-between gap-3 mt-6">
            <div className="flex gap-2 items-center">
              {isCreating ? (
                <button onClick={onSave} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 rounded">保存资产</button>
              ) : (
                <div className="flex items-center gap-1 text-xs h-[30px]">
                  {isSaving
                    ? <><Loader2 size={12} className="animate-spin text-gray-400" /><span className="text-gray-400">保存中...</span></>
                    : <span className="text-gray-500">关闭时自动保存</span>
                  }
                </div>
              )}
              <button
                onClick={onGenerateImage}
                disabled={!editingStoryboard || getTaskStatus(editingStoryboard.asset_id, 'image') === 'generating' || !generatedPrompt}
                className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-700 rounded flex items-center gap-1"
              >
                <ImagePlus size={14} />生成图片
              </button>
              <button
                onClick={onOpenImageEdit}
                disabled={!editingStoryboard || getTaskStatus(editingStoryboard.asset_id, 'image') === 'generating' || getTaskStatus(editingStoryboard.asset_id, 'image_edit') === 'generating'}
                className="px-3 py-1.5 text-sm bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 rounded flex items-center gap-1"
                title="基于参考图片编辑生成新图片"
              >
                <Edit3 size={14} />编辑图片
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onOpenTripleGridDialog}
                disabled={!editingStoryboard || hasRunningTask(editingStoryboard.asset_id) || storyboardImages.length === 0 || getTaskStatus(editingStoryboard?.asset_id, 'triple_grid') === 'generating'}
                className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 rounded flex items-center gap-1"
                title="使用当前主图生成三宫格分镜图"
              >
                {getTaskStatus(editingStoryboard?.asset_id, 'triple_grid') === 'generating' ? (
                  <RefreshCcw size={14} className="animate-spin" />
                ) : (
                  <Grid3X3 size={14} />
                )}
                生成三格
              </button>
              <button
                onClick={onSplitTripleGrid}
                disabled={!editingStoryboard || isSplittingTripleGrid || storyboardImages.length === 0}
                className="px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-gray-700 rounded flex items-center gap-1"
                title="将当前主图拆解为3个独立分镜"
              >
                {isSplittingTripleGrid ? <RefreshCcw size={14} className="animate-spin" /> : <Scissors size={14} />}
                拆解分镜
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== VideoTab 子组件 ===== */
interface VideoTabProps {
  projectId: string;
  storyboard: any;
  episodeId: string;
  contentExpanded: boolean;
  setContentExpanded: (v: boolean) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editDialogue: string;
  setEditDialogue: (v: string) => void;
  editAction: string;
  setEditAction: (v: string) => void;
  editShotType: string;
  setEditShotType: (v: string) => void;
  editCameraAngle: string;
  setEditCameraAngle: (v: string) => void;
  editDuration: number;
  setEditDuration: (v: number) => void;
  editResolution: string;
  setEditResolution: (v: string) => void;
  videoGen: ReturnType<typeof useVideoGeneration>;
  onSuccess: () => void;
  onSaveBeforeGenerate: () => Promise<void>;
  multimodalReference?: boolean;
  assetSubmitting: Record<string, boolean>;
  assetImageStatuses: Record<string, { asset_id?: string; status?: string; image_id?: string }>;
  characters: any[];
  scenes: any[];
  props: any[];
  selectedCharacters: string[];
  setSelectedCharacters: (v: string[]) => void;
  selectedScenes: string[];
  setSelectedScenes: (v: string[]) => void;
  selectedProps: string[];
  setSelectedProps: (v: string[]) => void;
  onOpenAssetSelector: () => void;
  onAutoMatchAssets: () => void;
  handleSubmitAsset: () => void;
  showAssetSubmit?: boolean;
  submitTrackingId: string;
  submitPrimaryImg?: any;
  getTaskStatus: (storyboardId: string, taskType: any) => string | null;
}

function VideoTab({
  projectId,
  storyboard,
  episodeId,
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
  editDuration,
  setEditDuration,
  editResolution,
  setEditResolution,
  videoGen,
  onSaveBeforeGenerate,
  multimodalReference = false,
  assetSubmitting,
  assetImageStatuses,
  characters,
  scenes,
  props,
  selectedCharacters,
  setSelectedCharacters,
  selectedScenes,
  setSelectedScenes,
  selectedProps,
  setSelectedProps,
  onOpenAssetSelector,
  onAutoMatchAssets,
  handleSubmitAsset,
  showAssetSubmit = false,
  submitTrackingId,
  submitPrimaryImg,
  getTaskStatus: getTaskStatusProp,
}: VideoTabProps) {
  const {
    videoPrompt,
    videoSegmentCount,
    primaryImage,
    videos,
    loadingVideos,
    isExporting,
    isDownloading,
    showVideoGallery,
    setShowVideoGallery,
    hasRunningTask,
    getTaskStatus,
    handlePromptChange,
    handleGenerateVideoPrompt,
    handleGenerateVideo,
    handleGenerateVideoSegment,
    handleExport,
    handleDownload,
    loadVideos,
  } = videoGen;

  const isGeneratingPrompt = getTaskStatus(storyboard.asset_id, 'video_prompt') === 'generating';
  const isGenerating = hasRunningTask(storyboard.asset_id);

  return (
    <div className="space-y-4">
      {/* 分镜内容 - 与编辑tab共用状态 */}
      <div className="bg-gray-700 rounded overflow-hidden">
        <button
          onClick={() => setContentExpanded(!contentExpanded)}
          className="w-full flex items-center justify-between p-3 hover:bg-gray-600 transition text-left"
        >
          <div className="flex items-center gap-2">
            {contentExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <h3 className="text-sm font-semibold text-gray-300">分镜内容</h3>
          </div>
          <span className="text-xs text-gray-500">{contentExpanded ? '收起' : '展开'}</span>
        </button>
        {contentExpanded && (
          <div className="p-4 pt-0 space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">画面描述 *</label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                rows={6}
                placeholder="描述画面内容..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">对白</label>
                <input
                  type="text"
                  value={editDialogue}
                  onChange={(e) => setEditDialogue(e.target.value)}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  placeholder="角色对白（如有）"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">动作</label>
                <input
                  type="text"
                  value={editAction}
                  onChange={(e) => setEditAction(e.target.value)}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  placeholder="描述动作..."
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">景别</label>
                <select
                  value={editShotType}
                  onChange={(e) => setEditShotType(e.target.value)}
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
                  onChange={(e) => setEditCameraAngle(e.target.value)}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="平视">平视</option>
                  <option value="仰视">仰视</option>
                  <option value="俯视">俯视</option>
                  <option value="鸟瞰">鸟瞰</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">时长（秒）</label>
                <input
                  type="number"
                  value={editDuration}
                  onChange={(e) => setEditDuration(Math.max(1, parseInt(e.target.value) || 6))}
                  min={1}
                  max={60}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">分辨率</label>
                <select
                  value={editResolution}
                  onChange={(e) => setEditResolution(e.target.value)}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="1920x1080">1920x1080</option>
                  <option value="1280x720">1280x720</option>
                  <option value="1080x1920">1080x1920</option>
                  <option value="720x1280">720x1280</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 已选资产 */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="block text-sm font-semibold text-gray-400">
            已选资产 ({selectedCharacters.length + selectedProps.length + selectedScenes.length})
          </label>
          <div className="flex gap-2">
            <button
              onClick={onAutoMatchAssets}
              disabled={getTaskStatusProp(storyboard.asset_id, 'auto_match') === 'generating'}
              className="text-xs text-purple-400 hover:text-purple-300 disabled:text-gray-500 flex items-center gap-1"
            >
              {getTaskStatusProp(storyboard.asset_id, 'auto_match') === 'generating' ? (
                <><RefreshCcw size={12} className="animate-spin" />匹配中...</>
              ) : (
                <><Sparkles size={12} />自动匹配</>
              )}
            </button>
            <button
              onClick={onOpenAssetSelector}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              <Plus size={12} />选择资产
            </button>
          </div>
        </div>
        {(selectedCharacters.length > 0 || selectedScenes.length > 0 || selectedProps.length > 0) ? (
          <div className="flex flex-wrap gap-2">
            {selectedCharacters.map((charId) => {
              const char = characters.find((c: any) => c.asset_id === charId);
              if (!char) return null;
              const imgStatus = assetImageStatuses[charId]?.status;
              return (
                <div key={charId} className="flex items-center gap-2 bg-blue-900 text-blue-300 rounded px-3 py-2">
                  <span className="text-sm">{char.name}</span>
                  {imgStatus === 'Active' && <CheckCircle size={12} className="text-green-400" />}
                  {imgStatus === 'Processing' && <Loader2 size={12} className="text-yellow-400 animate-spin" />}
                  {imgStatus === 'Failed' && <span className="text-red-400 text-xs">!</span>}
                  <button onClick={() => setSelectedCharacters(selectedCharacters.filter(id => id !== charId))} className="text-red-400 hover:text-red-300">✕</button>
                </div>
              );
            })}
            {selectedScenes.map((sceneId) => {
              const scene = scenes.find((s: any) => s.asset_id === sceneId);
              if (!scene) return null;
              const imgStatus = assetImageStatuses[sceneId]?.status;
              return (
                <div key={sceneId} className="flex items-center gap-2 bg-green-900 text-green-300 rounded px-3 py-2">
                  <span className="text-sm">{scene.name}</span>
                  {imgStatus === 'Active' && <CheckCircle size={12} className="text-green-400" />}
                  {imgStatus === 'Processing' && <Loader2 size={12} className="text-yellow-400 animate-spin" />}
                  {imgStatus === 'Failed' && <span className="text-red-400 text-xs">!</span>}
                  <button onClick={() => setSelectedScenes(selectedScenes.filter(id => id !== sceneId))} className="text-red-400 hover:text-red-300">✕</button>
                </div>
              );
            })}
            {selectedProps.map((propId) => {
              const prop = props.find((p: any) => p.asset_id === propId);
              if (!prop) return null;
              const imgStatus = assetImageStatuses[propId]?.status;
              return (
                <div key={propId} className="flex items-center gap-2 bg-purple-900 text-purple-300 rounded px-3 py-2">
                  <span className="text-sm">{prop.name}</span>
                  {imgStatus === 'Active' && <CheckCircle size={12} className="text-green-400" />}
                  {imgStatus === 'Processing' && <Loader2 size={12} className="text-yellow-400 animate-spin" />}
                  {imgStatus === 'Failed' && <span className="text-red-400 text-xs">!</span>}
                  <button onClick={() => setSelectedProps(selectedProps.filter(id => id !== propId))} className="text-red-400 hover:text-red-300">✕</button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-gray-500 italic bg-gray-700 rounded p-3">未选择资产</div>
        )}
      </div>

      {/* 已生成视频 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-gray-400">
            已生成视频 {videos.length > 0 ? `(${videos.length})` : ''}
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
            ) : videos.length === 0 ? (
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Video size={20} className="opacity-50" />
                <span>暂无视频</span>
              </div>
            ) : (
              <>
                {videos.slice(0, 3).map((video) => (
                  <div key={video.video_id} className="relative">
                    <div className="w-20 h-12 bg-gray-700 rounded-lg border-2 border-transparent hover:border-blue-500 transition flex items-center justify-center overflow-hidden">
                      {video.status === 'completed' && video.video_path ? (
                        <video
                          src={getVideoUrl(video, projectId)}
                          className="w-full h-full object-cover"
                          muted
                          preload="none"
                        />
                      ) : video.status === 'failed' ? (
                        <div className="text-red-400 text-xs">失败</div>
                      ) : (
                        <Loader2 size={16} className="animate-spin text-yellow-400" />
                      )}
                    </div>
                    {video.is_primary && (
                      <div className="absolute top-0 right-0 bg-blue-600 text-xs px-1 rounded-bl rounded-tr-lg">主</div>
                    )}
                    {video.status === 'completed' && (
                      <div className="absolute bottom-0 left-0 right-0 bg-green-600 bg-opacity-80 text-xs text-center">
                        <Play size={10} className="inline" />
                      </div>
                    )}
                  </div>
                ))}
                {videos.length > 3 && (
                  <div className="w-20 h-12 bg-gray-600 rounded-lg flex items-center justify-center text-gray-300 font-semibold">
                    +{videos.length - 3}
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setShowVideoGallery(true); }}
                  className="flex items-center gap-1 text-green-400 hover:text-green-300 text-sm ml-auto"
                >
                  <Video size={14} />管理
                </button>
              </>
            )}
          </div>
        </div>

      {/* 视频提示词 */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="block text-sm font-semibold text-gray-400">视频提示词</label>
          <div className="flex items-center gap-3">
            <button
              onClick={async () => { await onSaveBeforeGenerate(); handleGenerateVideoPrompt(storyboard, editDescription, editDialogue, editAction, editShotType, editCameraAngle, editDuration); }}
              disabled={isGeneratingPrompt || !editDescription}
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 disabled:text-gray-600"
            >
              {isGeneratingPrompt ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              {isGeneratingPrompt ? '生成中...' : 'AI生成提示词'}
            </button>
          </div>
        </div>
        {(() => {
          let promptSegments: string[] | null = null;
          try {
            const parsed = JSON.parse(videoPrompt);
            if (Array.isArray(parsed)) promptSegments = parsed as string[];
          } catch {}

          if (promptSegments) {
            return (
              <div className="space-y-3">
                {promptSegments.map((segment, idx) => (
                  <div key={idx}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs text-gray-400">第 {idx + 1} 段</div>
                      {multimodalReference && (
                        <button
                          onClick={async () => { await onSaveBeforeGenerate(); handleGenerateVideoSegment(storyboard, idx, editDuration, editResolution, editDescription, editDialogue, editAction, editShotType, editCameraAngle); }}
                          disabled={isGenerating || !primaryImage || !segment.trim()}
                          className="px-2 py-0.5 text-xs bg-green-700 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center gap-1"
                        >
                          <Film size={11} />生成此段
                        </button>
                      )}
                    </div>
                    <textarea
                      value={segment}
                      onChange={(e) => {
                        const newArr = [...promptSegments!];
                        newArr[idx] = e.target.value;
                        handlePromptChange(JSON.stringify(newArr));
                      }}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none min-h-[200px]"
                      rows={4}
                      placeholder={`第 ${idx + 1} 段提示词...`}
                    />
                  </div>
                ))}
              </div>
            );
          }

          return (
            <textarea
              value={videoPrompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              className="w-full h-[400px] bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
              placeholder="输入视频生成提示词，或点击右上角按钮AI生成..."
            />
          );
        })()}
      </div>

      {/* 生成中提示 */}
      {isGenerating && (
        <div className="bg-blue-900 bg-opacity-30 border border-blue-700 rounded p-3">
          <div className="flex items-center gap-2 text-blue-300">
            <Loader2 className="animate-spin" size={16} />
            <span className="text-sm">视频生成中，请耐心等待...（每30秒查询一次状态）</span>
          </div>
        </div>
      )}

      {/* 底部按钮 */}
      <div className="flex justify-between items-center gap-3 mt-4">
        <div className="flex gap-2">
          <button
            onClick={() => handleExport(storyboard)}
            disabled={isExporting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center gap-2"
            title="导出分镜主图、资产主图和视频提示词到桌面"
          >
            {isExporting ? <><Loader2 size={16} className="animate-spin" />导出中...</> : <><Download size={16} />导出</>}
          </button>
          <button
            onClick={() => handleDownload(storyboard)}
            disabled={isDownloading}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center gap-2"
            title="下载资源包（zip格式），包含分镜主图、资产主图和视频提示词"
          >
            {isDownloading ? <><Loader2 size={16} className="animate-spin" />下载中...</> : <><Download size={16} />下载资源</>}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {showAssetSubmit && (() => {
            const trackingId = submitTrackingId;
            const isSubmitting = assetSubmitting[trackingId];
            const allStatuses: (string | undefined)[] = [];
            // 优先用 submitPrimaryImg（来自 visibleStoryboardImages，始终最新）
            // 避免 videoGen.primaryImage 因未刷新而显示旧状态
            const primaryImgObj = submitPrimaryImg ?? (primaryImage as any);
            if (primaryImgObj?.image_id) {
              allStatuses.push(assetImageStatuses[primaryImgObj.image_id]?.status ?? primaryImgObj.volcengine_asset_status);
            } else if (primaryImgObj) {
              allStatuses.push(primaryImgObj.volcengine_asset_status);
            }
            for (const charId of selectedCharacters) {
              allStatuses.push(assetImageStatuses[charId]?.status);
            }
            for (const sceneId of selectedScenes) {
              allStatuses.push(assetImageStatuses[sceneId]?.status);
            }
            for (const propId of selectedProps) {
              allStatuses.push(assetImageStatuses[propId]?.status);
            }
            if (allStatuses.length === 0) return null;
            const anyFailed = allStatuses.some(s => s === 'Failed');
            const anyProcessing = allStatuses.some(s => s === 'Processing');
            const allActive = allStatuses.every(s => s === 'Active');

            if (isSubmitting || anyProcessing) {
              return <span className="text-sm text-yellow-400 flex items-center gap-1"><Loader2 size={14} className="animate-spin" />审核中...</span>;
            }
            if (allActive) {
              return <span className="text-sm text-green-400 flex items-center gap-1"><CheckCircle size={14} />已入库</span>;
            }
            return (
              <button
                onClick={handleSubmitAsset}
                className={`px-4 py-2 rounded flex items-center gap-2 ${anyFailed ? 'bg-red-700 hover:bg-red-600' : 'bg-orange-600 hover:bg-orange-700'}`}
              >
                <Upload size={16} />{anyFailed ? '部分失败，重试' : '提交素材'}
              </button>
            );
          })()}
          <button
            onClick={async () => { await onSaveBeforeGenerate(); handleGenerateVideo(storyboard, editDuration, editResolution, editDescription, editDialogue, editAction, editShotType, editCameraAngle); }}
            disabled={isGenerating || !videoPrompt.trim()}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center gap-2"
          >
            {isGenerating ? <><Loader2 size={16} className="animate-spin" />生成中...</> : <><Film size={16} />{multimodalReference && videoSegmentCount > 1 ? `生成全部 ${videoSegmentCount} 段（各15秒）` : '生成视频'}</>}
          </button>
        </div>
      </div>

      {/* 视频库弹框 */}
      {showVideoGallery && (
        <VideoGallery
          projectId={projectId}
          storyboardId={storyboard.asset_id}
          episodeId={episodeId}
          onClose={() => { setShowVideoGallery(false); loadVideos(storyboard); }}
        />
      )}
    </div>
  );
}
