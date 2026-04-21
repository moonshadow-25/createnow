import { memo } from 'react';
import { Download, Trash2, Clock, CheckCircle, XCircle, Loader2, Play, Subtitles } from 'lucide-react';

import { getVideoUrl } from './utils/mediaUtils';

export interface VideoRecord {
  video_id: string;
  video_path: string | null;
  local_path?: string;
  is_downloaded?: boolean;
  prompt: string;
  duration: number;
  resolution?: string;
  created_at: string;
  storyboard_id: string;
  episode_id: string;
  task_id?: string;
  status?: 'pending' | 'completed' | 'failed' | 'queued' | 'in_progress' | 'poll_failed';
  poll_count?: number;
  last_poll_time?: string;
  last_poll_response?: any;
  enhanced_prompt?: string;
  model?: string;
  error?: string;
  is_primary?: boolean;
}

interface VideoCardProps {
  video: VideoRecord;
  projectId: string;
  isPolling: boolean;
  posterUrl?: string;
  onSetPrimary: (videoId: string, storyboardId: string) => void;
  onDelete: (videoId: string) => void;
  onPoll: (videoId: string) => void;
  onRemoveSubtitle: (video: VideoRecord) => void;
}

export const VideoCard = memo(({
  video,
  projectId,
  isPolling,
  posterUrl,
  onSetPrimary,
  onDelete,
  onPoll,
  onRemoveSubtitle
}: VideoCardProps) => {
  const videoUrl = getVideoUrl(video, projectId);

  // 压缩状态显示（包含所有元数据在一行）
  const getCompactStatus = (video: VideoRecord) => {
    const status = video.status || 'pending';
    const duration = `${video.duration}s`;
    const resolution = video.resolution ? ` ${video.resolution}` : '';
    const pollInfo = video.poll_count ? `${video.poll_count}次` : '0次';
    const lastPollTime = video.last_poll_time
      ? new Date(video.last_poll_time).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit'
        })
      : '';
    const createTime = new Date(video.created_at).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).replace(/\//g, '-');

    switch (status) {
      case 'completed':
        return `已完成 (${pollInfo}${lastPollTime ? ', ' + lastPollTime : ''}) | ${duration}${resolution} | ${createTime}`;
      case 'pending':
      case 'queued':
      case 'in_progress':
        return isPolling
          ? `轮询中... | ${duration}${resolution}`
          : `${status} (${pollInfo}) | ${duration}${resolution} | ${createTime}`;
      case 'failed':
        return `失败 | ${video.error?.substring(0, 20) || '未知错误'}`;
      case 'poll_failed':
        return `轮询异常(可手动继续) | ${video.error?.substring(0, 20) || '网络异常'}`;
      default:
        return `${status} | ${duration}${resolution}`;
    }
  };

  // 状态图标
  const getStatusIcon = (video: VideoRecord) => {
    const status = video.status || 'pending';

    if (isPolling) {
      return <Loader2 size={12} className="animate-spin text-yellow-400 flex-shrink-0" />;
    }

    switch (status) {
      case 'completed':
        return <CheckCircle size={12} className="text-green-400 flex-shrink-0" />;
      case 'failed':
        return <XCircle size={12} className="text-red-400 flex-shrink-0" />;
      case 'poll_failed':
        return <XCircle size={12} className="text-orange-400 flex-shrink-0" />;
      default:
        return <Clock size={12} className="text-yellow-400 flex-shrink-0" />;
    }
  };

  return (
    <div
      className={`bg-gray-700 rounded-lg overflow-hidden ${video.is_primary ? 'ring-2 ring-blue-500' : ''}`}
    >
      {/* 视频预览：固定 16:9 容器，视频用 object-contain 自适应，竖版侧边留黑边 */}
      <div className="aspect-video bg-gray-900 relative">
        {/* 主视频标记 */}
        {video.is_primary && (
          <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded z-10">
            主视频
          </div>
        )}
        {videoUrl ? (
          <video
            src={videoUrl}
            className="w-full h-full object-contain"
            controls
            poster={posterUrl}
            preload="none"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              {isPolling ? (
                <Loader2 size={32} className="mx-auto mb-2 animate-spin" />
              ) : (
                <Play size={32} className="mx-auto mb-2 opacity-50" />
              )}
              <div>视频生成中...</div>
              {video.task_id && (
                <div className="text-xs mt-1 text-gray-600">
                  Task: {video.task_id}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 视频信息 */}
      <div className="p-2">
        {/* 状态显示 + 元数据（压缩到一行）*/}
        <div className="text-xs mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-400 flex-1 min-w-0">
            {getStatusIcon(video)}
            <span className="truncate">
              {getCompactStatus(video)}
            </span>
          </div>
          {video.status !== 'completed' && (
            <button
              onClick={() => onPoll(video.video_id)}
              disabled={isPolling}
              className="text-blue-400 hover:text-blue-300 disabled:text-gray-500 text-xs ml-2 flex-shrink-0"
            >
              轮询
            </button>
          )}
        </div>

        <p className="text-xs font-medium line-clamp-2 mb-2 text-gray-300 leading-tight">
          {video.prompt}
        </p>

        {/* 操作按钮 */}
        <div className="flex gap-1">
          {/* 设为主视频按钮 - 仅对已完成且非主视频的显示 */}
          {video.status === 'completed' && !video.is_primary && (
            <button
              onClick={() => onSetPrimary(video.video_id, video.storyboard_id)}
              className="flex-1 flex items-center justify-center gap-1 text-xs bg-green-600 hover:bg-green-700 px-2 py-1 rounded"
            >
              设为主
            </button>
          )}
          {video.status === 'completed' && !!video.video_path && (video.video_path.startsWith('http://') || video.video_path.startsWith('https://')) && (
            <button
              onClick={() => onRemoveSubtitle(video)}
              className="flex-1 flex items-center justify-center gap-1 text-xs bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded"
              title="仅支持 CreateNow 官方远程 URL，擦除后会生成新视频"
            >
              <Subtitles size={12} />
              去除字幕
            </button>
          )}
          {videoUrl && (
            <a
              href={videoUrl}
              download
              className="flex-1 flex items-center justify-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded"
            >
              <Download size={12} />
              下载
            </a>
          )}
          <button
            onClick={() => onDelete(video.video_id)}
            className="flex items-center justify-center gap-1 text-xs bg-red-600 hover:bg-red-700 px-2 py-1 rounded"
          >
            <Trash2 size={12} />
          </button>
        </div>

        {/* 轮询响应（折叠显示）*/}
        {video.last_poll_response && (
          <details className="mt-2">
            <summary className="text-xs text-blue-400 cursor-pointer">调试信息</summary>
            <pre className="mt-1 p-2 bg-gray-800 rounded text-xs overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(video.last_poll_response, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比较：只有关键字段变化时才重新渲染
  return (
    prevProps.video.video_id === nextProps.video.video_id &&
    prevProps.video.status === nextProps.video.status &&
    prevProps.video.is_primary === nextProps.video.is_primary &&
    prevProps.video.video_path === nextProps.video.video_path &&
    prevProps.video.local_path === nextProps.video.local_path &&
    prevProps.isPolling === nextProps.isPolling
  );
});

VideoCard.displayName = 'VideoCard';
