import { ChevronDown, ChevronRight, Plus, Wand2, ImagePlus, Edit3, Grid3X3, Scissors, RefreshCcw, CheckCircle } from 'lucide-react';
import { assetApi } from '@/services/api';

export interface StoryboardEditDialogProps {
  show: boolean;
  isCreating: boolean;
  storyboardsCount: number;
  editingStoryboard: any;
  projectId: string;

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

  // 提示词
  generatedPrompt: string;
  setGeneratedPrompt: (v: string) => void;
  onGeneratePrompt: () => void;

  // 图片
  storyboardImages: any[];
  hiddenImageIds: Set<string>;
  getImageUrl: (img: any) => string;
  onOpenImageGallery: () => void;

  // 任务状态
  getTaskStatus: (storyboardId: string, taskType: 'prompt' | 'image' | 'video' | 'auto_generate' | 'image_edit' | 'triple_grid') => string | null;
  hasRunningTask: (storyboardId?: string) => boolean;

  // 操作
  onSave: () => void;
  onGenerateImage: () => void;
  onOpenImageEdit: () => void;
  onOpenTripleGridDialog: () => void;
  isSplittingTripleGrid: boolean;
  onSplitTripleGrid: () => void;
  onClose: () => void;
}

export function StoryboardEditDialog({
  show,
  isCreating,
  storyboardsCount,
  editingStoryboard,
  projectId,
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
  generatedPrompt,
  setGeneratedPrompt,
  onGeneratePrompt,
  storyboardImages,
  hiddenImageIds,
  getImageUrl,
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
}: StoryboardEditDialogProps) {
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
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">
            {isCreating ? `添加分镜 #${storyboardsCount + 1}` : `编辑分镜 - ${editingStoryboard?.sequence}`}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
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
                {contentExpanded ? '收起' : '展开'}
              </span>
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
                    onChange={(e) => setEditDialogue(e.target.value)}
                    className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    placeholder="角色对白（如有）"
                  />
                </div>

                {/* 动作 */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">动作</label>
                  <textarea
                    value={editAction}
                    onChange={(e) => setEditAction(e.target.value)}
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
                </div>
              </div>
            )}
          </div>

          {/* 选择资产 - 统一入口 */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-semibold text-gray-400">
                已选资产 ({selectedCharacters.length + selectedProps.length + (selectedScene ? 1 : 0)})
              </label>
              <button
                onClick={onOpenAssetSelector}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Plus size={12} />
                选择资产
              </button>
            </div>

            {/* 显示已选择的资产标签 */}
            {(selectedCharacters.length > 0 || selectedProps.length > 0 || selectedScene) ? (
              <div className="flex flex-wrap gap-2">
                {/* 角色标签 - 蓝色 */}
                {selectedCharacters.map((charId) => {
                  const char = characters.find(c => c.asset_id === charId);
                  if (!char) return null;
                  return (
                    <div key={charId} className="flex items-center gap-2 bg-blue-900 text-blue-300 rounded px-3 py-2">
                      <span className="text-sm">{char.name}</span>
                      <button
                        onClick={() => setSelectedCharacters(selectedCharacters.filter(id => id !== charId))}
                        className="text-red-400 hover:text-red-300"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                {/* 场景标签 - 绿色 */}
                {selectedScene && (() => {
                  const scene = scenes.find(s => s.asset_id === selectedScene);
                  if (!scene) return null;
                  return (
                    <div className="flex items-center gap-2 bg-green-900 text-green-300 rounded px-3 py-2">
                      <span className="text-sm">{scene.name}</span>
                      <button
                        onClick={() => setSelectedScene('')}
                        className="text-red-400 hover:text-red-300"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })()}
                {/* 道具标签 - 紫色 */}
                {selectedProps.map((propId) => {
                  const prop = props.find(p => p.asset_id === propId);
                  if (!prop) return null;
                  return (
                    <div key={propId} className="flex items-center gap-2 bg-purple-900 text-purple-300 rounded px-3 py-2">
                      <span className="text-sm">{prop.name}</span>
                      <button
                        onClick={() => setSelectedProps(selectedProps.filter(id => id !== propId))}
                        className="text-red-400 hover:text-red-300"
                      >
                        ✕
                      </button>
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
            <button
              onClick={onGeneratePrompt}
              disabled={!editingStoryboard || getTaskStatus(editingStoryboard.asset_id, 'prompt') === 'generating'}
              className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 px-4 py-2 rounded mb-3"
            >
              <Wand2 size={16} />
              {editingStoryboard && getTaskStatus(editingStoryboard.asset_id, 'prompt') === 'generating' ? '生成中...' : generatedPrompt ? '重新生成提示词' : 'AI生成提示词'}
            </button>

            {/* 始终显示提示词输入框 */}
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
                  // 实时保存到分镜
                  if (editingStoryboard) {
                    assetApi.update(projectId, 'storyboard', editingStoryboard.asset_id, {
                      image_prompt: newPrompt || undefined
                    }).catch(console.error);
                  }
                }}
                className="w-full h-64 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm resize-none"
                placeholder="点击上方按钮生成AI提示词，或手动输入提示词..."
              />
            </div>
          </div>

          {/* 分镜图片集 - 单行显示，最多3张图片 */}
          {visibleStoryboardImages.length > 0 && (
            <div className="border-t border-gray-700 pt-4">
              <div className="flex items-center gap-4">
                <h3 className="text-sm font-medium text-gray-300">
                  已生成图片 ({visibleStoryboardImages.length})
                </h3>
                <div className="flex items-center gap-2 flex-1">
                  {/* 图片预览区 - 可点击打开图片库 */}
                  <div
                    onClick={onOpenImageGallery}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    {visibleStoryboardImages.slice(0, 3).map((img) => (
                      <div key={img.image_id} className="relative group">
                        <img
                          src={getImageUrl(img)}
                          alt={`分镜图片`}
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
                    {/* 更多图片计数 */}
                    {visibleStoryboardImages.length > 3 && (
                      <div className="w-16 h-16 bg-gray-600 rounded-lg flex items-center justify-center text-gray-300 font-semibold border-2 border-transparent hover:border-blue-500 transition">
                        +{visibleStoryboardImages.length - 3}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={onOpenImageGallery}
                    className="flex items-center gap-1 text-green-400 hover:text-green-300 text-sm ml-auto"
                  >
                    <ImagePlus size={14} />
                    管理
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-3 mt-6">
          <div className="flex gap-2">
            <button
              onClick={onSave}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 rounded"
            >
              保存资产
            </button>
            <button
              onClick={onGenerateImage}
              disabled={!editingStoryboard || hasRunningTask(editingStoryboard.asset_id) || !generatedPrompt}
              className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-700 rounded flex items-center gap-1"
            >
              <ImagePlus size={14} />
              生成图片
            </button>
            <button
              onClick={onOpenImageEdit}
              disabled={!editingStoryboard || hasRunningTask(editingStoryboard.asset_id)}
              className="px-3 py-1.5 text-sm bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 rounded flex items-center gap-1"
              title="基于参考图片编辑生成新图片"
            >
              <Edit3 size={14} />
              编辑图片
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
              {isSplittingTripleGrid ? (
                <RefreshCcw size={14} className="animate-spin" />
              ) : (
                <Scissors size={14} />
              )}
              拆解分镜
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
