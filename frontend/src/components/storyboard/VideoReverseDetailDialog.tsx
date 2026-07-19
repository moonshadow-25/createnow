import { useEffect, useState } from 'react';
import { BookOpen, Loader2, Play, Save, Upload, X } from 'lucide-react';
import { assetApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface VideoReverseDetailDialogProps {
  isOpen: boolean;
  projectId: string;
  episode: any;
  onClose: () => void;
  onSaved: (episode: any) => void;
  onGenerate: () => void;
  onAnalyzeVideo?: () => void;
}

type DetailTab = 'screenplay' | 'segments' | 'analysis';

export function VideoReverseDetailDialog({
  isOpen,
  projectId,
  episode,
  onClose,
  onSaved,
  onGenerate,
  onAnalyzeVideo,
}: VideoReverseDetailDialogProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DetailTab>('screenplay');
  const [screenplay, setScreenplay] = useState('');
  const [segmentsText, setSegmentsText] = useState('[]');
  const [analysisText, setAnalysisText] = useState('{}');
  const [saving, setSaving] = useState(false);

  const splitSegmentPrompts = (text: string): string[] => {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return trimmed.split(/\n\s*(?=\[Segment\])/).map(item => item.trim()).filter(Boolean);
  };

  useEffect(() => {
    if (!isOpen || !episode) return;
    setActiveTab('screenplay');
    setScreenplay(episode.video_reverse_screenplay || episode.video_reverse_screenplay_text || episode.script || '');
    const segmentPrompts = Array.isArray(episode.video_reverse_segments)
      ? episode.video_reverse_segments
          .filter((item: any) => typeof item === 'string' && item.trim())
          .join('\n\n')
      : '';
    setSegmentsText(
      segmentPrompts
      || episode.video_reverse_segment_prompts_text
      || ''
    );
    setAnalysisText(
      episode.video_reverse_drama_analysis_text
      || episode.video_reverse_analysis?.content
      || (episode.video_reverse_analysis ? JSON.stringify(episode.video_reverse_analysis, null, 2) : '')
    );
  }, [isOpen, episode]);

  if (!isOpen || !episode) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const segmentPrompts = splitSegmentPrompts(segmentsText);
      const analysis = analysisText.trim() ? { content: analysisText } : {};
      const payload = {
        script: screenplay,
        video_reverse_screenplay: screenplay,
        video_reverse_screenplay_text: screenplay,
        video_reverse_segments: segmentPrompts,
        video_reverse_segment_prompts_text: segmentsText,
        video_reverse_drama_analysis_text: analysisText,
        video_reverse_analysis: analysis,
        video_reverse_updated_at: new Date().toISOString(),
      };
      await assetApi.update(projectId, 'episode', episode.asset_id, payload);
      onSaved({ ...episode, ...payload });
      toast('剧本反推已保存', 'success');
    } catch (error: any) {
      toast(`保存失败：${error.message || error.response?.data?.detail || 'JSON 格式错误'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const tabs: { key: DetailTab; label: string }[] = [
    { key: 'screenplay', label: '完整剧本' },
    { key: 'segments', label: '分段提示词' },
    { key: 'analysis', label: '剧本分析' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 text-gray-100 rounded-xl shadow-xl w-full max-w-5xl h-[82vh] flex flex-col border border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-400" />
            <div>
              <h3 className="font-semibold text-white">剧本反推</h3>
              <p className="text-xs text-gray-400">{episode.name || '当前剧集'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onAnalyzeVideo && (
              <button
                onClick={onAnalyzeVideo}
                className="px-3 py-1.5 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                分析视频
              </button>
            )}
            <button onClick={onClose} className="p-1 text-gray-400 hover:bg-gray-700 hover:text-white rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex gap-2 px-5 pt-4">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 p-5 min-h-0">
          {activeTab === 'screenplay' && (
            <textarea
              value={screenplay}
              onChange={(e) => setScreenplay(e.target.value)}
              className="w-full h-full resize-none rounded-lg border border-gray-700 bg-gray-950 text-gray-100 p-3 text-sm leading-6 font-mono placeholder:text-gray-500"
              placeholder="暂无完整剧本"
            />
          )}
          {activeTab === 'segments' && (
            <textarea
              value={segmentsText}
              onChange={(e) => setSegmentsText(e.target.value)}
              className="w-full h-full resize-none rounded-lg border border-gray-700 bg-gray-950 text-gray-100 p-3 text-sm leading-6 font-mono placeholder:text-gray-500"
              placeholder="[]"
            />
          )}
          {activeTab === 'analysis' && (
            <textarea
              value={analysisText}
              onChange={(e) => setAnalysisText(e.target.value)}
              className="w-full h-full resize-none rounded-lg border border-gray-700 bg-gray-950 text-gray-100 p-3 text-sm leading-6 font-mono placeholder:text-gray-500"
              placeholder="{}"
            />
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-700">
          <p className="text-xs text-gray-400">
            “按剧本生成”会打开龙虾对话系统，并按一键反推工作流生成资产、分镜和 video_prompt。
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg border border-gray-600 bg-gray-700 text-gray-100 hover:bg-gray-600 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存
            </button>
            <button
              onClick={onGenerate}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2"
            >
              <Play className="w-4 h-4" />
              按剧本生成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
