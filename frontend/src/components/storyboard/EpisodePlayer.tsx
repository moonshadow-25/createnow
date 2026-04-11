import { useEffect, useRef, useState, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface EpisodePlayerProps {
  videos: { storyboardId: string; url: string; sequence: number; description?: string }[];
  onClose: () => void;
}

/**
 * 每个视频一个独立的 <video> 元素，通过 display 切换。
 * - 不闪黑：切换时旧视频还在，新视频已预加载好
 * - 进度条可拖拽：用浏览器原生 controls
 * - 自动续播：onEnded 切下一个
 */
export function EpisodePlayer({ videos, onClose }: EpisodePlayerProps) {
  const [current, setCurrent] = useState(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const currentRef = useRef(0);

  const currentVideo = videos[current];

  const setVideoRef = useCallback((el: HTMLVideoElement | null, index: number) => {
    videoRefs.current[index] = el;
  }, []);

  const goTo = useCallback((index: number) => {
    if (index < 0 || index >= videos.length) return;

    // 暂停当前
    const prev = videoRefs.current[currentRef.current];
    if (prev) {
      prev.pause();
      prev.currentTime = 0;
    }

    currentRef.current = index;
    setCurrent(index);

    // 播放目标
    const next = videoRefs.current[index];
    if (next) {
      next.currentTime = 0;
      next.play().catch(() => {});
    }
  }, [videos.length]);

  // 初始播放第一个
  useEffect(() => {
    const first = videoRefs.current[0];
    if (first) {
      first.play().catch(() => {});
    }
  }, []);

  // 自动播放下一个
  const handleEnded = useCallback((index: number) => {
    if (index !== currentRef.current) return; // 不是当前播放的，忽略
    const next = index + 1;
    if (next < videos.length) {
      goTo(next);
    }
  }, [videos.length, goTo]);

  // 键盘控制
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goTo(Math.max(0, currentRef.current - 1));
      if (e.key === 'ArrowRight') goTo(Math.min(videos.length - 1, currentRef.current + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goTo, videos.length]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 shrink-0">
        <span className="text-sm text-gray-300">
          分镜 {currentVideo.sequence}
          {currentVideo.description && (
            <span className="ml-2 text-gray-500 text-xs">{currentVideo.description}</span>
          )}
        </span>
        <span className="text-sm text-gray-400">{current + 1} / {videos.length}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X size={20} />
        </button>
      </div>

      {/* 视频区域：所有 video 叠放，只显示当前的 */}
      <div className="flex-1 relative bg-black min-h-0">
        {videos.map((v, i) => (
          <video
            key={v.storyboardId}
            ref={(el) => setVideoRef(el, i)}
            src={v.url}
            className="absolute inset-0 w-full h-full object-contain"
            style={{ display: i === current ? 'block' : 'none' }}
            playsInline
            preload={i <= current + 1 ? 'auto' : 'metadata'}
            onEnded={() => handleEnded(i)}
          />
        ))}
      </div>

      {/* 控制栏 */}
      <div className="flex items-center justify-center gap-6 px-4 py-3 bg-gray-900 shrink-0">
        <button
          onClick={() => goTo(currentRef.current - 1)}
          disabled={current === 0}
          className="text-gray-300 hover:text-white disabled:opacity-30"
        >
          <ChevronLeft size={24} />
        </button>
        <span className="text-sm text-gray-400">{current + 1} / {videos.length}</span>
        <button
          onClick={() => goTo(currentRef.current + 1)}
          disabled={current === videos.length - 1}
          className="text-gray-300 hover:text-white disabled:opacity-30"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* 分镜缩略条 */}
      <div className="flex gap-1 px-4 pb-3 overflow-x-auto bg-gray-900 shrink-0">
        {videos.map((v, i) => (
          <button
            key={v.storyboardId}
            onClick={() => goTo(i)}
            className={`flex-shrink-0 text-xs px-2 py-1 rounded ${
              i === current
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {v.sequence}
          </button>
        ))}
      </div>
    </div>
  );
}
