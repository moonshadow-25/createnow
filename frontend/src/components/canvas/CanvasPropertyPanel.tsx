import { Trash2, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { useAssetStore } from '@/store/assetStore';
import { useToast } from '@/components/common/Toast';
import { CanvasFusionPanel } from './CanvasFusionPanel';
import { canvasApi } from '@/services/api';

interface CanvasPropertyPanelProps {
  projectId: string;
}

export function CanvasPropertyPanel({ projectId }: CanvasPropertyPanelProps) {
  const { selectedIds, canvasElements, deleteCanvasElement, clearSelection, createCanvasElement, fetchCanvasElements, canvasList, activeCanvasId } = useCanvasStore();
  const { characters, scenes, props, storyboards } = useAssetStore();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // 获取选中的元素数据
  const getSelectedElements = () => {
    return selectedIds.map(id => {
      // 先从画布元素中查找
      if (canvasElements[id]) {
        return canvasElements[id];
      }

      // 从资产中查找
      const char = characters.find(c => c.asset_id === id);
      if (char) {
        return {
          id: char.asset_id,
          type: 'character' as const,
          name: char.name,
          imageUrl: char.primary_image_url || '',
          data: char
        };
      }

      const scene = scenes.find(s => s.asset_id === id);
      if (scene) {
        return {
          id: scene.asset_id,
          type: 'scene' as const,
          name: scene.name,
          imageUrl: scene.primary_image_url || '',
          data: scene
        };
      }

      const prop = props.find(p => p.asset_id === id);
      if (prop) {
        return {
          id: prop.asset_id,
          type: 'prop' as const,
          name: prop.name,
          imageUrl: prop.primary_image_url || '',
          data: prop
        };
      }

      // 添加分镜查找
      const storyboard = storyboards.find(s => s.asset_id === id);
      if (storyboard) {
        return {
          id: storyboard.asset_id,
          type: 'storyboard' as const,
          name: storyboard.description || `分镜 ${storyboard.sequence}`,
          imageUrl: storyboard.primary_image_url || '',
          data: storyboard
        };
      }

      return null;
    }).filter(Boolean);
  };

  const selectedElements = getSelectedElements();

  // 删除画布元素
  const handleDeleteElement = async (elementId: string) => {
    if (!window.confirm('确定要删除这个画布元素吗？')) {
      return;
    }

    try {
      await deleteCanvasElement(projectId, elementId);
      clearSelection();
      toast('画布元素已删除', 'success');
    } catch (error: any) {
      toast(`删除失败: ${error.message}`, 'error');
    }
  };

  // 单选时生成融合图片
  const handleGenerateSingleFusion = async (element: any) => {
    if (!prompt.trim()) {
      toast('请输入提示词', 'error');
      return;
    }

    const imageId = element.data?.image_id;
    if (!imageId) {
      toast('该元素没有图片', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      // 获取当前元素的位置
      const activeCanvas = canvasList.find(c => c.canvas_id === activeCanvasId);
      const elementPosition = activeCanvas?.elements.find(e => e.id === element.id);

      // 计算新位置：在原元素的右下方偏移
      const newPosition = elementPosition
        ? { x: elementPosition.x + 30, y: elementPosition.y + 30 }
        : undefined;

      // 创建画布元素
      const elementId = await createCanvasElement(projectId, {
        name: `${element.name}_融合`,
        description: prompt,
        source_asset_ids: [element.id],
        source_types: [element.type],
        fusion_prompt: prompt
      }, newPosition);

      // 生成融合图片（单图编辑）
      await canvasApi.generateFusionImage(projectId, {
        asset_ids: [element.id],
        asset_types: [element.type],
        prompt: prompt,
        image_ids: [imageId],
        canvas_element_id: elementId
      });

      // 刷新画布元素数据
      await fetchCanvasElements(projectId);

      toast('图片生成成功', 'success');

      // 清空提示词
      setPrompt('');
    } catch (error: any) {
      toast(`生成失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // 未选中
  if (selectedIds.length === 0) {
    return (
      <div className="w-80 bg-gray-800 border-l border-gray-700 p-4 flex items-center justify-center">
        <div className="text-center text-gray-400">
          <p className="text-sm">未选中任何元素</p>
          <p className="text-xs mt-2">点击元素查看属性</p>
          <p className="text-xs mt-1">按住Ctrl+点击可多选</p>
        </div>
      </div>
    );
  }

  // 多选 - 显示融合面板
  if (selectedIds.length > 1) {
    return (
      <div className="w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto">
        <CanvasFusionPanel
          projectId={projectId}
          selectedElements={selectedElements as any}
        />
      </div>
    );
  }

  // 单选 - 简化显示并添加图生图功能
  const element = selectedElements[0];
  if (!element) return null;

  return (
    <div className="w-80 bg-gray-800 border-l border-gray-700 p-4 overflow-y-auto">
      {/* 图片预览 */}
      <div className="mb-4">
        <div className="aspect-square bg-gray-900 rounded overflow-hidden">
          {element.imageUrl ? (
            <img
              src={element.imageUrl}
              alt={element.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600">
              无图片
            </div>
          )}
        </div>
      </div>

      {/* 名字 */}
      <div className="mb-4">
        <div className="text-lg font-medium text-white">{element.name}</div>
      </div>

      {/* 提示词输入框 */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 mb-2 block">提示词</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入提示词，生成新的融合元素..."
          className="w-full bg-gray-900 text-white px-3 py-2 rounded text-sm resize-none"
          rows={4}
        />
      </div>

      {/* 生成按钮 */}
      <button
        onClick={() => handleGenerateSingleFusion(element)}
        disabled={!prompt.trim() || isGenerating}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:bg-gray-600 disabled:cursor-not-allowed text-white transition-colors"
      >
        {isGenerating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            生成中...
          </>
        ) : (
          <>
            <Sparkles size={16} />
            生成图片
          </>
        )}
      </button>

      {/* 删除按钮 - 仅画布元素可删除 */}
      {element.type === 'canvas_element' && (
        <div className="mt-6 pt-4 border-t border-gray-700">
          <button
            onClick={() => handleDeleteElement(element.id)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white transition-colors"
          >
            <Trash2 size={16} />
            删除画布元素
          </button>
          <p className="text-xs text-gray-500 mt-2 text-center">
            资产和分镜元素不可删除
          </p>
        </div>
      )}
    </div>
  );
}
