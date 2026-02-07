import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import { canvasApi } from '@/services/api';
import { useCanvasStore } from '@/store/canvasStore';
import type { CanvasElementData } from '@/types/canvas';

interface CanvasFusionPanelProps {
  projectId: string;
  selectedElements: CanvasElementData[];
}

export function CanvasFusionPanel({ projectId, selectedElements }: CanvasFusionPanelProps) {
  const { toast } = useToast();
  const { createCanvasElement, fetchCanvasElements, canvasList, activeCanvasId } = useCanvasStore();
  const [userPrompt, setUserPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const handleFuseImages = async () => {
    if (!userPrompt.trim()) {
      toast('请输入提示词', 'error');
      return;
    }

    // 获取所有源图片的image_id
    const imageIds = selectedElements
      .map(e => e.data?.image_id)
      .filter(Boolean);

    if (imageIds.length < 2) {
      toast('至少需要2张图片才能融合', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      // 获取最后一个选中元素的位置
      const lastElement = selectedElements[selectedElements.length - 1];
      const activeCanvas = canvasList.find(c => c.canvas_id === activeCanvasId);
      const lastElementPosition = activeCanvas?.elements.find(e => e.id === lastElement.id);

      // 计算新位置：在最后一个元素的右下方偏移
      const newPosition = lastElementPosition
        ? { x: lastElementPosition.x + 30, y: lastElementPosition.y + 30 }
        : undefined;

      // 创建画布元素
      const elementId = await createCanvasElement(projectId, {
        name: `融合元素_${Date.now()}`,
        description: userPrompt,
        source_asset_ids: selectedElements.map(e => e.id),
        source_types: selectedElements.map(e => e.type),
        fusion_prompt: userPrompt
      }, newPosition);

      // 生成融合图片
      await canvasApi.generateFusionImage(projectId, {
        asset_ids: selectedElements.map(e => e.id),
        asset_types: selectedElements.map(e => e.type),
        prompt: userPrompt,
        image_ids: imageIds,
        canvas_element_id: elementId
      });

      // 刷新画布元素数据
      await fetchCanvasElements(projectId);

      toast('融合图片生成成功', 'success');

      // 清空提示词
      setUserPrompt('');
    } catch (error: any) {
      toast(`生成失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };


  return (
    <div className="p-4 space-y-4">
      <h3 className="text-lg font-semibold">融合生成</h3>

      {/* 选中的资产缩略图 */}
      <div>
        <label className="text-xs text-gray-400 mb-2 block">
          已选中 {selectedElements.length} 个元素
        </label>
        <div className="grid grid-cols-2 gap-2">
          {selectedElements.map(element => (
            <div key={element.id} className="bg-gray-900 rounded p-2">
              <div className="aspect-square bg-gray-800 rounded overflow-hidden mb-1">
                {element.imageUrl ? (
                  <img
                    src={element.imageUrl}
                    alt={element.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
                    无图片
                  </div>
                )}
              </div>
              <div className="text-xs text-white truncate">{element.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 提示词输入框 */}
      <div>
        <label className="text-xs text-gray-400 mb-2 block">提示词</label>
        <textarea
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          placeholder="描述你想要的融合效果..."
          className="w-full bg-gray-900 text-white px-3 py-2 rounded text-sm resize-none"
          rows={4}
        />
      </div>

      {/* 融合图片按钮 */}
      <button
        onClick={handleFuseImages}
        disabled={isGenerating || !userPrompt.trim()}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:bg-gray-600 disabled:cursor-not-allowed"
      >
        {isGenerating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            融合中...
          </>
        ) : (
          <>
            <Sparkles size={16} />
            融合图片
          </>
        )}
      </button>
    </div>
  );
}
