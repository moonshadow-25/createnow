import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Film, Trash2, ZoomIn, Images, Check, CheckCircle, Loader2 } from 'lucide-react';

// 可排序的分镜卡片组件
export interface SortableStoryboardCardProps {
  storyboard: any;
  storyboardPrimaryImages: Map<string, string>;
  imageStatuses?: Record<string, { asset_id: string; status: string }>;
  onEdit: (sb: any) => void;
  onDelete: (id: string) => void;
  onOpenImageGallery?: (sb: any) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function SortableStoryboardCard({
  storyboard,
  storyboardPrimaryImages,
  imageStatuses = {},
  onEdit,
  onDelete,
  onOpenImageGallery,
  isSelected = false,
  onToggleSelect
}: SortableStoryboardCardProps) {
  const imageStatus = storyboard.volcengine_asset_status || (storyboard.image_id ? imageStatuses[storyboard.image_id]?.status : undefined);
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
      {/* 拖拽手柄 - 左上角 */}
      <div
        {...attributes}
        {...listeners}
        className="absolute top-2 left-2 z-10 cursor-grab active:cursor-grabbing bg-gray-900 bg-opacity-70 rounded p-1"
      >
        <GripVertical size={16} className="text-gray-400" />
      </div>

      {/* 选中按钮 - 右上角 */}
      {onToggleSelect && (
        <button
          onClick={e => { e.stopPropagation(); onToggleSelect(storyboard.asset_id); }}
          className={`absolute top-1 right-1 z-10 w-7 h-7 rounded border-2 flex items-center justify-center transition-all ${
            isSelected
              ? 'opacity-100 bg-blue-500 border-blue-500 text-white'
              : 'opacity-0 group-hover:opacity-100 border-gray-300 bg-gray-900 bg-opacity-70 text-transparent hover:border-white'
          }`}
          title={isSelected ? '取消选中' : '选中'}
        >
          {isSelected && <Check size={14} />}
        </button>
      )}

      {/* 图片区域 - 点击进入编辑页 */}
      <div className="relative">
        {storyboardPrimaryImages.has(storyboard.asset_id) ? (
          <img
            src={storyboardPrimaryImages.get(storyboard.asset_id)!.replace('/images/files/', '/thumbnails/')}
            alt={storyboard.description}
            className="w-full aspect-video object-cover cursor-pointer hover:opacity-90 transition"
            loading="lazy"
            onClick={() => onEdit(storyboard)}
          />
        ) : storyboard.primary_video_thumbnail_url ? (
          <img
            src={storyboard.primary_video_thumbnail_url}
            alt={storyboard.description}
            className="w-full aspect-video object-cover cursor-pointer hover:opacity-90 transition"
            loading="lazy"
            onClick={() => onEdit(storyboard)}
          />
        ) : (
          <div
            className="w-full aspect-video bg-gray-600 flex items-center justify-center cursor-pointer hover:bg-gray-500 transition"
            onClick={() => onEdit(storyboard)}
          >
            <Film size={32} className="text-gray-500" />
          </div>
        )}

        {/* 审核状态角标 - 图片区左下角 */}
        {imageStatus === 'Active' && (
          <div className="absolute bottom-2 left-2 bg-gray-900 bg-opacity-70 rounded px-1.5 py-0.5 flex items-center gap-1">
            <CheckCircle size={12} className="text-green-400" />
            <span className="text-xs text-green-400">已入库</span>
          </div>
        )}
        {imageStatus === 'Processing' && (
          <div className="absolute bottom-2 left-2 bg-gray-900 bg-opacity-70 rounded px-1.5 py-0.5 flex items-center gap-1">
            <Loader2 size={12} className="animate-spin text-yellow-400" />
            <span className="text-xs text-yellow-400">审核中</span>
          </div>
        )}

        {/* 图片库按钮 - 图片区右下角 */}
        {onOpenImageGallery && (
          <button
            onClick={e => { e.stopPropagation(); onOpenImageGallery(storyboard); }}
            className="absolute bottom-2 right-2 bg-gray-900 bg-opacity-70 rounded p-1 text-gray-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
            title={storyboardPrimaryImages.has(storyboard.asset_id) ? '查看图片库' : '打开图片库'}
          >
            {storyboardPrimaryImages.has(storyboard.asset_id) ? <ZoomIn size={16} /> : <Images size={16} />}
          </button>
        )}
      </div>

      {/* 文字内容区 */}
      <div className="p-3">
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-400 mb-1">
              分镜 {storyboard.sequence} - {storyboard.shot_type} · {storyboard.camera_angle}
            </div>
            <div className="font-medium text-sm truncate">{storyboard.description}</div>
            {storyboard.dialogue && (
              <div className="text-xs text-gray-300 mt-1 italic truncate">"{storyboard.dialogue}"</div>
            )}
          </div>
          <button
            onClick={() => onDelete(storyboard.asset_id)}
            className="text-red-400 hover:text-red-300 p-1 flex-shrink-0"
            title="删除分镜"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
