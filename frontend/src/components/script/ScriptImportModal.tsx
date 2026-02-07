import { useState } from 'react';
import { X, FileText, Upload, AlertTriangle } from 'lucide-react';
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

export function ScriptImportModal({
  projectId,
  scriptId,
  scriptTitle,
  onClose,
  onImport
}: ScriptImportModalProps) {
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const handleImport = async () => {
    if (!content.trim()) {
      toast('请输入剧本内容', 'error');
      return;
    }

    setImporting(true);
    setImportResult(null);
    try {
      const response = await scriptApi.import(projectId, scriptId, content);
      const result = response.data as ImportResult;

      setImportResult(result);

      // 构建成功消息
      const successMsg = `导入成功！标题: ${result.title || scriptTitle}, 人物: ${result.characters_count}, 集数: ${result.episodes_count}, 场景: ${result.scenes_count}, 镜头: ${result.lines_count}`;

      toast(successMsg, 'success');
      onImport();
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
    reader.onload = (event) => {
      setContent(event.target?.result as string);
    };
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
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">粘贴剧本内容或上传文件</label>

            {/* 文件上传按钮 */}
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

            {/* 文本输入区 */}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full h-64 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm font-mono resize-none"
              placeholder="请粘贴剧本内容，格式如下：

《剧本名称》
人物表：
角色名：描述
角色名：年龄，性别，描述

第1集
一、场景名  日  外
△ 视觉镜头描述
角色名（语气）：台词内容
..."
            />
          </div>

          {/* 警告信息 */}
          {importResult && importResult.warnings && importResult.warnings.length > 0 && (
            <div className="mb-4 bg-yellow-900 bg-opacity-30 border border-yellow-700 rounded p-3">
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

          {/* 未解析内容样例 */}
          {importResult && importResult.unparsed_sample && importResult.unparsed_sample.length > 0 && (
            <div className="mb-4 bg-orange-900 bg-opacity-20 border border-orange-700 rounded p-3">
              <p className="text-sm font-semibold text-orange-400 mb-2">未能解析的内容样例：</p>
              <div className="text-xs text-orange-200 font-mono">
                {importResult.unparsed_sample.map((line, index) => (
                  <div key={index} className="truncate">
                    <span className="text-gray-500">第{line.line_number}行:</span> {line.content}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 格式说明 */}
          <div className="bg-gray-750 rounded p-3 text-xs text-gray-400">
            <p className="font-semibold text-gray-300 mb-2">剧本格式规范：</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>场景头格式：一、场景名  日/夜  内/外（使用中文数字序号）</li>
              <li>视觉镜头：△ 开头，如：△ 【视觉开场】：镜头由远及近...</li>
              <li>对话格式：角色名（语气）：台词内容</li>
              <li>画外音：角色名（OS）：台词内容</li>
            </ul>
          </div>
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
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {importing ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                导入中...
              </>
            ) : (
              <>
                <Upload size={16} />
                导入剧本
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
