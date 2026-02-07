import { useState, useEffect } from 'react';
import { RefreshCw, X, ChevronDown, Code, FileText, AlertCircle, Image, Video } from 'lucide-react';
import { generationApi } from '@/services/api';

interface LogsPanelProps {
  projectId: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'llm' | 'image' | 'video';
  request: Record<string, any>;
  response?: Record<string, any>;
  error?: string;
  success: boolean;
  metadata?: {
    model?: string;
    api_url?: string;
    operation?: string;
  };
}

export function LogsPanel({ projectId }: LogsPanelProps) {
  const [aiLogs, setAiLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logFilterType, setLogFilterType] = useState<'all' | 'llm' | 'image' | 'video'>('all');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadAILogs();
  }, [logFilterType]);

  const loadAILogs = async () => {
    if (!projectId) return;
    setLogsLoading(true);
    try {
      const response = await generationApi.getAILogs(projectId, {
        type: logFilterType === 'all' ? undefined : logFilterType,
        limit: 100,
      });
      setAiLogs(response.data.logs || []);
    } catch (error) {
      console.error('Failed to load AI logs:', error);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleClearAILogs = async () => {
    if (!confirm(`确定清除所有${logFilterType === 'all' ? '' : logFilterType}日志吗？`)) return;
    if (!projectId) return;

    try {
      await generationApi.clearAILogs(projectId, logFilterType === 'all' ? undefined : logFilterType);
      setAiLogs([]);
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  };

  const toggleLogExpand = (id: string) => {
    setExpandedLogIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'llm': return <FileText size={16} className="text-blue-400" />;
      case 'image': return <Image size={16} className="text-green-400" />;
      case 'video': return <Video size={16} className="text-purple-400" />;
      default: return null;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'llm': return 'LLM';
      case 'image': return '生图';
      case 'video': return '生视频';
      default: return type;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'llm': return 'bg-blue-900 text-blue-300';
      case 'image': return 'bg-green-900 text-green-300';
      case 'video': return 'bg-purple-900 text-purple-300';
      default: return 'bg-gray-700 text-gray-300';
    }
  };

  return (
    <>
      {/* 子功能tab栏 */}
      <div className="flex border-b border-gray-700 overflow-x-auto">
        {(['all', 'llm', 'image', 'video'] as const).map((type) => (
          <button
            key={type}
            onClick={() => {
              setLogFilterType(type);
            }}
            className={`px-4 py-3 font-medium text-sm transition whitespace-nowrap ${
              logFilterType === type
                ? 'border-b-2 border-green-500 text-green-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {type === 'all' ? '全部' : getTypeLabel(type)}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        <div className="space-y-2">
          <div className="flex justify-end gap-2 mb-2">
            <button
              onClick={loadAILogs}
              disabled={logsLoading}
              className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs"
              title="刷新"
            >
              <RefreshCw size={14} className={logsLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleClearAILogs}
              className="p-1.5 bg-red-600 hover:bg-red-700 rounded text-xs"
              title="清除日志"
            >
              <X size={14} />
            </button>
          </div>
          {logsLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full"></div>
            </div>
          ) : aiLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-gray-500">
              <FileText size={32} className="mb-2 opacity-50" />
              <p className="text-sm">暂无AI交互日志</p>
            </div>
          ) : (
            <div className="space-y-2">
              {aiLogs.map(log => {
                const isExpanded = expandedLogIds.has(log.id);
                return (
                  <div
                    key={log.id}
                    className="bg-gray-700 rounded overflow-hidden"
                  >
                    <div
                      onClick={() => toggleLogExpand(log.id)}
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-600 transition"
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <Code size={14} />}
                      {getTypeIcon(log.type)}
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${getTypeColor(log.type)}`}>
                        {getTypeLabel(log.type)}
                      </span>
                      <span className="text-xs text-gray-300 flex-1 truncate">
                        {log.metadata?.operation || 'unknown'}
                      </span>
                      {log.success ? (
                        <span className="text-green-400 text-xs">成功</span>
                      ) : (
                        <span className="text-red-400 text-xs flex items-center gap-1">
                          <AlertCircle size={10} />
                          失败
                        </span>
                      )}
                      <span className="text-xs text-gray-500">
                        {new Date(log.timestamp).toLocaleTimeString('zh-CN')}
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="px-3 pb-3 border-t border-gray-600 pt-2">
                        {/* 元数据 */}
                        {log.metadata && (
                          <div className="mb-2">
                            <div className="text-xs text-gray-400 mb-1">元数据</div>
                            <div className="bg-gray-800 rounded p-2 text-xs font-mono">
                              {Object.entries(log.metadata).map(([key, value]) => (
                                <div key={key} className="text-gray-300">
                                  <span className="text-blue-400">{key}:</span> {String(value)}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {JSON.stringify(log.request, null, 2)}
                        </pre>
                        {log.response && (
                          <div className="mt-2">
                            <div className="text-xs text-gray-400 mb-1">响应数据</div>
                            <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto bg-gray-800 rounded p-2">
                              {JSON.stringify(log.response, null, 2)}
                            </pre>
                          </div>
                        )}
                        {log.error && (
                          <div className="mt-2 text-xs text-red-300 bg-red-900/30 rounded p-2">
                            {log.error}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {aiLogs.length > 0 && (
            <div className="text-xs text-gray-500 pt-2">
              共 {aiLogs.length} 条记录 · 只显示最近 100 条
            </div>
          )}
        </div>
      </div>
    </>
  );
}
