import { ZoomIn } from 'lucide-react';
import { StickFigureOverlay } from './StickFigureOverlay';
import type { CanvasNode } from './types';

type DirectorStageNodePreviewProps = {
  node: CanvasNode;
  imageUrl: string;
  height: number;
  editable: boolean;
  onMarkersChange: (nodeId: string, markers: NonNullable<CanvasNode['config']['director_markers']>) => void;
  onOpenPreview: (url: string, title: string) => void;
};

export function DirectorStageNodePreview({
  node,
  imageUrl,
  height,
  editable,
  onMarkersChange,
  onOpenPreview,
}: DirectorStageNodePreviewProps) {
  return (
    <div className="group relative w-full overflow-hidden rounded-lg bg-gray-950" style={{ height }}>
      <img src={imageUrl} alt={node.label} draggable={false} className="h-full w-full object-cover" />
      {editable && (
        <div onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
          <StickFigureOverlay
            markers={node.config.director_markers || []}
            editable
            onMarkersChange={(nextMarkers) => onMarkersChange(node.node_id, nextMarkers)}
          />
        </div>
      )}
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onOpenPreview(imageUrl, node.label); }}
        className="absolute left-1/2 top-1/2 hidden h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white shadow-2xl ring-1 ring-white/30 hover:bg-black/90 group-hover:flex"
        title="放大查看"
      >
        <ZoomIn size={28} />
      </button>
    </div>
  );
}
