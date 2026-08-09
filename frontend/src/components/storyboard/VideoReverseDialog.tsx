import { useEffect, useRef, useState } from 'react';
import { Check, Film, Loader2, Upload, X } from 'lucide-react';
import { storyboardApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface VideoReverseDialogProps {
  isOpen: boolean;
  projectId: string;
  episodeId?: string;
  episodeName?: string;
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
}

interface ReverseProgress {
  status: string;
  step_index?: number;
  total_steps?: number;
  message?: string;
  started_at?: string;
  error?: string | null;
  result?: {
    storyboards_created?: number;
    characters_created?: number;
  } | null;
}

const MAX_VIDEO_DURATION = 300;

const REVERSE_STEPS = ['上传视频', '视频预处理', '剧本反推', '分段与剧情分析', '保存结果'];

export function VideoReverseDialog({
  isOpen,
  projectId,
  episodeId,
  episodeName,
  onClose,
  onCompleted,
}: VideoReverseDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState<ReverseProgress | null>(null);
  const finishedRef = useRef(false);
  // 是否曾成功读到过进度（用于区分"任务刚开始 404（正常）"与"进度丢失（异常）"）
  const sawProgressRef = useRef(false);
  // 父组件每次渲染都会重建 onCompleted/onClose（内联函数），useToast 的 toast
  // 在 toast 出现/消失时也会重建——轮询 effect 里必须走 ref，否则 effect 反复重启导致请求风暴
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!isOpen) {
      setFile(null);
      setDuration(null);
      setError('');
      setIsSubmitting(false);
      setProgress(null);
      finishedRef.current = false;
      sawProgressRef.current = false;
    }
  }, [isOpen]);

  // 提交后轮询反推进度：POST 同步执行期间事件循环空闲，进度查询可并行返回；
  // 即使网关 504 掐断 POST，任务仍在后端继续执行，这里持续轮询直到终态。
  // 依赖只保留稳定值（回调走 ref），避免父组件渲染导致 effect 重启、请求风暴
  useEffect(() => {
    if (!isSubmitting || !episodeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;
    let failedCount = 0;
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await storyboardApi.getVideoReverseProgress(projectId, episodeId);
        if (cancelled) return;
        failedCount = 0;
        sawProgressRef.current = true;
        const data = res.data as ReverseProgress;
        setProgress(data);
        if (data.status === 'completed') {
          stop();
          if (finishedRef.current) return;
          finishedRef.current = true;
          toastRef.current(
            `视频反推完成：生成 ${data.result?.storyboards_created || 0} 条分镜，新增 ${data.result?.characters_created || 0} 个角色`,
            'success'
          );
          await onCompletedRef.current();
          onCloseRef.current();
        } else if (data.status === 'failed') {
          stop();
          toastRef.current(data.error || '视频反推失败', 'error');
        }
      } catch (err: any) {
        if (err?.response?.status === 404 && sawProgressRef.current) {
          // 之前见过进度、现在 404 = 进度记录真的丢了（如服务重启）
          stop();
          toastRef.current('反推任务状态丢失，可能已被服务重启中断', 'error');
        } else if (err?.response?.status === 404) {
          // 任务刚开始，后端进度记录尚未建立（文件上传中），静默等待
        } else if (++failedCount >= 5) {
          // 后端不可用（未重启、500 等）时停止轮询，避免无限请求
          stop();
          toastRef.current('反推进度查询连续失败，已停止轮询，请检查后端服务', 'error');
        }
      } finally {
        inFlight = false;
      }
    };
    poll();
    timer = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [isSubmitting, projectId, episodeId]);

  if (!isOpen) return null;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const handleFileChange = (selectedFile?: File) => {
    setError('');
    setDuration(null);
    setFile(null);

    if (!selectedFile) return;
    if (!selectedFile.type.startsWith('video/')) {
      setError('请选择视频文件');
      return;
    }

    setFile(selectedFile);

    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(selectedFile);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      const nextDuration = video.duration;
      if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
        setError('浏览器无法读取视频时长，将交由后端继续校验');
        return;
      }
      if (nextDuration > MAX_VIDEO_DURATION) {
        setFile(null);
        setError(`视频时长不能超过 5 分钟，当前约 ${formatDuration(nextDuration)}`);
        return;
      }
      setDuration(nextDuration);
      setError('');
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError('浏览器无法预览该视频，将交由后端继续校验');
    };
    video.src = objectUrl;
  };

  const handleSubmit = async () => {
    if (!episodeId) {
      toast('请先选择剧集', 'error');
      return;
    }
    if (!file) {
      setError('请先选择 5 分钟以内的视频');
      return;
    }

    setIsSubmitting(true);
    setProgress(null);
    setError('');
    sawProgressRef.current = false;
    try {
      const response = await storyboardApi.videoReverseEpisode(projectId, episodeId, {
        file,
        overwrite_script: true,
        preprocess_fps: 1,
      });
      const data = response.data || {};
      if (finishedRef.current) return;
      finishedRef.current = true;
      toast(
        `视频反推完成：生成 ${data.storyboards_created || 0} 条分镜，新增 ${data.characters_created || 0} 个角色`,
        'success'
      );
      await onCompleted();
      onClose();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '视频反推失败';
      if (err?.response?.status === 504) {
        // 网关超时掐断请求，任务仍在后台执行，保持轮询等待终态
        toast('请求已被网关中断，任务仍在后台执行，正在等待完成…', 'info');
      } else {
        setIsSubmitting(false);
        toast(detail, 'error');
        setError(detail);
      }
    }
  };

  const elapsedSeconds = progress?.started_at
    ? Math.max(0, Math.floor((Date.now() - Date.parse(progress.started_at)) / 1000))
    : 0;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 text-gray-100 rounded-xl shadow-xl w-full max-w-lg border border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5 text-purple-400" />
            <div>
              <h3 className="font-semibold text-white">分析视频</h3>
              {episodeName && <p className="text-xs text-gray-400">{episodeName}</p>}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 text-gray-400 hover:bg-gray-700 hover:text-white rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {isSubmitting ? (
            <div className="space-y-3">
              {progress ? (
                <>
                  <div className="text-sm font-medium text-purple-200">{progress.message || '处理中...'}</div>
                  <div className="space-y-2">
                    {REVERSE_STEPS.map((label, i) => {
                      const stepIndex = progress.step_index ?? 0;
                      const isDone = progress.status === 'completed' || i < stepIndex;
                      const isActive = progress.status === 'running' && i === stepIndex;
                      const isFailedStep = progress.status === 'failed' && i === stepIndex;
                      return (
                        <div key={label} className="flex items-center gap-2 text-sm">
                          {isDone ? (
                            <Check className="w-4 h-4 text-green-400 shrink-0" />
                          ) : isActive ? (
                            <Loader2 className="w-4 h-4 animate-spin text-purple-400 shrink-0" />
                          ) : isFailedStep ? (
                            <X className="w-4 h-4 text-red-400 shrink-0" />
                          ) : (
                            <div className="w-4 h-4 rounded-full border border-gray-600 shrink-0" />
                          )}
                          <span className={isActive ? 'text-white' : isDone ? 'text-gray-300' : 'text-gray-500'}>
                            {label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(
                          100,
                          ((progress.step_index ?? 0) / (progress.total_steps || REVERSE_STEPS.length)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="text-xs text-gray-400">已耗时 {elapsedSeconds} 秒</div>
                  {progress.status === 'failed' && progress.error && (
                    <div className="text-sm text-red-300 bg-red-900/30 border border-red-700/50 rounded-lg p-3">
                      {progress.error}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                  正在准备上传视频...
                </div>
              )}
            </div>
          ) : (
            <>
              <div
                className="border-2 border-dashed border-gray-600 bg-gray-700 text-gray-100 rounded-lg p-6 text-center cursor-pointer hover:border-purple-500 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0])}
                  disabled={isSubmitting}
                />
                <Upload className="w-8 h-8 mx-auto mb-3 text-gray-400" />
                <div className="text-sm font-medium text-white">
                  {file ? file.name : '点击上传 5 分钟以内的视频'}
                </div>
                {duration !== null && (
                  <div className="text-xs text-gray-400 mt-1">时长：{formatDuration(duration)}</div>
                )}
                {error && <div className="text-sm text-amber-300 mt-1">{error}</div>}
              </div>

              <div className="bg-gray-700 border border-gray-600 rounded-lg p-3 text-sm text-gray-200">
                将使用当前项目的 VLM 配置分析视频，并覆盖本集剧本。分镜与关键资产将在“按剧本生成”时按现有一键生成流程处理。
              </div>
            </>
          )}
        </div>

        {isSubmitting ? (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-700">
            {progress?.status === 'failed' && (
              <button
                onClick={() => {
                  setProgress(null);
                  setError('');
                  setIsSubmitting(false);
                }}
                className="px-4 py-2 text-sm rounded-lg border border-gray-600 bg-gray-700 text-gray-100 hover:bg-gray-600"
              >
                重新选择文件
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-600 bg-gray-700 text-gray-100 hover:bg-gray-600"
            >
              关闭窗口
            </button>
            <span className="text-xs text-gray-500">关闭窗口不会中断分析</span>
          </div>
        ) : (
          <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-700">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm rounded-lg border border-gray-600 bg-gray-700 text-gray-100 hover:bg-gray-600 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!file || isSubmitting}
              className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
              开始反推
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
