import { useEffect, useRef, useState } from 'react';
import { Film, Loader2, Upload, X } from 'lucide-react';
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

const MAX_VIDEO_DURATION = 300;

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
  const [overwriteStoryboards, setOverwriteStoryboards] = useState(true);
  const [extractCharacters, setExtractCharacters] = useState(true);
  const [matchAssets, setMatchAssets] = useState(true);

  useEffect(() => {
    if (!isOpen) {
      setFile(null);
      setDuration(null);
      setError('');
      setIsSubmitting(false);
      setOverwriteStoryboards(true);
      setExtractCharacters(true);
      setMatchAssets(true);
    }
  }, [isOpen]);

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
    try {
      const response = await storyboardApi.videoReverseEpisode(projectId, episodeId, {
        file,
        overwrite_script: true,
        overwrite_storyboards: overwriteStoryboards,
        extract_characters: extractCharacters,
        match_assets: matchAssets,
        preprocess_fps: 1,
      });
      const data = response.data || {};
      toast(
        `视频反推完成：生成 ${data.storyboards_created || 0} 条分镜，新增 ${data.characters_created || 0} 个角色`,
        'success'
      );
      await onCompleted();
      onClose();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || '视频反推失败';
      toast(detail, 'error');
      setError(detail);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 text-gray-100 rounded-xl shadow-xl w-full max-w-lg border border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Film className="w-5 h-5 text-purple-400" />
            <div>
              <h3 className="font-semibold text-white">视频反推剧本</h3>
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
            将使用当前项目的 VLM 配置分析视频，并覆盖本集剧本。开启覆盖分镜时会替换本集已有分镜。
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={overwriteStoryboards}
              onChange={(e) => setOverwriteStoryboards(e.target.checked)}
              disabled={isSubmitting}
            />
            覆盖本集已有分镜
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={extractCharacters}
              onChange={(e) => setExtractCharacters(e.target.checked)}
              disabled={isSubmitting}
            />
            自动提取并去重角色
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={matchAssets}
              onChange={(e) => setMatchAssets(e.target.checked)}
              disabled={isSubmitting}
            />
            自动匹配分镜角色/场景/道具
          </label>
        </div>

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
      </div>
    </div>
  );
}
