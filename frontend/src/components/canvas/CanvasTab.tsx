import { useEffect, useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { useAssetStore } from '@/store/assetStore';
import { CanvasToolbar } from './CanvasToolbar';
import { InfiniteCanvas } from './InfiniteCanvas';
import { CanvasPropertyPanel } from './CanvasPropertyPanel';
import { AssetPanel } from './AssetPanel';

interface CanvasTabProps {
  projectId: string;
}

export function CanvasTab({ projectId }: CanvasTabProps) {
  const { fetchCanvasList, fetchCanvasElements, loading, error, selectedIds } = useCanvasStore();
  const { fetchAssets } = useAssetStore();
  const [zoom, setZoom] = useState(1);
  const [assetPanelOpen, setAssetPanelOpen] = useState(false);
  const [visibleTypes, setVisibleTypes] = useState({
    character: true,
    prop: true,
    scene: true,
    storyboard: true,
    canvas_element: true
  });

  useEffect(() => {
    // 加载画布列表
    fetchCanvasList(projectId);
    // 加载画布元素
    fetchCanvasElements(projectId);
    // 加载资产数据
    fetchAssets(projectId, 'character');
    fetchAssets(projectId, 'scene');
    fetchAssets(projectId, 'prop');
    fetchAssets(projectId, 'storyboard');
  }, [projectId]);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(3, prev + 0.2));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(0.1, prev - 0.2));
  };

  const handleZoomReset = () => {
    setZoom(1);
  };

  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
  };

  const handleToggleType = (type: keyof typeof visibleTypes) => {
    setVisibleTypes(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-red-400">加载失败: {error}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-900">
      {/* 工具栏 */}
      <CanvasToolbar
        projectId={projectId}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        visibleTypes={visibleTypes}
        onToggleType={handleToggleType}
      />

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧资产面板 */}
        <AssetPanel
          isOpen={assetPanelOpen}
          onToggle={() => setAssetPanelOpen(!assetPanelOpen)}
        />

        {/* 画布 */}
        <InfiniteCanvas
          projectId={projectId}
          zoom={zoom}
          onZoomChange={handleZoomChange}
          visibleTypes={visibleTypes}
        />

        {/* 右侧属性面板 - 只在选中元素时显示 */}
        {selectedIds.length > 0 && (
          <CanvasPropertyPanel projectId={projectId} />
        )}
      </div>
    </div>
  );
}
