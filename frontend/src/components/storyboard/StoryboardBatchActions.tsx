import { useState } from 'react';
import { Plus, Layers, Film, Grid, Download, Loader2, Video } from 'lucide-react';
import { useSelectedStoryboardsExport } from './hooks/useSelectedStoryboardsExport';
import { useJianyingExport } from './hooks/useJianyingExport';
import { JianyingExportDialog } from './JianyingExportDialog';

interface StoryboardBatchActionsProps {
  projectId: string;
  episodeId?: string;
  episodeName?: string;
  selectedCount: number;
  selectedStoryboards: any[];
  selectedHasCompletedVideo?: boolean;
  onInsertStoryboard: () => void;
  onInsertInbetween: () => void;
  onInsertFirstLastVideo: () => void;
  onMultiImageFusion: () => void;
  onCreateEndFrame?: () => void;
  onClearSelection: () => void;
  toast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function StoryboardBatchActions({
  projectId,
  episodeId,
  episodeName,
  selectedCount,
  selectedStoryboards,
  selectedHasCompletedVideo,
  onInsertStoryboard,
  onInsertInbetween,
  onInsertFirstLastVideo,
  onMultiImageFusion,
  onCreateEndFrame,
  onClearSelection,
  toast
}: StoryboardBatchActionsProps) {
  const [showJianyingDialog, setShowJianyingDialog] = useState(false);

  // 使用选中分镜导出 Hook（ZIP）
  const {
    isExporting: isExportingZip,
    exportProgress: exportZipProgress,
    handleExportSelectedVideos,
  } = useSelectedStoryboardsExport({
    projectId,
    episodeId,
    selectedStoryboardIds: new Set(selectedStoryboards.map(sb => sb.asset_id)),
    toast,
  });

  // 使用剪映导出 Hook
  const {
    isExporting: isExportingJiaying,
    exportProgress: exportJianyingProgress,
    handleExportToJiaying,
  } = useJianyingExport({
    projectId,
    episodeId,
    selectedStoryboardIds: new Set(selectedStoryboards.map(sb => sb.asset_id)),
    toast,
  });

  const handleJianyingDialogConfirm = (options: any) => {
    setShowJianyingDialog(false);
    handleExportToJiaying(options);
  };

  // 检查是否恰好选择了2个分镜
  const hasTwoSelected = selectedCount === 2;
  // 检查是否选择了2-4个分镜（多图融合）
  const hasMultiImageFusion = selectedCount >= 2 && selectedCount <= 4;
  // 检查单选分镜是否有已保存的视频（用于创建尾帧）
  const hasCompletedVideo = selectedHasCompletedVideo;

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4 z-40 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="text-sm text-gray-300">
            已选择 <span className="font-semibold text-white">{selectedCount}</span> 个分镜
          {selectedCount === 1 && selectedStoryboards[0] && (
            <span className="ml-2 text-gray-400">
              (分镜 {selectedStoryboards[0].sequence})
            </span>
          )}
          {selectedCount === 2 && (
            <span className="ml-2 text-gray-400">
              (分镜 {selectedStoryboards[0]?.sequence} 和 {selectedStoryboards[1]?.sequence})
            </span>
          )}
          {selectedCount > 2 && selectedCount <= 4 && (
            <span className="ml-2 text-gray-400">
              (分镜 {selectedStoryboards.map(sb => sb.sequence).join(', ')})
            </span>
          )}
          {selectedCount > 4 && (
            <span className="ml-2 text-yellow-400">
              (多图融合最多支持4张图片)
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClearSelection}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
          >
            取消选择
          </button>

          {selectedCount === 1 && (
            <>
              <button
                onClick={onInsertStoryboard}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition"
              >
                <Plus size={16} />
                插入分镜
              </button>
              {hasCompletedVideo && onCreateEndFrame && (
                <button
                  onClick={onCreateEndFrame}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm transition"
                  title="从视频最后一帧创建新分镜"
                >
                  <Video size={16} />
                  创建尾帧
                </button>
              )}
            </>
          )}

          {hasTwoSelected && (
            <>
              <button
                onClick={onInsertInbetween}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm transition"
              >
                <Layers size={16} />
                插入中间分镜
              </button>
              <button
                onClick={onInsertFirstLastVideo}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm transition"
              >
                <Film size={16} />
                插入首尾帧视频
              </button>
            </>
          )}

          {hasMultiImageFusion && (
            <button
              onClick={onMultiImageFusion}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded text-sm transition"
            >
              <Grid size={16} />
              多图融合
            </button>
          )}

          {/* 导出选中视频（ZIP） */}
          <button
            onClick={handleExportSelectedVideos}
            disabled={isExportingZip}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 rounded text-sm transition disabled:bg-gray-600 disabled:cursor-not-allowed"
            title="导出为 ZIP 压缩包"
          >
            {isExportingZip ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                导出中 {Math.round(exportZipProgress)}%
              </>
            ) : (
              <>
                <Download size={16} />
                导出视频
              </>
            )}
          </button>

          {/* 导出到剪映（新增） */}
          <button
            onClick={() => setShowJianyingDialog(true)}
            disabled={isExportingJiaying}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded text-sm transition disabled:bg-gray-600 disabled:cursor-not-allowed shadow-lg"
            title="一键导出到剪映专业版"
          >
            {isExportingJiaying ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                导出中 {Math.round(exportJianyingProgress)}%
              </>
            ) : (
              <>
                <Film size={16} />
                导出到剪映
              </>
            )}
          </button>
        </div>
      </div>
    </div>

    {/* 剪映导出对话框 */}
    {showJianyingDialog && (
      <JianyingExportDialog
        projectId={projectId}
        episodeName={episodeName}
        selectedCount={selectedCount}
        onConfirm={handleJianyingDialogConfirm}
        onClose={() => setShowJianyingDialog(false)}
      />
    )}
  </>
  );
}
