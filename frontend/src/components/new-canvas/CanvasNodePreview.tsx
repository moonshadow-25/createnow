import { CanvasImageNodePreview } from './CanvasImageNodePreview';
import { DirectorStageNodePreview } from './DirectorStageNodePreview';
import { getOutputStatus, isVideoNode, pickRenderableOutput } from './canvasUtils';
import type { CanvasNode, NodeOutput } from './types';

type CanvasNodePreviewProps = {
  node: CanvasNode;
  output?: NodeOutput;
  compact?: boolean;
  nodeHeight: number;
  onDirectorMarkersChange: (nodeId: string, markers: NonNullable<CanvasNode['config']['director_markers']>) => void;
  onOpenImagePreview: (url: string, title: string) => void;
};

export function CanvasNodePreview({
  node,
  output,
  compact = false,
  nodeHeight,
  onDirectorMarkersChange,
  onOpenImagePreview,
}: CanvasNodePreviewProps) {
  const renderableOutput = pickRenderableOutput(output, node.config.last_result);
  const imageUrl = node.type === 'director.stage'
    ? node.config.image_url || renderableOutput?.image_url || ''
    : renderableOutput?.image_url || node.config.image_url;
  const videoUrl = renderableOutput?.video_url || (node.config.media_type === 'video' ? node.config.media_url : '');
  const videoStatus = getOutputStatus(renderableOutput);
  const videoId = renderableOutput?.video_id;
  const audioUrl = renderableOutput?.audio_url || (node.config.media_type === 'audio' ? node.config.media_url : '');
  const text = renderableOutput?.text;
  const previewHeight = compact ? 112 : Math.max(80, nodeHeight - 96);

  if (imageUrl) return node.type === 'director.stage' ? (
    <DirectorStageNodePreview
      node={node}
      imageUrl={imageUrl}
      height={previewHeight}
      editable
      onMarkersChange={onDirectorMarkersChange}
      onOpenPreview={onOpenImagePreview}
    />
  ) : (
    <CanvasImageNodePreview imageUrl={imageUrl} title={node.label} height={previewHeight} onOpenPreview={onOpenImagePreview} />
  );
  if (videoUrl) return (
    <div className="relative w-full overflow-hidden rounded-lg bg-gray-950" style={{ height: previewHeight }}>
      <video src={videoUrl} draggable={false} className="h-full w-full bg-black object-cover" controls />
    </div>
  );
  if (isVideoNode(node.type) && videoId) {
    const isFailed = ['failed', 'error'].includes(videoStatus);
    return (
      <div className={`flex h-20 flex-col items-center justify-center rounded-lg border text-xs ${isFailed ? 'border-red-800 bg-red-950/30 text-red-300' : 'border-blue-900 bg-blue-950/30 text-blue-300'}`}>
        <div className="font-medium">{isFailed ? '视频生成失败' : '视频生成中'}</div>
        <div className="mt-1 text-[10px] text-gray-500">{videoId.slice(0, 8)} · {videoStatus || 'pending'}</div>
      </div>
    );
  }
  if (audioUrl) return <div className="rounded-lg bg-gray-950 p-2"><audio src={audioUrl} controls className="w-full" /></div>;
  if (text) return <div className="line-clamp-4 rounded-lg bg-gray-950 p-2 text-xs text-gray-300">{text}</div>;
  return <div className="flex h-20 items-center justify-center rounded-lg bg-gray-950 text-xs text-gray-500">暂无结果</div>;
}
