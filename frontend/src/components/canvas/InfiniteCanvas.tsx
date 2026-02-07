import { useEffect, useRef, useState, useCallback } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { useAssetStore } from '@/store/assetStore';
import { CanvasElementCard } from './CanvasElementCard';
import type { CanvasElementData, CanvasElementPosition } from '@/types/canvas';

interface InfiniteCanvasProps {
  projectId: string;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  visibleTypes: {
    character: boolean;
    prop: boolean;
    scene: boolean;
    storyboard: boolean;
    canvas_element: boolean;
  };
}

export function InfiniteCanvas({ projectId, zoom, onZoomChange, visibleTypes }: InfiniteCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // 新增：元素拖拽状态
  const [draggingElement, setDraggingElement] = useState<{
    elementId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // 新增：临时位置状态（拖拽过程中的实时位置）
  const [tempPositions, setTempPositions] = useState<Record<string, { x: number; y: number }>>({});

  const {
    canvasList,
    activeCanvasId,
    selectedIds,
    selectElement,
    clearSelection,
    updateLayout,
    canvasElements,
    removeElementFromCanvas
  } = useCanvasStore();

  const { characters, scenes, props, storyboards } = useAssetStore();

  const activeCanvas = canvasList.find(c => c.canvas_id === activeCanvasId);

  // 收集所有元素数据
  const allElements = useCallback((): CanvasElementData[] => {
    const elements: CanvasElementData[] = [];

    // 添加角色
    characters.forEach(char => {
      elements.push({
        id: char.asset_id,
        type: 'character',
        name: char.name,
        imageUrl: char.primary_image_url || '',
        data: char
      });
    });

    // 添加场景
    scenes.forEach(scene => {
      elements.push({
        id: scene.asset_id,
        type: 'scene',
        name: scene.name,
        imageUrl: scene.primary_image_url || '',
        data: scene
      });
    });

    // 添加道具
    props.forEach(prop => {
      elements.push({
        id: prop.asset_id,
        type: 'prop',
        name: prop.name,
        imageUrl: prop.primary_image_url || '',
        data: prop
      });
    });

    // 添加分镜
    storyboards.forEach(storyboard => {
      elements.push({
        id: storyboard.asset_id,
        type: 'storyboard',
        name: storyboard.description || `分镜 ${storyboard.sequence}`,
        imageUrl: storyboard.primary_image_url || '',
        data: storyboard
      });
    });

    // 添加画布元素
    Object.values(canvasElements).forEach(element => {
      elements.push(element);
    });

    return elements;
  }, [characters, scenes, props, storyboards, canvasElements]);

  // 获取元素位置
  const getElementPosition = (elementId: string): CanvasElementPosition | null => {
    if (!activeCanvas) return null;
    return activeCanvas.elements.find(e => e.id === elementId) || null;
  };

  // 获取元素的渲染位置（优先使用临时位置）
  const getElementRenderPosition = (elementId: string): CanvasElementPosition | null => {
    // 如果有临时位置（正在拖拽），使用临时位置
    if (tempPositions[elementId]) {
      const existingPos = getElementPosition(elementId);
      if (!existingPos) return null;
      return {
        ...existingPos,
        x: tempPositions[elementId].x,
        y: tempPositions[elementId].y
      };
    }
    // 否则使用正常位置
    return getElementPosition(elementId);
  };

  // 从画布移除元素
  const handleRemoveElement = useCallback((elementId: string) => {
    if (!activeCanvas) return;
    removeElementFromCanvas(projectId, elementId);
  }, [activeCanvas, projectId, removeElementFromCanvas]);

  // 批量添加元素到画布
  const addElementsToCanvas = useCallback((assetIds: string[], startX: number, startY: number) => {
    if (!activeCanvas) return;

    const spacing = 220;
    const itemsPerRow = 4;
    const newPositions: CanvasElementPosition[] = [...activeCanvas.elements];

    assetIds.forEach((assetId, index) => {
      // 检查是否已存在
      if (newPositions.some(p => p.id === assetId)) return;

      const element = allElements().find(e => e.id === assetId);
      if (!element) return;

      const row = Math.floor(index / itemsPerRow);
      const col = index % itemsPerRow;

      newPositions.push({
        id: assetId,
        type: element.type,
        x: startX + col * spacing,
        y: startY + row * spacing,
        width: 200,
        height: 200
      });
    });

    updateLayout(projectId, activeCanvas.canvas_id, {
      elements: newPositions
    });
  }, [activeCanvas, allElements, projectId, updateLayout]);

  // 添加整个文件夹到画布
  const addFolderToCanvas = useCallback((folderType: string, startX: number, startY: number) => {
    const elements = allElements().filter(e => e.type === folderType);
    const assetIds = elements.map(e => e.id);
    addElementsToCanvas(assetIds, startX, startY);
  }, [allElements, addElementsToCanvas]);

  // 注释掉自动布局逻辑 - 新画布保持空白，通过拖拽添加元素
  // useEffect(() => {
  //   if (!activeCanvas || !projectId) return;

  //   const elements = allElements();
  //   const existingPositions = activeCanvas.elements;
  //   const needsLayout = elements.some(el => !getElementPosition(el.id));

  //   if (needsLayout) {
  //     // 自动排列元素
  //     const newPositions: CanvasElementPosition[] = [...existingPositions];
  //     let x = 50;
  //     let y = 50;
  //     const spacing = 220;
  //     const itemsPerRow = 4;
  //     let count = 0;

  //     elements.forEach(el => {
  //       if (!getElementPosition(el.id)) {
  //         newPositions.push({
  //           id: el.id,
  //           type: el.type,
  //           x,
  //           y,
  //           width: 200,
  //           height: 200
  //         });

  //         count++;
  //         if (count % itemsPerRow === 0) {
  //           x = 50;
  //           y += spacing;
  //         } else {
  //           x += spacing;
  //         }
  //       }
  //     });

  //     // 保存布局
  //     updateLayout(projectId, activeCanvas.canvas_id, {
  //       elements: newPositions
  //     });
  //   }
  // }, [activeCanvas, allElements, projectId]);

  // 处理画布点击（清除选择）
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      clearSelection();
    }
  };

  // 处理画布拖拽 - 鼠标按下
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // 检查点击的是否是元素卡片
    const target = e.target as HTMLElement;
    const isClickOnCard = target.closest('[data-canvas-element]');

    // 只有不是点击在元素上时，才允许拖拽画布
    if (!isClickOnCard) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  // 处理元素拖拽 - 鼠标按下
  const handleElementMouseDown = (e: React.MouseEvent, element: CanvasElementData) => {
    e.stopPropagation(); // 阻止冒泡，避免触发画布拖拽

    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const position = getElementPosition(element.id);
    if (!position) return;

    // 计算鼠标相对于元素左上角的偏移（画布坐标系）
    const mouseCanvasX = (e.clientX - rect.left - pan.x) / zoom;
    const mouseCanvasY = (e.clientY - rect.top - pan.y) / zoom;
    const offsetX = mouseCanvasX - position.x;
    const offsetY = mouseCanvasY - position.y;

    setDraggingElement({
      elementId: element.id,
      offsetX,
      offsetY
    });
  };

  // 处理画布拖拽 - 鼠标移动
  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    } else if (draggingElement) {
      // 元素拖拽 - 实时更新位置
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const mouseCanvasX = (e.clientX - rect.left - pan.x) / zoom;
      const mouseCanvasY = (e.clientY - rect.top - pan.y) / zoom;

      const newX = mouseCanvasX - draggingElement.offsetX;
      const newY = mouseCanvasY - draggingElement.offsetY;

      // 实时更新临时位置
      setTempPositions(prev => ({
        ...prev,
        [draggingElement.elementId]: { x: newX, y: newY }
      }));
    }
  };

  // 处理画布拖拽 - 鼠标释放
  const handleCanvasMouseUp = () => {
    if (draggingElement) {
      // 保存最终位置到后端
      const tempPos = tempPositions[draggingElement.elementId];
      if (tempPos && activeCanvas) {
        const existingPos = getElementPosition(draggingElement.elementId);
        const element = allElements().find(e => e.id === draggingElement.elementId);
        if (element && existingPos) {
          const newPositions = activeCanvas.elements.filter(
            p => p.id !== draggingElement.elementId
          );
          newPositions.push({
            id: draggingElement.elementId,
            type: element.type,
            x: tempPos.x,
            y: tempPos.y,
            width: existingPos.width,
            height: existingPos.height
          });
          updateLayout(projectId, activeCanvas.canvas_id, {
            elements: newPositions
          });
        }
      }

      // 不清除 tempPositions，让它保持到后端更新完成
      // useEffect 会在后端更新后自动清理
      setDraggingElement(null);
    }
    setIsPanning(false);
  };

  // 处理从资产面板拖拽 - 允许drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // 处理从资产面板拖拽 - drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!canvasRef.current || !activeCanvas) return;

    try {
      // 计算drop位置（考虑pan和zoom）
      const rect = canvasRef.current.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left - pan.x) / zoom;
      const canvasY = (e.clientY - rect.top - pan.y) / zoom;

      // 解析拖拽数据
      const dragData = JSON.parse(e.dataTransfer.getData('application/json'));

      if (dragData.type === 'assets') {
        // 单个或多个元素
        addElementsToCanvas(dragData.assetIds, canvasX, canvasY);
      } else if (dragData.type === 'folder') {
        // 整个文件夹
        addFolderToCanvas(dragData.folderType, canvasX, canvasY);
      }
    } catch (error) {
      console.error('Drop failed:', error);
    }
  };

  // 使用 useEffect 注册 wheel 事件（修复 passive 事件问题）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Math.max(0.1, Math.min(3, zoom + delta));
      onZoomChange(newZoom);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [zoom, onZoomChange]);

  // 自动清理已同步的临时位置
  useEffect(() => {
    if (!activeCanvas) return;

    setTempPositions(prev => {
      const newTemp = { ...prev };
      let hasChanges = false;

      Object.keys(newTemp).forEach(elementId => {
        const backendPos = getElementPosition(elementId);
        const tempPos = newTemp[elementId];

        // 如果后端位置已经更新到临时位置（误差小于1像素），清除临时位置
        if (backendPos &&
            Math.abs(backendPos.x - tempPos.x) < 1 &&
            Math.abs(backendPos.y - tempPos.y) < 1) {
          delete newTemp[elementId];
          hasChanges = true;
        }
      });

      return hasChanges ? newTemp : prev;
    });
  }, [activeCanvas?.elements, activeCanvas?.updated_at]);

  // 渲染元素
  const renderElements = () => {
    if (!activeCanvas) return null;

    const elements = allElements();
    // 根据 visibleTypes 过滤元素
    const filteredElements = elements.filter(element =>
      visibleTypes[element.type as keyof typeof visibleTypes]
    );

    return filteredElements.map(element => {
      const position = getElementRenderPosition(element.id); // 使用新函数
      if (!position) return null;

      return (
        <div
          key={element.id}
          style={{
            position: 'absolute',
            left: position.x,
            top: position.y,
            transform: 'translate(0, 0)',
            // 拖拽时提升层级，避免被其他元素遮挡
            zIndex: draggingElement?.elementId === element.id ? 1000 : 1
          }}
        >
          <CanvasElementCard
            element={element}
            isSelected={selectedIds.includes(element.id)}
            onSelect={selectElement}
            onMouseDown={handleElementMouseDown}
            onRemove={handleRemoveElement}
          />
        </div>
      );
    });
  };

  return (
    <div
      ref={canvasRef}
      className="flex-1 bg-gray-900 overflow-hidden relative"
      style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      onClick={handleCanvasClick}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleCanvasMouseMove}
      onMouseUp={handleCanvasMouseUp}
      onMouseLeave={handleCanvasMouseUp}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          width: '100%',
          height: '100%',
          position: 'relative'
        }}
      >
        {renderElements()}
      </div>

      {/* 缩放指示器 */}
      <div className="absolute bottom-4 right-4 bg-gray-800 px-3 py-1 rounded text-sm text-gray-400">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}
