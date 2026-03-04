import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Film, Edit, Edit3, Trash2, ZoomIn, Images } from 'lucide-react';

// 可排序的分镜卡片组件
export interface SortableStoryboardCardProps {
  storyboard: any;
  storyboardPrimaryImages: Map<string, string>;
  onEdit: (sb: any) => void;
  onEditImage: (sb: any) => void;
  onGenerateVideo: (sb: any) => void;
  onDelete: (id: string) => void;
  onOpenImageGallery?: (sb: any) => void;
  hasRunningTask: (storyboardId?: string) => boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function SortableStoryboardCard({
  storyboard,
  storyboardPrimaryImages,
  onEdit,
  onEditImage,
  onGenerateVideo,
  onDelete,
  onOpenImageGallery,
  hasRunningTask,
  isSelected = false,
  onToggleSelect
}: SortableStoryboardCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: storyboard.asset_id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-gray-700 rounded overflow-hidden relative group ${
        isSelected ? 'ring-2 ring-blue-500' : ''
      }`}
    >
      {/* 拖拽手柄 */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-2 left-2 z-10 cursor-grab active:cursor-grabbing bg-gray-900 bg-opacity-70 rounded p-1"
      >
        <GripVertical size={16} className="text-gray-400" />
      </div>

      {/* 图片库按钮 - 右上角，有无图片均显示 */}
      {onOpenImageGallery && (
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={(e) => { e.stopPropagation(); onOpenImageGallery(storyboard); }}
            className="bg-gray-900 bg-opacity-70 rounded p-1 text-gray-300 hover:text-white"
            title={storyboardPrimaryImages.has(storyboard.asset_id) ? "查看图片库" : "打开图片库"}
          >
            {storyboardPrimaryImages.has(storyboard.asset_id)
              ? <ZoomIn size={16} />
              : <Images size={16} />}
          </button>
        </div>
      )}

      {/* 主图显示 */}
      {storyboardPrimaryImages.has(storyboard.asset_id) ? (
        <img
          src={storyboardPrimaryImages.get(storyboard.asset_id)!.replace('/images/files/', '/thumbnails/')}
          alt={storyboard.description}
          className={`w-full aspect-video object-cover cursor-pointer hover:opacity-90 transition ${isSelected ? 'opacity-75' : ''}`}
          loading="lazy"
          onClick={() => onToggleSelect?.(storyboard.asset_id)}
        />
      ) : (
        <div
          className="w-full aspect-video bg-gray-600 flex items-center justify-center cursor-pointer hover:bg-gray-500 transition"
          onClick={() => onToggleSelect?.(storyboard.asset_id)}
        >
          <Film size={32} className="text-gray-500" />
        </div>
      )}

      {/* 内容覆盖层 */}
      <div className="p-3">
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-400 mb-1">分镜 {storyboard.sequence} - {storyboard.shot_type} · {storyboard.camera_angle}</div>
            <div className="font-medium text-sm truncate">{storyboard.description}</div>
            {storyboard.dialogue && (
              <div className="text-xs text-gray-300 mt-1 italic truncate">"{storyboard.dialogue}"</div>
            )}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => onEdit(storyboard)}
              className="text-purple-400 hover:text-purple-300 p-1"
              title="编辑分镜"
            >
              <Edit size={14} />
            </button>
            <button
              onClick={() => onEditImage(storyboard)}
              className="text-orange-400 hover:text-orange-300 p-1"
              title="编辑图片"
              disabled={hasRunningTask(storyboard.asset_id)}
            >
              <Edit3 size={14} />
            </button>
            <button
              onClick={() => onGenerateVideo(storyboard)}
              className="text-green-400 hover:text-green-300 p-1"
              title="生成视频"
              disabled={hasRunningTask(storyboard.asset_id)}
            >
              <Film size={14} />
            </button>
            <button
              onClick={() => onDelete(storyboard.asset_id)}
              className="text-red-400 hover:text-red-300 p-1"
              title="删除分镜"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
