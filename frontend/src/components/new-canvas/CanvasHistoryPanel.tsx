import { useEffect, useMemo, useState } from 'react';
import { ZoomIn } from 'lucide-react';
import { ExpandableText } from '@/components/common/ExpandableText';
import { getImageUrlFromRecord, getVideoUrlFromRecord, isPendingVideoStatus } from './canvasUtils';
import type { HistoryItem } from './types';

type PreviewImage = { url: string; title: string; imageId?: string };

type CanvasHistoryPanelProps = {
  projectId: string;
  historyItems: HistoryItem[];
  historyLoading: boolean;
  pollingVideoIds: Set<string>;
  onRefresh: () => void;
  onPreviewImage: (preview: PreviewImage) => void;
  onSelectTextNode: (nodeId: string) => void;
  onContinuePollingVideo: (videoId: string) => void;
};

const HISTORY_PAGE_SIZE = 24;

export function CanvasHistoryPanel({
  projectId,
  historyItems,
  historyLoading,
  pollingVideoIds,
  onRefresh,
  onPreviewImage,
  onSelectTextNode,
  onContinuePollingVideo,
}: CanvasHistoryPanelProps) {
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
  const [loadedVideoIds, setLoadedVideoIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setVisibleCount((current) => Math.min(Math.max(current, HISTORY_PAGE_SIZE), historyItems.length || HISTORY_PAGE_SIZE));
  }, [historyItems.length]);

  const displayItems = useMemo(() => historyItems.slice(0, visibleCount), [historyItems, visibleCount]);
  const hasMore = visibleCount < historyItems.length;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-200">画布历史</div>
          <div className="text-xs text-gray-500">统一倒序显示，只包含画布结果</div>
        </div>
        <button
          onClick={onRefresh}
          disabled={historyLoading}
          className="rounded-lg bg-gray-800 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
        >
          {historyLoading ? '刷新中...' : '刷新'}
        </button>
      </div>

      <div className="space-y-3">
        {displayItems.map((item) => {
          if (item.kind === 'image') {
            const imageUrl = getImageUrlFromRecord(projectId, item.image);
            return (
              <div key={`image-${item.id}`} className="rounded-lg border border-gray-800 bg-gray-950 p-2">
                {imageUrl && (
                  <div className="group relative mb-2 h-28 w-full overflow-hidden rounded bg-gray-900">
                    <img src={imageUrl} alt={item.title} draggable={false} className="h-full w-full object-contain" />
                    <button
                      type="button"
                      onClick={() => onPreviewImage({ url: imageUrl, title: item.title, imageId: item.id })}
                      className="absolute left-1/2 top-1/2 hidden h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white shadow-2xl ring-1 ring-white/30 hover:bg-black/90 group-hover:flex"
                      title="放大查看"
                    >
                      <ZoomIn size={24} />
                    </button>
                  </div>
                )}
                <div className="mb-1 text-[10px] text-blue-300">图片</div>
                <ExpandableText text={item.title} maxLines={2} className="text-xs text-gray-300" />
                <div className="mt-1 text-[10px] text-gray-600">{item.createdAt || item.id}</div>
              </div>
            );
          }
          if (item.kind === 'video') {
            const videoUrl = getVideoUrlFromRecord(projectId, item.video);
            const pending = isPendingVideoStatus(item.video.status);
            const polling = pollingVideoIds.has(item.video.video_id);
            const videoLoaded = loadedVideoIds.has(item.video.video_id);
            return (
              <div key={`video-${item.id}`} className="rounded-lg border border-gray-800 bg-gray-950 p-2">
                {videoUrl ? (
                  videoLoaded ? (
                    <video src={videoUrl} draggable={false} className="mb-2 h-28 w-full rounded bg-black object-contain" controls />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLoadedVideoIds((current) => new Set(current).add(item.video.video_id))}
                      className="mb-2 flex h-28 w-full items-center justify-center rounded bg-gray-900 text-xs text-gray-300 hover:bg-gray-800"
                    >
                      点击加载视频
                    </button>
                  )
                ) : (
                  <div className="mb-2 flex h-28 items-center justify-center rounded bg-gray-900 text-xs text-gray-500">{item.video.status || 'pending'}</div>
                )}
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-purple-300">视频</span>
                  <span className={pending ? 'text-yellow-300' : item.video.status === 'failed' ? 'text-red-300' : 'text-green-300'}>{item.video.status || 'pending'}</span>
                </div>
                <ExpandableText text={item.title} maxLines={2} className="text-xs text-gray-300" />
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-gray-600">
                  <span>{item.createdAt || item.id}</span>
                  {(pending || item.video.status === 'failed') && (
                    <button
                      onClick={() => onContinuePollingVideo(item.video.video_id)}
                      className="rounded bg-blue-700 px-2 py-1 text-[10px] text-white hover:bg-blue-600"
                    >
                      {polling ? '重新轮询' : '继续轮询'}
                    </button>
                  )}
                </div>
              </div>
            );
          }
          return (
            <button
              key={`text-${item.id}`}
              onClick={() => onSelectTextNode(item.nodeId)}
              className="w-full rounded-lg border border-gray-800 bg-gray-950 p-3 text-left hover:border-blue-500"
            >
              <div className="mb-1 text-[10px] text-amber-300">文本</div>
              <div className="mb-1 text-xs font-medium text-blue-300">{item.title}</div>
              <ExpandableText text={item.text} maxLines={5} className="whitespace-pre-wrap text-xs text-gray-300" />
            </button>
          );
        })}
        {!historyItems.length && <div className="rounded-lg bg-gray-950 p-4 text-center text-xs text-gray-500">暂无画布历史</div>}
        {hasMore && (
          <button
            type="button"
            onClick={() => setVisibleCount((current) => Math.min(current + HISTORY_PAGE_SIZE, historyItems.length))}
            className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-300 hover:border-blue-500 hover:text-blue-200"
          >
            加载更多
          </button>
        )}
      </div>
    </div>
  );
}
