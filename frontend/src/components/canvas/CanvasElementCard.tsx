import { Sparkles, X } from 'lucide-react';
import { BORDER_COLORS } from '@/types/canvas';
import type { CanvasElementData } from '@/types/canvas';

interface CanvasElementCardProps {
  element: CanvasElementData;
  isSelected: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onMouseDown: (e: React.MouseEvent, element: CanvasElementData) => void;
  onRemove: (elementId: string) => void;
}

export function CanvasElementCard({
  element,
  isSelected,
  onSelect,
  onMouseDown,
  onRemove
}: CanvasElementCardProps) {
  const borderColor = BORDER_COLORS[element.type] || '#6B7280';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(element.id, e.ctrlKey || e.metaKey);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(element.id);
  };

  return (
    <div
      data-canvas-element="true"
      onMouseDown={(e) => onMouseDown(e, element)}
      onClick={handleClick}
      className={`
        relative bg-gray-800 rounded-lg overflow-hidden
        transition-all duration-200
        ${isSelected ? 'ring-2 ring-blue-500 shadow-lg' : 'hover:shadow-md'}
      `}
      style={{
        borderLeft: `4px solid ${borderColor}`,
        width: '200px',
        height: '200px',
        cursor: 'move'
      }}
    >
      {/* 图片 */}
      <div className="w-full h-[140px] bg-gray-900 flex items-center justify-center overflow-hidden">
        {element.imageUrl ? (
          <img
            src={element.imageUrl.replace('/images/files/', '/thumbnails/')}
            alt={element.name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-gray-600">
            <Sparkles size={32} className="text-purple-500" />
            <span className="text-xs">等待生成</span>
          </div>
        )}
      </div>

      {/* 信息 */}
      <div className="p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-white truncate flex-1">
            {element.name}
          </span>
        </div>
        <div
          className="text-xs px-2 py-0.5 rounded inline-block"
          style={{
            backgroundColor: borderColor + '20',
            color: borderColor
          }}
        >
          {getTypeLabel(element.type)}
        </div>
      </div>

      {/* 移除按钮 - 右上角 */}
      <button
        onClick={handleRemove}
        className="absolute top-2 right-2 w-6 h-6 bg-gray-900/80 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors z-10"
        title="从画布移除"
      >
        <X size={14} className="text-gray-400" />
      </button>

      {/* 选中标记 - 右下角 */}
      {isSelected && (
        <div className="absolute bottom-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </div>
  );
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    character: '角色',
    scene: '场景',
    prop: '道具',
    storyboard: '分镜',
    canvas_element: '画布元素'
  };
  return labels[type] || type;
}
