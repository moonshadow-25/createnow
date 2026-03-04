import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Plus, Wand2, ImagePlus, Edit3, Grid3X3, Scissors, RefreshCcw, CheckCircle, Sparkles, Film, Loader2, Eye, Download, Video, Play } from 'lucide-react';
import { assetApi } from '@/services/api';
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
  selectedScene: string;
  setSelectedScene: (v: string) => void;
  characters: any[];
  scenes: any[];
  props: any[];
  onOpenAssetSelector: () => void;
  onAutoMatchAssets: () => void;

  // 提示词
  generatedPrompt: string;
  setGeneratedPrompt: (v: string) => void;
  onGeneratePrompt: () => void;
  onGenerateNineGridPrompts: () => void;

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
  selectedScene,
  setSelectedScene,
  characters,
  scenes,
  props,
  onOpenAssetSelector,
  onAutoMatchAssets,
  generatedPrompt,
  setGeneratedPrompt,
  onGeneratePrompt,
  onGenerateNineGridPrompts,
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
}: StoryboardEditDialogProps) {
  const [activeTab, setActiveTab] = useState<'edit' | 'video'>(initialTab);

  // 当 initialTab 或 show 变化时重置 tab
  useEffect(() => {
    if (show) setActiveTab(initialTab);
  }, [show, initialTab]);

  const videoGen = useVideoGeneration({ projectId, episodeId, onSuccess });

  // 当切换到 video tab 或弹框打开时初始化视频数据
  useEffect(() => {
    if (show && editingStoryboard && activeTab === 'video') {
      videoGen.initForStoryboard(editingStoryboard);
    }
  }, [show, activeTab, editingStoryboard?.asset_id]);

  if (!show) return null;

  // 过滤隐藏的图片并排序（主图在前）
  const visibleStoryboardImages = storyboardImages
    .filter(img => !hiddenImageIds.has(img.image_id))
    .sort((a, b) => {
      if (a.is_primary && !b.is_primary) return -1;
      if (!a.is_primary && b.is_primary) return 1;
      return 0;
    });

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
                  已选资产 ({selectedCharacters.length + selectedProps.length + (selectedScene ? 1 : 0)})
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

              {(selectedCharacters.length > 0 || selectedProps.length > 0 || selectedScene) ? (
                <div className="flex flex-wrap gap-2">
                  {selectedCharacters.map((charId) => {
                    const char = characters.find(c => c.asset_id === charId);
                    if (!char) return null;
                    return (
                      <div key={charId} className="flex items-center gap-2 bg-blue-900 text-blue-300 rounded px-3 py-2">
                        <span className="text-sm">{char.name}</span>
                        <button onClick={() => setSelectedCharacters(selectedCharacters.filter(id => id !== charId))} className="text-red-400 hover:text-red-300">✕</button>
                      </div>
                    );
                  })}
                  {selectedScene && (() => {
                    const scene = scenes.find(s => s.asset_id === selectedScene);
                    if (!scene) return null;
                    return (
                      <div className="flex items-center gap-2 bg-green-900 text-green-300 rounded px-3 py-2">
                        <span className="text-sm">{scene.name}</span>
                        <button onClick={() => setSelectedScene('')} className="text-red-400 hover:text-red-300">✕</button>
                      </div>
                    );
                  })()}
                  {selectedProps.map((propId) => {
                    const prop = props.find(p => p.asset_id === propId);
                    if (!prop) return null;
                    return (
                      <div key={propId} className="flex items-center gap-2 bg-purple-900 text-purple-300 rounded px-3 py-2">
                        <span className="text-sm">{prop.name}</span>
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
                <button
                  onClick={onGenerateNineGridPrompts}
                  disabled={!editingStoryboard || getTaskStatus(editingStoryboard.asset_id, 'nine_grid') === 'generating'}
                  className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-700 px-4 py-2 rounded"
                >
                  <Grid3X3 size={16} />
                  {getTaskStatus(editingStoryboard?.asset_id, 'nine_grid') === 'generating' ? '生成中...' : '生成九宫格提示词'}
                </button>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-semibold text-gray-400">图片提示词</label>
                  {generatedPrompt && <span className="text-xs text-gray-500">✓ 已保存到分镜中</span>}
                </div>
                <textarea
                  value={generatedPrompt}
                  onChange={(e) => {
                    const newPrompt = e.target.value;
                    setGeneratedPrompt(newPrompt);
                    if (editingStoryboard) {
                      assetApi.update(projectId, 'storyboard', editingStoryboard.asset_id, {
                        image_prompt: newPrompt || undefined
                      }).catch(console.error);
                    }
                  }}
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
          />
        )}

        {/* 底部按钮 */}
        {activeTab === 'edit' && (
          <div className="flex justify-between gap-3 mt-6">
            <div className="flex gap-2">
              <button onClick={onSave} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 rounded">保存资产</button>
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
}: VideoTabProps) {
  const {
    videoPrompt,
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
    handleReverseVideoPrompt,
    handleGenerateVideo,
    handleExport,
    handleDownload,
    loadVideos,
  } = videoGen;

  const isGeneratingPrompt = getTaskStatus(storyboard.asset_id, 'video_prompt') === 'generating';
  const isReversingPrompt = getTaskStatus(storyboard.asset_id, 'video_reverse') === 'generating';
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
                  onChange={(e) => videoGen.handleDurationChange(Math.max(1, parseInt(e.target.value) || 6), storyboard, setEditDuration)}
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
              onClick={() => handleGenerateVideoPrompt(storyboard, editDescription, editDialogue, editAction, editShotType, editCameraAngle, editDuration)}
              disabled={isGeneratingPrompt || isReversingPrompt || !editDescription}
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 disabled:text-gray-600"
            >
              {isGeneratingPrompt ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
              {isGeneratingPrompt ? '生成中...' : 'AI生成提示词'}
            </button>
            <button
              onClick={() => handleReverseVideoPrompt(storyboard, editDescription, editDialogue, editAction, editShotType, editCameraAngle, editDuration)}
              disabled={isReversingPrompt || isGeneratingPrompt || !primaryImage}
              className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 disabled:text-gray-600"
              title={!primaryImage ? '需要先生成分镜图' : '根据分镜图反推提示词'}
            >
              {isReversingPrompt ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
              {isReversingPrompt ? '反推中...' : 'AI反推提示词'}
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
                    <div className="text-xs text-gray-400 mb-1">第 {idx + 1} 段</div>
                    <textarea
                      value={segment}
                      onChange={(e) => {
                        const newArr = [...promptSegments!];
                        newArr[idx] = e.target.value;
                        handlePromptChange(JSON.stringify(newArr), storyboard);
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
              onChange={(e) => handlePromptChange(e.target.value, storyboard)}
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
        <button
          onClick={() => handleGenerateVideo(storyboard, editDuration, editResolution, editDescription, editDialogue, editAction, editShotType, editCameraAngle)}
          disabled={isGenerating || !primaryImage || !videoPrompt.trim()}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center gap-2"
        >
          {isGenerating ? <><Loader2 size={16} className="animate-spin" />生成中...</> : <><Film size={16} />生成视频</>}
        </button>
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
