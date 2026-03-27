import { useEffect, useRef, useState, useCallback } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { useAssetStore } from '@/store/assetStore';
import { CanvasElementCard } from './CanvasElementCard';
import type { CanvasElementData, CanvasElementPosition, WorkflowNode } from '@/types/canvas';

type CanvasViewMode = 'asset' | 'workflow';

interface InfiniteCanvasProps {
  projectId: string;
  zoom: number;
  mode: CanvasViewMode;
  onZoomChange: (zoom: number) => void;
  visibleTypes: {
    character: boolean;
    prop: boolean;
    scene: boolean;
    storyboard: boolean;
    canvas_element: boolean;
  };
}

const NODE_WIDTH = 220;
const NODE_HEIGHT = 110;

export function InfiniteCanvas({ projectId, zoom, mode, onZoomChange, visibleTypes }: InfiniteCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // 资产模式拖拽状态
  const [draggingElement, setDraggingElement] = useState<{
    elementId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [tempPositions, setTempPositions] = useState<Record<string, { x: number; y: number }>>({});

  // 工作流模式拖拽状态
  const [draggingNode, setDraggingNode] = useState<{
    nodeId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [tempNodePositions, setTempNodePositions] = useState<Record<string, { x: number; y: number }>>({});

  const {
    canvasList,
    activeCanvasId,
    selectedIds,
    selectedNodeId,
    activeRun,
    selectElement,
    clearSelection,
    setSelectedNode,
    updateLayout,
    upsertNode,
    canvasElements,
    removeElementFromCanvas,
  } = useCanvasStore();

  const { characters, scenes, props, storyboards } = useAssetStore();

  const activeCanvas = canvasList.find(c => c.canvas_id === activeCanvasId);

  const allElements = useCallback((): CanvasElementData[] => {
    const elements: CanvasElementData[] = [];

    characters.forEach(char => {
      elements.push({
        id: char.asset_id,
        type: 'character',
        name: char.name,
        imageUrl: char.primary_image_url || '',
        data: char,
      });
    });

    scenes.forEach(scene => {
      elements.push({
        id: scene.asset_id,
        type: 'scene',
        name: scene.name,
        imageUrl: scene.primary_image_url || '',
        data: scene,
      });
    });

    props.forEach(prop => {
      elements.push({
        id: prop.asset_id,
        type: 'prop',
        name: prop.name,
        imageUrl: prop.primary_image_url || '',
        data: prop,
      });
    });

    storyboards.forEach(storyboard => {
      elements.push({
        id: storyboard.asset_id,
        type: 'storyboard',
        name: storyboard.description || `分镜 ${storyboard.sequence}`,
        imageUrl: storyboard.primary_image_url || '',
        data: storyboard,
      });
    });

    Object.values(canvasElements).forEach(element => {
      elements.push(element);
    });

    return elements;
  }, [characters, scenes, props, storyboards, canvasElements]);

  const getElementPosition = (elementId: string): CanvasElementPosition | null => {
    if (!activeCanvas) return null;
    return activeCanvas.elements.find(e => e.id === elementId) || null;
  };

  const getElementRenderPosition = (elementId: string): CanvasElementPosition | null => {
    if (tempPositions[elementId]) {
      const existingPos = getElementPosition(elementId);
      if (!existingPos) return null;
      return {
        ...existingPos,
        x: tempPositions[elementId].x,
        y: tempPositions[elementId].y,
      };
    }
    return getElementPosition(elementId);
  };

  const getNodeRenderPosition = (node: WorkflowNode) => {
    const temp = tempNodePositions[node.node_id];
    if (temp) return temp;
    return { x: Number(node.x || 0), y: Number(node.y || 0) };
  };

  const handleRemoveElement = useCallback(
    (elementId: string) => {
      if (!activeCanvas) return;
      removeElementFromCanvas(projectId, elementId);
    },
    [activeCanvas, projectId, removeElementFromCanvas],
  );

  const addElementsToCanvas = useCallback(
    (assetIds: string[], startX: number, startY: number) => {
      if (!activeCanvas) return;

      const spacing = 220;
      const itemsPerRow = 4;
      const newPositions: CanvasElementPosition[] = [...activeCanvas.elements];

      assetIds.forEach((assetId, index) => {
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
          height: 200,
        });
      });

      updateLayout(projectId, activeCanvas.canvas_id, {
        elements: newPositions,
      });
    },
    [activeCanvas, allElements, projectId, updateLayout],
  );

  const addFolderToCanvas = useCallback(
    (folderType: string, startX: number, startY: number) => {
      const elements = allElements().filter(e => e.type === folderType);
      const assetIds = elements.map(e => e.id);
      addElementsToCanvas(assetIds, startX, startY);
    },
    [allElements, addElementsToCanvas],
  );

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (mode === 'asset') {
      clearSelection();
    } else {
      setSelectedNode(null);
      clearSelection();
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isClickOnAssetCard = !!target.closest('[data-canvas-element]');
    const isClickOnWorkflowNode = !!target.closest('[data-workflow-node]');

    if (!isClickOnAssetCard && !isClickOnWorkflowNode) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleElementMouseDown = (e: React.MouseEvent, element: CanvasElementData) => {
    if (mode !== 'asset') return;

    e.stopPropagation();
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const position = getElementPosition(element.id);
    if (!position) return;

    const mouseCanvasX = (e.clientX - rect.left - pan.x) / zoom;
    const mouseCanvasY = (e.clientY - rect.top - pan.y) / zoom;
    const offsetX = mouseCanvasX - position.x;
    const offsetY = mouseCanvasY - position.y;

    setDraggingElement({ elementId: element.id, offsetX, offsetY });
  };

  const handleNodeMouseDown = (e: React.MouseEvent, node: WorkflowNode) => {
    if (mode !== 'workflow') return;

    e.stopPropagation();
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const pos = getNodeRenderPosition(node);
    const mouseCanvasX = (e.clientX - rect.left - pan.x) / zoom;
    const mouseCanvasY = (e.clientY - rect.top - pan.y) / zoom;
    const offsetX = mouseCanvasX - pos.x;
    const offsetY = mouseCanvasY - pos.y;

    setDraggingNode({
      nodeId: node.node_id,
      offsetX,
      offsetY,
    });
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    if (draggingElement && mode === 'asset') {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const mouseCanvasX = (e.clientX - rect.left - pan.x) / zoom;
      const mouseCanvasY = (e.clientY - rect.top - pan.y) / zoom;

      const newX = mouseCanvasX - draggingElement.offsetX;
      const newY = mouseCanvasY - draggingElement.offsetY;

      setTempPositions(prev => ({
        ...prev,
        [draggingElement.elementId]: { x: newX, y: newY },
      }));
      return;
    }

    if (draggingNode && mode === 'workflow') {
      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const mouseCanvasX = (e.clientX - rect.left - pan.x) / zoom;
      const mouseCanvasY = (e.clientY - rect.top - pan.y) / zoom;

      const newX = mouseCanvasX - draggingNode.offsetX;
      const newY = mouseCanvasY - draggingNode.offsetY;

      setTempNodePositions(prev => ({
        ...prev,
        [draggingNode.nodeId]: { x: newX, y: newY },
      }));
    }
  };

  const handleCanvasMouseUp = () => {
    if (draggingElement && mode === 'asset') {
      const tempPos = tempPositions[draggingElement.elementId];
      if (tempPos && activeCanvas) {
        const existingPos = getElementPosition(draggingElement.elementId);
        const element = allElements().find(e => e.id === draggingElement.elementId);
        if (element && existingPos) {
          const newPositions = activeCanvas.elements.filter(p => p.id !== draggingElement.elementId);
          newPositions.push({
            id: draggingElement.elementId,
            type: element.type,
            x: tempPos.x,
            y: tempPos.y,
            width: existingPos.width,
            height: existingPos.height,
          });
          updateLayout(projectId, activeCanvas.canvas_id, {
            elements: newPositions,
          });
        }
      }
      setDraggingElement(null);
    }

    if (draggingNode && mode === 'workflow') {
      const node = activeCanvas?.nodes?.find(n => n.node_id === draggingNode.nodeId);
      const tempPos = tempNodePositions[draggingNode.nodeId];
      if (activeCanvasId && node && tempPos) {
        void upsertNode(projectId, activeCanvasId, {
          ...node,
          x: tempPos.x,
          y: tempPos.y,
        });
      }
      setDraggingNode(null);
    }

    setIsPanning(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (mode !== 'asset') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    if (mode !== 'asset') return;

    e.preventDefault();
    if (!canvasRef.current || !activeCanvas) return;

    try {
      const rect = canvasRef.current.getBoundingClientRect();
      const canvasX = (e.clientX - rect.left - pan.x) / zoom;
      const canvasY = (e.clientY - rect.top - pan.y) / zoom;

      const dragData = JSON.parse(e.dataTransfer.getData('application/json'));

      if (dragData.type === 'assets') {
        addElementsToCanvas(dragData.assetIds, canvasX, canvasY);
      } else if (dragData.type === 'folder') {
        addFolderToCanvas(dragData.folderType, canvasX, canvasY);
      }
    } catch (error) {
      console.error('Drop failed:', error);
    }
  };

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

  useEffect(() => {
    if (!activeCanvas || mode !== 'asset') return;

    setTempPositions(prev => {
      const newTemp = { ...prev };
      let hasChanges = false;

      Object.keys(newTemp).forEach(elementId => {
        const backendPos = getElementPosition(elementId);
        const tempPos = newTemp[elementId];
        if (backendPos && Math.abs(backendPos.x - tempPos.x) < 1 && Math.abs(backendPos.y - tempPos.y) < 1) {
          delete newTemp[elementId];
          hasChanges = true;
        }
      });

      return hasChanges ? newTemp : prev;
    });
  }, [activeCanvas?.elements, activeCanvas?.updated_at, mode]);

  useEffect(() => {
    if (!activeCanvas || mode !== 'workflow') return;

    setTempNodePositions(prev => {
      const newTemp = { ...prev };
      let changed = false;

      const nodeMap = new Map((activeCanvas.nodes || []).map(node => [node.node_id, node]));
      Object.keys(newTemp).forEach(nodeId => {
        const node = nodeMap.get(nodeId);
        if (!node) {
          delete newTemp[nodeId];
          changed = true;
          return;
        }

        if (Math.abs(Number(node.x || 0) - newTemp[nodeId].x) < 1 && Math.abs(Number(node.y || 0) - newTemp[nodeId].y) < 1) {
          delete newTemp[nodeId];
          changed = true;
        }
      });

      return changed ? newTemp : prev;
    });
  }, [activeCanvas?.nodes, activeCanvas?.updated_at, mode]);

  const renderAssetElements = () => {
    if (!activeCanvas) return null;

    const elements = allElements();
    const filteredElements = elements.filter(element => visibleTypes[element.type as keyof typeof visibleTypes]);

    return filteredElements.map(element => {
      const position = getElementRenderPosition(element.id);
      if (!position) return null;

      return (
        <div
          key={element.id}
          style={{
            position: 'absolute',
            left: position.x,
            top: position.y,
            transform: 'translate(0, 0)',
            zIndex: draggingElement?.elementId === element.id ? 1000 : 1,
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

  const renderWorkflowEdges = () => {
    if (!activeCanvas || mode !== 'workflow') return null;

    const nodes = activeCanvas.nodes || [];
    const edges = activeCanvas.edges || [];
    const nodeMap = new Map(nodes.map(node => [node.node_id, node]));

    return (
      <svg className="absolute inset-0 pointer-events-none overflow-visible" style={{ zIndex: 1 }}>
        {edges.map(edge => {
          const source = nodeMap.get(edge.source_node_id);
          const target = nodeMap.get(edge.target_node_id);
          if (!source || !target) return null;

          const s = getNodeRenderPosition(source);
          const t = getNodeRenderPosition(target);

          const x1 = s.x + NODE_WIDTH;
          const y1 = s.y + NODE_HEIGHT / 2;
          const x2 = t.x;
          const y2 = t.y + NODE_HEIGHT / 2;

          const midX = (x1 + x2) / 2;
          const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

          return <path key={edge.edge_id} d={path} stroke="#60a5fa" strokeWidth={2} fill="none" opacity={0.9} />;
        })}
      </svg>
    );
  };

  const renderWorkflowNodes = () => {
    if (!activeCanvas || mode !== 'workflow') return null;

    const nodes = activeCanvas.nodes || [];

    return nodes.map(node => {
      const pos = getNodeRenderPosition(node);
      const runState = activeRun?.node_states?.[node.node_id]?.status;

      const statusColor =
        runState === 'succeeded'
          ? 'border-green-500'
          : runState === 'failed'
            ? 'border-red-500'
            : runState === 'running'
              ? 'border-blue-400'
              : runState === 'retrying'
                ? 'border-amber-400'
                : 'border-gray-600';

      return (
        <button
          key={node.node_id}
          type="button"
          data-workflow-node="true"
          onMouseDown={e => handleNodeMouseDown(e, node)}
          onClick={e => {
            e.stopPropagation();
            setSelectedNode(node.node_id);
          }}
          className={`absolute text-left bg-gray-800 border-2 rounded-lg px-3 py-2 shadow-md transition ${statusColor} ${
            selectedNodeId === node.node_id ? 'ring-2 ring-blue-500' : 'hover:border-blue-400'
          }`}
          style={{
            left: pos.x,
            top: pos.y,
            width: NODE_WIDTH,
            minHeight: NODE_HEIGHT,
            zIndex: draggingNode?.nodeId === node.node_id ? 1000 : 2,
            cursor: 'move',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-white truncate">{node.label || node.type}</span>
            <span className="text-[10px] text-gray-300 bg-gray-900 px-1.5 py-0.5 rounded">{runState || 'idle'}</span>
          </div>
          <div className="mt-1 text-xs text-blue-300">{node.type}</div>
          <div className="mt-1 text-[11px] text-gray-400 truncate">{node.node_id}</div>
        </button>
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
          position: 'relative',
        }}
      >
        {mode === 'asset' ? renderAssetElements() : null}
        {mode === 'workflow' ? (
          <>
            {renderWorkflowEdges()}
            {renderWorkflowNodes()}
          </>
        ) : null}
      </div>

      <div className="absolute bottom-4 right-4 bg-gray-800 px-3 py-1 rounded text-sm text-gray-400">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
}
