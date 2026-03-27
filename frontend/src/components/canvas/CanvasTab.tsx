import { useEffect, useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { useAssetStore } from '@/store/assetStore';
import { CanvasToolbar } from './CanvasToolbar';
import { InfiniteCanvas } from './InfiniteCanvas';
import { CanvasPropertyPanel } from './CanvasPropertyPanel';
import { AssetPanel } from './AssetPanel';

type CanvasViewMode = 'asset' | 'workflow';

interface CanvasTabProps {
  projectId: string;
}

const TERMINAL_RUN_STATUS = new Set(['succeeded', 'failed', 'canceled', 'partial_failed']);

export function CanvasTab({ projectId }: CanvasTabProps) {
  const {
    fetchCanvasList,
    fetchCanvasElements,
    fetchWorkflowRun,
    loading,
    error,
    selectedIds,
    selectedNodeId,
    activeCanvasId,
    activeRun,
  } = useCanvasStore();
  const { fetchAssets } = useAssetStore();

  const [zoom, setZoom] = useState(1);
  const [assetPanelOpen, setAssetPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState<CanvasViewMode>('asset');
  const [visibleTypes, setVisibleTypes] = useState({
    character: true,
    prop: true,
    scene: true,
    storyboard: true,
    canvas_element: true,
  });

  useEffect(() => {
    fetchCanvasList(projectId);
    fetchCanvasElements(projectId);
    fetchAssets(projectId, 'character');
    fetchAssets(projectId, 'scene');
    fetchAssets(projectId, 'prop');
    fetchAssets(projectId, 'storyboard');
  }, [projectId]);

  useEffect(() => {
    if (!activeRun || !activeCanvasId) return;
    if (TERMINAL_RUN_STATUS.has(activeRun.status)) return;

    const timer = window.setInterval(() => {
      fetchWorkflowRun(projectId, activeCanvasId, activeRun.run_id);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [projectId, activeCanvasId, activeRun?.run_id, activeRun?.status]);

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
      [type]: !prev[type],
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
      <CanvasToolbar
        projectId={projectId}
        mode={viewMode}
        onModeChange={setViewMode}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        visibleTypes={visibleTypes}
        onToggleType={handleToggleType}
      />

      <div className="flex-1 flex overflow-hidden">
        {viewMode === 'asset' && (
          <AssetPanel isOpen={assetPanelOpen} onToggle={() => setAssetPanelOpen(!assetPanelOpen)} />
        )}

        <InfiniteCanvas
          projectId={projectId}
          zoom={zoom}
          mode={viewMode}
          onZoomChange={handleZoomChange}
          visibleTypes={visibleTypes}
        />

        {(selectedIds.length > 0 || selectedNodeId || viewMode === 'workflow') && (
          <CanvasPropertyPanel projectId={projectId} mode={viewMode} />
        )}
      </div>
    </div>
  );
}
