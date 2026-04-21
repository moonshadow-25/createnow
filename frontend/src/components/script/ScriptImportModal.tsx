import { useState } from 'react';
import { X, FileText, Upload, AlertTriangle, Sparkles, Zap } from 'lucide-react';
import { scriptApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface ScriptImportModalProps {
  projectId: string;
  scriptId: string;
  scriptTitle: string;
  onClose: () => void;
  onImport: () => void;
}

interface ImportResult {
  title: string;
  characters_count: number;
  episodes_count: number;
  scenes_count: number;
  lines_count: number;
  warnings?: string[];
  unparsed_sample?: Array<{ line_number: number; content: string }>;
}

interface ImportProgress {
  sessionId: string;
  round: number;
  startAnchor: string;
  endAnchor: string;
  totals: {
    characters: number;
    episodes: number;
    scenes: number;
    lines: number;
  };
  statusText: string;
  warnings: string[];
}

export function ScriptImportModal({
  projectId,
  scriptId,
  scriptTitle,
  onClose,
  onImport
}: ScriptImportModalProps) {
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<ImportProgress>({
    sessionId: '',
    round: 0,
    startAnchor: '',
    endAnchor: '',
    totals: { characters: 0, episodes: 0, scenes: 0, lines: 0 },
    statusText: '',
    warnings: [],
  });

  const handleImport = async () => {
    if (!content.trim()) {
      toast('请输入剧本内容', 'error');
      return;
    }

    setImporting(true);
    setImportResult(null);
    setProgress({
      sessionId: '',
      round: 0,
      startAnchor: '',
      endAnchor: '',
      totals: { characters: 0, episodes: 0, scenes: 0, lines: 0 },
      statusText: useAi ? '准备开始多轮导入...' : '准备导入...',
      warnings: [],
    });

    try {
      if (!useAi) {
        const response = await scriptApi.import(projectId, scriptId, content, false);
        const result = response.data as ImportResult;
        setImportResult(result);
        const successMsg = `导入成功！人物: ${result.characters_count}, 集数: ${result.episodes_count}, 场景: ${result.scenes_count}, 镜头: ${result.lines_count}`;
        toast(successMsg, 'success');
        onImport();
        return;
      }

      const req = scriptApi.importStream(projectId, scriptId, content, true);
      const response = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: req.body,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          let evt: any = null;
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }

          if (evt.type === 'status') {
            setProgress(prev => ({
              ...prev,
              sessionId: evt.session_id || prev.sessionId,
              statusText: evt.content || prev.statusText,
            }));
          } else if (evt.type === 'round_progress') {
            setProgress(prev => ({
              ...prev,
              sessionId: evt.session_id || prev.sessionId,
              round: evt.round || prev.round,
              startAnchor: evt.start_anchor || '',
              endAnchor: evt.end_anchor || '',
              totals: evt.totals || prev.totals,
              statusText: evt.has_more ? `第${evt.round}轮完成，继续下一轮...` : `第${evt.round}轮完成`,
            }));
          } else if (evt.type === 'error') {
            throw new Error(evt.content || '导入失败');
          } else if (evt.type === 'done') {
            const totals = evt.totals || progress.totals;
            const warnings = evt.warnings || [];
            setProgress(prev => ({
              ...prev,
              sessionId: evt.session_id || prev.sessionId,
              totals,
              warnings,
              statusText: '导入完成',
            }));
            setImportResult({
              title: scriptTitle,
              characters_count: totals.characters || 0,
              episodes_count: totals.episodes || 0,
              scenes_count: totals.scenes || 0,
              lines_count: totals.lines || 0,
              warnings,
              unparsed_sample: [],
            });
            toast(
              `导入完成！人物: ${totals.characters || 0}, 集数: ${totals.episodes || 0}, 场景: ${totals.scenes || 0}, 镜头: ${totals.lines || 0}`,
              'success'
            );
            onImport();
            return;
          }
        }
      }
    } catch (error: any) {
      toast(`导入失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setContent(event.target?.result as string);
    reader.readAsText(file, 'utf-8');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Upload size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold">导入剧本</h2>
            <span className="text-sm text-gray-400">({scriptTitle})</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 解析模式切换 */}
          <div className="flex items-center gap-2 p-3 bg-gray-750 rounded-lg border border-gray-600">
            <span className="text-sm text-gray-400 mr-1">解析方式：</span>
            <button
              onClick={() => setUseAi(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition ${
                useAi
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <Sparkles size={14} />
              AI 智能解析
            </button>
            <button
              onClick={() => setUseAi(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition ${
                !useAi
                  ? 'bg-gray-500 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <Zap size={14} />
              快速解析（正则）
            </button>
            <span className="ml-2 text-xs text-gray-500">
              {useAi ? '支持任意格式，自动提取角色和场景' : '仅支持标准格式，速度更快'}
            </span>
          </div>

          {/* 文件上传 + 文本输入 */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">粘贴剧本内容或上传文件</label>
            <div className="mb-3">
              <label className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded cursor-pointer w-fit">
                <FileText size={16} />
                <span>选择文件</span>
                <input
                  type="file"
                  accept=".txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-64 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm font-mono resize-none"
              placeholder={useAi
                ? '粘贴任意格式的剧本内容，AI 将自动识别角色、场景、对白...'
                : `标准格式示例：\n《剧本名称》\n人物表：\n角色名：描述\n\n第1集\n一、场景名  日  外\n△ 视觉描述\n角色名（语气）：台词`}
            />
          </div>

          {/* 解析中提示 */}
          {importing && (
            <div className="flex items-start gap-3 p-3 bg-purple-900 bg-opacity-30 border border-purple-700 rounded">
              <div className="animate-spin w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full flex-shrink-0 mt-0.5" />
              <div className="text-sm text-purple-300 space-y-1">
                <div>{progress.statusText || (useAi ? 'AI 正在理解剧本结构，请稍候...' : '正在解析剧本...')}</div>
                {useAi && (
                  <>
                    <div className="text-xs text-purple-200">
                      会话: {progress.sessionId || '初始化中'} | 轮次: {progress.round || 0}
                    </div>
                    <div className="text-xs text-purple-200">
                      累计导入 - 人物 {progress.totals.characters} / 集数 {progress.totals.episodes} / 场景 {progress.totals.scenes} / 镜头 {progress.totals.lines}
                    </div>
                    {(progress.startAnchor || progress.endAnchor) && (
                      <div className="text-xs text-purple-200 break-all">
                        锚点: {progress.startAnchor || '（起点）'} → {progress.endAnchor || '（本轮结束）'}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* 警告信息 */}
          {importResult && importResult.warnings && importResult.warnings.length > 0 && (
            <div className="bg-yellow-900 bg-opacity-30 border border-yellow-700 rounded p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-yellow-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-yellow-400 mb-2">解析警告：</p>
                  <ul className="text-xs text-yellow-200 space-y-1">
                    {importResult.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* 未解析内容样例（正则模式） */}
          {importResult && importResult.unparsed_sample && importResult.unparsed_sample.length > 0 && (
            <div className="bg-orange-900 bg-opacity-20 border border-orange-700 rounded p-3">
              <p className="text-sm font-semibold text-orange-400 mb-2">未能解析的内容样例：</p>
              <div className="text-xs text-orange-200 font-mono space-y-0.5">
                {importResult.unparsed_sample.map((line, index) => (
                  <div key={index} className="truncate">
                    <span className="text-gray-500">第{line.line_number}行:</span> {line.content}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            disabled={importing}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleImport}
            disabled={importing || !content.trim()}
            className={`px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${
              useAi
                ? 'bg-purple-600 hover:bg-purple-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {importing ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                {useAi ? 'AI 解析中...' : '导入中...'}
              </>
            ) : (
              <>
                {useAi ? <Sparkles size={16} /> : <Upload size={16} />}
                {useAi ? 'AI 智能导入' : '快速导入'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
