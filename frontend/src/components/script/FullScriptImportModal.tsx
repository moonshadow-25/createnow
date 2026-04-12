import { useState, useCallback, useRef } from 'react';
import { X, Upload, FileText, Sparkles, Wand2, Layers, AlertTriangle } from 'lucide-react';
import { fullScriptApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface FullScriptImportModalProps {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

type ProcessingState = 'idle' | 'splitting' | 'extracting' | 'both';

interface SplitResult {
  episodes_created: number;
  episodes_updated: number;
  total_episodes: number;
  episodes: Array<{ episode_number: number; title: string; is_new: boolean }>;
}

interface ExtractResult {
  created: {
    characters: any[];
    scenes: any[];
    props: any[];
  };
  skipped_count: number;
  total_created: number;
}

export function FullScriptImportModal({
  projectId,
  onClose,
  onSuccess,
}: FullScriptImportModalProps) {
  const { toast } = useToast();
  const [scriptContent, setScriptContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [processing, setProcessing] = useState<ProcessingState>('idle');
  const [splitResult, setSplitResult] = useState<SplitResult | null>(null);
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isProcessing = processing !== 'idle';
  const hasContent = scriptContent.trim().length > 0;

  // ── 文件处理 ──────────────────────────────────────────────
  const handleFileSelect = useCallback(async (file: File) => {
    setError(null);
    setFileName(file.name);
    setSplitResult(null);
    setExtractResult(null);
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'txt') {
      const reader = new FileReader();
      reader.onload = (event) => setScriptContent(event.target?.result as string);
      reader.readAsText(file, 'utf-8');
    } else if (ext === 'docx' || ext === 'doc') {
      try {
        const mammoth = await import('mammoth');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.default.extractRawText({ arrayBuffer });
        setScriptContent(result.value);
      } catch {
        setError('Word 文件解析失败，请尝试将内容复制粘贴到下方文本框');
      }
    } else {
      setError('仅支持 .txt 和 .docx 格式的文件');
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleClear = () => {
    setScriptContent('');
    setFileName('');
    setSplitResult(null);
    setExtractResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── 操作处理 ──────────────────────────────────────────────
  const handleSplitEpisodes = async () => {
    setProcessing('splitting');
    setError(null);
    setSplitResult(null);
    try {
      const res = await fullScriptApi.splitEpisodes(projectId, scriptContent);
      setSplitResult(res.data as SplitResult);
      const r = res.data as SplitResult;
      toast(`分集完成！共 ${r.total_episodes} 集（新建 ${r.episodes_created}，更新 ${r.episodes_updated}）`, 'success');
      onSuccess();
    } catch (e: any) {
      const msg = e.response?.data?.detail || e.message || '分集失败';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setProcessing('idle');
    }
  };

  const handleExtractAssets = async () => {
    setProcessing('extracting');
    setError(null);
    setExtractResult(null);
    try {
      const res = await fullScriptApi.extractAssets(projectId, scriptContent);
      setExtractResult(res.data as ExtractResult);
      const r = res.data as ExtractResult;
      toast(`资产提取完成！新增 ${r.total_created} 项（跳过 ${r.skipped_count} 项重复）`, 'success');
      onSuccess();
    } catch (e: any) {
      const msg = e.response?.data?.detail || e.message || '资产提取失败';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setProcessing('idle');
    }
  };

  const handleSplitAndExtract = async () => {
    setProcessing('both');
    setError(null);
    setSplitResult(null);
    setExtractResult(null);
    try {
      const res = await fullScriptApi.splitAndExtract(projectId, scriptContent);
      const data = res.data as { split: SplitResult; extract: ExtractResult };
      setSplitResult(data.split);
      setExtractResult(data.extract);
      toast(
        `处理完成！分集 ${data.split.total_episodes} 集，新增资产 ${data.extract.total_created} 项`,
        'success'
      );
      onSuccess();
    } catch (e: any) {
      const msg = e.response?.data?.detail || e.message || '处理失败';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setProcessing('idle');
    }
  };

  // ── 渲染 ──────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Layers size={20} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-white">导入全剧本</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="text-gray-400 hover:text-white disabled:opacity-50 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* 上传区域 */}
          {!hasContent && (
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-600 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-gray-750 transition-all"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.docx,.doc"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />
              <Upload size={40} className="mx-auto mb-3 text-gray-500" />
              <p className="text-gray-300 font-medium mb-1">拖拽文件到此处，或点击上传</p>
              <p className="text-sm text-gray-500">支持 .txt 和 .docx 格式</p>
            </div>
          )}

          {/* 粘贴框（无文件时显示） */}
          {!hasContent && (
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">或直接粘贴剧本内容</label>
              <textarea
                value={scriptContent}
                onChange={(e) => setScriptContent(e.target.value)}
                placeholder="将剧本内容粘贴到这里..."
                className="w-full h-32 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm resize-none focus:border-blue-500 focus:outline-none transition-colors"
              />
            </div>
          )}

          {/* 内容预览 */}
          {hasContent && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <FileText size={14} />
                  {fileName && <span>{fileName}</span>}
                  <span className="text-gray-500">·</span>
                  <span>{scriptContent.length.toLocaleString()} 字</span>
                </div>
                <button
                  onClick={handleClear}
                  disabled={isProcessing}
                  className="text-sm text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                >
                  清除
                </button>
              </div>
              <textarea
                value={scriptContent}
                onChange={(e) => setScriptContent(e.target.value)}
                disabled={isProcessing}
                className="w-full h-56 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm font-mono resize-y focus:border-blue-500 focus:outline-none transition-colors disabled:opacity-60"
              />
            </div>
          )}

          {/* 超长文本警告 */}
          {scriptContent.length > 200000 && (
            <div className="flex items-start gap-2 p-3 bg-yellow-900 bg-opacity-30 border border-yellow-700 rounded-lg">
              <AlertTriangle size={16} className="text-yellow-500 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-yellow-300">
                文本较长（{Math.round(scriptContent.length / 10000)}万字），AI 处理可能需要较长时间
              </span>
            </div>
          )}

          {/* 处理中状态 */}
          {isProcessing && (
            <div className="flex items-center gap-3 p-3 bg-blue-900 bg-opacity-30 border border-blue-700 rounded-lg">
              <div className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full flex-shrink-0" />
              <span className="text-sm text-blue-300">
                {processing === 'splitting' && 'AI 正在分析剧本结构，进行分集...'}
                {processing === 'extracting' && 'AI 正在提取角色、场景、道具...'}
                {processing === 'both' && 'AI 正在同时进行分集和资产提取...'}
              </span>
            </div>
          )}

          {/* 错误信息 */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-900 bg-opacity-30 border border-red-700 rounded-lg">
              <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-300">{error}</span>
            </div>
          )}

          {/* 分集结果 */}
          {splitResult && (
            <div className="p-3 bg-green-900 bg-opacity-20 border border-green-700 rounded-lg space-y-2">
              <p className="text-sm font-medium text-green-400">
                分集完成 — 共 {splitResult.total_episodes} 集
                {splitResult.episodes_created > 0 && `（新建 ${splitResult.episodes_created} 集）`}
                {splitResult.episodes_updated > 0 && `（更新 ${splitResult.episodes_updated} 集）`}
              </p>
              <div className="flex flex-wrap gap-2">
                {splitResult.episodes.map((ep) => (
                  <span
                    key={ep.episode_number}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                      ep.is_new
                        ? 'bg-green-800 bg-opacity-50 text-green-300'
                        : 'bg-blue-800 bg-opacity-50 text-blue-300'
                    }`}
                  >
                    第{ep.episode_number}集 {ep.title}
                    <span className="text-gray-500">{ep.is_new ? '(新)' : '(更新)'}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 资产提取结果 */}
          {extractResult && (
            <div className="p-3 bg-green-900 bg-opacity-20 border border-green-700 rounded-lg space-y-2">
              <p className="text-sm font-medium text-green-400">
                资产提取完成 — 新增 {extractResult.total_created} 项
                {extractResult.skipped_count > 0 && `，跳过 ${extractResult.skipped_count} 项重复`}
              </p>
              <div className="text-xs text-gray-300 space-y-1">
                {extractResult.created.characters.length > 0 && (
                  <p>
                    <span className="text-purple-400">角色：</span>
                    {extractResult.created.characters.map((c) => c.name).join('、')}
                  </p>
                )}
                {extractResult.created.scenes.length > 0 && (
                  <p>
                    <span className="text-yellow-400">场景：</span>
                    {extractResult.created.scenes.map((s) => s.name).join('、')}
                  </p>
                )}
                {extractResult.created.props.length > 0 && (
                  <p>
                    <span className="text-orange-400">道具：</span>
                    {extractResult.created.props.map((p) => p.name).join('、')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            关闭
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSplitEpisodes}
              disabled={!hasContent || isProcessing}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-blue-500 text-blue-400 hover:bg-blue-900 hover:bg-opacity-30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Wand2 size={15} />
              {processing === 'splitting' ? '分集中...' : '一键分集'}
            </button>
            <button
              onClick={handleExtractAssets}
              disabled={!hasContent || isProcessing}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg border border-green-500 text-green-400 hover:bg-green-900 hover:bg-opacity-30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Sparkles size={15} />
              {processing === 'extracting' ? '提取中...' : '提取全部资产'}
            </button>
            <button
              onClick={handleSplitAndExtract}
              disabled={!hasContent || isProcessing}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              <Layers size={15} />
              {processing === 'both' ? '处理中...' : '分集并提取'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
