import { useState } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  User,
  Package,
  MapPin,
  Film,
  Sparkles,
  Boxes,
  Network,
} from 'lucide-react';
import { useCanvasStore } from '@/store/canvasStore';
import { useToast } from '@/components/common/Toast';
import type { Canvas } from '@/types/canvas';

type CanvasViewMode = 'asset' | 'workflow';

interface CanvasToolbarProps {
  projectId: string;
  mode: CanvasViewMode;
  onModeChange: (mode: CanvasViewMode) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  visibleTypes: {
    character: boolean;
    prop: boolean;
    scene: boolean;
    storyboard: boolean;
    canvas_element: boolean;
  };
  onToggleType: (type: keyof CanvasToolbarProps['visibleTypes']) => void;
}

export function CanvasToolbar({
  projectId,
  mode,
  onModeChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  visibleTypes,
  onToggleType,
}: CanvasToolbarProps) {
  const { toast } = useToast();
  const { canvasList, activeCanvasId, setActiveCanvas, createCanvas, deleteCanvas, updateCanvas } = useCanvasStore();
  const [isCreating, setIsCreating] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState('');
  const [editingCanvasId, setEditingCanvasId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleCreateCanvas = async () => {
    if (!newCanvasName.trim()) {
      toast('请输入画布名称', 'error');
      return;
    }

    const canvas = await createCanvas(projectId, newCanvasName.trim());
    if (canvas) {
      toast('画布创建成功', 'success');
      setIsCreating(false);
      setNewCanvasName('');
    } else {
      toast('画布创建失败', 'error');
    }
  };

  const handleDeleteCanvas = async (canvasId: string) => {
    if (canvasList.length <= 1) {
      toast('至少需要保留一个画布', 'error');
      return;
    }

    if (!confirm('确定删除此画布？')) return;

    await deleteCanvas(projectId, canvasId);
    toast('画布已删除', 'success');
  };

  const handleRenameCanvas = async (canvasId: string) => {
    if (!editingName.trim()) {
      toast('请输入画布名称', 'error');
      return;
    }

    await updateCanvas(projectId, canvasId, { name: editingName.trim() });
    toast('画布重命名成功', 'success');
    setEditingCanvasId(null);
    setEditingName('');
  };

  const startEditing = (canvas: Canvas) => {
    setEditingCanvasId(canvas.canvas_id);
    setEditingName(canvas.name);
  };

  return (
    <div className="bg-gray-800 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2 flex-1 overflow-x-auto">
        {canvasList.map(canvas => (
          <div
            key={canvas.canvas_id}
            className={`flex items-center gap-2 px-3 py-1 rounded cursor-pointer transition ${
              canvas.canvas_id === activeCanvasId ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {editingCanvasId === canvas.canvas_id ? (
              <input
                type="text"
                value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onBlur={() => handleRenameCanvas(canvas.canvas_id)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameCanvas(canvas.canvas_id);
                  if (e.key === 'Escape') {
                    setEditingCanvasId(null);
                    setEditingName('');
                  }
                }}
                className="bg-gray-900 text-white px-2 py-0.5 rounded text-sm w-24"
                autoFocus
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <>
                <span onClick={() => setActiveCanvas(canvas.canvas_id)} className="text-sm">
                  {canvas.name}
                </span>
                {canvas.canvas_id === activeCanvasId && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        startEditing(canvas);
                      }}
                      className="p-0.5 hover:bg-blue-700 rounded"
                      title="重命名"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDeleteCanvas(canvas.canvas_id);
                      }}
                      className="p-0.5 hover:bg-red-600 rounded"
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {isCreating ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newCanvasName}
              onChange={e => setNewCanvasName(e.target.value)}
              onBlur={handleCreateCanvas}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateCanvas();
                if (e.key === 'Escape') {
                  setIsCreating(false);
                  setNewCanvasName('');
                }
              }}
              placeholder="画布名称"
              className="bg-gray-900 text-white px-2 py-1 rounded text-sm w-32"
              autoFocus
            />
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            title="创建新画布"
          >
            <Plus size={14} />
            新建
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 ml-4">
        <div className="flex items-center bg-gray-700 rounded p-0.5">
          <button
            onClick={() => onModeChange('asset')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition ${
              mode === 'asset' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-600'
            }`}
            title="资产画布模式"
          >
            <Boxes size={14} />
            资产模式
          </button>
          <button
            onClick={() => onModeChange('workflow')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition ${
              mode === 'workflow' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-600'
            }`}
            title="工作流节点模式"
          >
            <Network size={14} />
            工作流模式
          </button>
        </div>

        {mode === 'asset' && (
          <>
            <button
              onClick={() => onToggleType('character')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition ${
                visibleTypes.character ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 opacity-50'
              }`}
              title="切换角色显示"
            >
              <User size={14} />
              角色
            </button>
            <button
              onClick={() => onToggleType('prop')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition ${
                visibleTypes.prop ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 opacity-50'
              }`}
              title="切换道具显示"
            >
              <Package size={14} />
              道具
            </button>
            <button
              onClick={() => onToggleType('scene')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition ${
                visibleTypes.scene ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 opacity-50'
              }`}
              title="切换场景显示"
            >
              <MapPin size={14} />
              场景
            </button>
            <button
              onClick={() => onToggleType('storyboard')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition ${
                visibleTypes.storyboard ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 opacity-50'
              }`}
              title="切换分镜显示"
            >
              <Film size={14} />
              分镜
            </button>
            <button
              onClick={() => onToggleType('canvas_element')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition ${
                visibleTypes.canvas_element ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 opacity-50'
              }`}
              title="切换融合元素显示"
            >
              <Sparkles size={14} />
              融合
            </button>
          </>
        )}

        <div className="w-px h-6 bg-gray-600 mx-1"></div>

        <button onClick={onZoomOut} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded" title="缩小">
          <ZoomOut size={16} />
        </button>
        <button onClick={onZoomReset} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded" title="重置缩放">
          <Maximize2 size={16} />
        </button>
        <button onClick={onZoomIn} className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded" title="放大">
          <ZoomIn size={16} />
        </button>
      </div>
    </div>
  );
}
