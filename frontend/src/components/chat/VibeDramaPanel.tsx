import React, { useState, useRef, useCallback } from 'react';
import { X, History, ChevronRight, Trash2, Code } from 'lucide-react';
import { useVibeDramaStore, SessionEntry } from '@/store/vibeDramaStore';
import { useAssetStore } from '@/store/assetStore';
import { ChatTab } from './ChatTab';

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
}

function getSessionPreview(session: SessionEntry): string {
  try {
    const key = `conversation_${session.projectId}_${session.episodeId || session.tabName}`;
    const saved = localStorage.getItem(key);
    if (!saved) return '';
    const data = JSON.parse(saved);
    const firstUser = (data.messages || []).find((m: any) => m.role === 'user');
    return firstUser ? firstUser.content.slice(0, 28) : '';
  } catch {
    return '';
  }
}

interface DebugPromptModalProps {
  projectId: string;
  episodeId?: string;
  tabName: string;
  onClose: () => void;
}

function DebugPromptModal({ projectId, episodeId, tabName, onClose }: DebugPromptModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ system_prompt: string; tools_desc: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'system' | 'tools'>('system');

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (episodeId) params.set('episode_id', episodeId);
    else params.set('tab_name', tabName);
    const _token = localStorage.getItem('saas_token') || localStorage.getItem('admin_token');
    fetch(`/api/projects/${projectId}/chat/debug-prompt?${params}`, {
      headers: _token ? { Authorization: `Bearer ${_token}` } : {},
    })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [projectId, episodeId, tabName]);

  const content = tab === 'system' ? data?.system_prompt : data?.tools_desc;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-indigo-300">注入提示词（调试）</span>
            <div className="flex gap-1">
              <button
                onClick={() => setTab('system')}
                className={`px-3 py-1 text-xs rounded ${tab === 'system' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                System Prompt
              </button>
              <button
                onClick={() => setTab('tools')}
                className={`px-3 py-1 text-xs rounded ${tab === 'tools' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                Tools Desc
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {content && (
              <button
                onClick={() => navigator.clipboard.writeText(content)}
                className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
              >
                复制
              </button>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-white">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 min-h-0">
          {loading && <p className="text-gray-400 text-sm">加载中...</p>}
          {error && <p className="text-red-400 text-sm">错误: {error}</p>}
          {content && (
            <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function VibeDramaPanel() {
  const { isOpen, activeKey, sessions, panelWidth, toggle, setContext, removeSession, clearAllSessions, setPanelWidth } = useVibeDramaStore();
  const { episodes } = useAssetStore();
  const [showHistory, setShowHistory] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const dragStartX = useRef<number | null>(null);
  const dragStartWidth = useRef(panelWidth);

  const activeSession = sessions.find(s => s.key === activeKey) ?? null;
  // 历史列表：只展示有实际对话的 session
  const historySessions = sessions.filter(s => s.hasConversation);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    const handleMouseMove = (e: MouseEvent) => {
      if (dragStartX.current === null) return;
      const delta = dragStartX.current - e.clientX;
      setPanelWidth(Math.max(280, Math.min(900, dragStartWidth.current + delta)));
    };
    const handleMouseUp = () => {
      dragStartX.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelWidth]);

  return (
    <>
      {/* fixed 定位，始终挂载，isOpen=false 时用 CSS 隐藏，保持流式传输不中断 */}
      <div
        className="fixed bottom-0 right-0 bg-gray-900 border-l border-gray-700 flex flex-col z-40 shadow-2xl"
        style={{ width: panelWidth, height: 'calc(100vh - 73px)', display: isOpen ? 'flex' : 'none' }}
      >
        {/* 左侧拖拽调宽手柄 */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500 transition-colors z-10"
          title="拖拽调整宽度"
        />

        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0 bg-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none select-none">🦞</span>
            <span className="text-sm font-semibold text-red-300">小龙虾</span>
            {activeSession && (
              <button
                onClick={() => setDebugOpen(true)}
                className="text-xs text-gray-400 bg-gray-700 hover:bg-gray-600 hover:text-indigo-300 px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors"
                title="查看注入上下文提示词（调试）"
              >
                <Code size={10} />
                {activeSession.label}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowHistory(h => !h)}
              className={`p-1.5 rounded transition-colors ${showHistory ? 'text-indigo-400 bg-gray-700' : 'text-gray-500 hover:text-gray-300'}`}
              title="历史对话"
            >
              <History size={15} />
            </button>
            <button
              onClick={toggle}
              className="p-1.5 text-gray-500 hover:text-gray-300 rounded transition-colors"
              title="收起"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 历史列表（可折叠） */}
        {showHistory && (
          <div className="border-b border-gray-700 bg-gray-850 flex-shrink-0 max-h-52 overflow-y-auto">
            <div className="flex items-center justify-between px-4 pt-2 pb-1">
              <span className="text-xs text-gray-500 font-medium">历史对话</span>
              {historySessions.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('确定清空全部历史记录？此操作不可撤销。')) {
                      clearAllSessions();
                      setShowHistory(false);
                    }
                  }}
                  className="text-xs text-gray-600 hover:text-red-400 flex items-center gap-0.5 transition-colors"
                  title="清空全部历史"
                >
                  <Trash2 size={11} />
                  清空
                </button>
              )}
            </div>
            {historySessions.length === 0 ? (
              <p className="text-xs text-gray-500 px-4 py-3">暂无历史对话</p>
            ) : (
              <div className="py-1">
                {[...historySessions].reverse().map(session => (
                  <button
                    key={session.key}
                    onClick={() => {
                      setContext({
                        projectId: session.projectId,
                        projectName: session.projectName,
                        episodeId: session.episodeId,
                        tabName: session.tabName,
                        label: session.label,
                      });
                      setShowHistory(false);
                    }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-700 transition-colors group ${
                      session.key === activeKey ? 'bg-gray-700/60' : ''
                    }`}
                  >
                    {session.key === activeKey && (
                      <ChevronRight size={11} className="text-indigo-400 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-300 truncate">
                        {session.projectName ? `${session.projectName} · ${session.label}` : session.label}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{getSessionPreview(session) || '暂无消息'}</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-xs text-gray-600">{formatDate(session.createdAt)}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeSession(session.key); }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-red-400 transition-all"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 无上下文占位 */}
        {sessions.length === 0 && !showHistory && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-500">
            <span className="text-5xl mb-3 select-none">🦞</span>
            <p className="text-sm font-medium text-gray-400">小龙虾等你来</p>
            <p className="text-xs mt-1">我可以创建、修改分镜、资产中的所有内容，告诉我你的想法，我来实现</p>
          </div>
        )}

        {/* 多 Session 并发：每个 session 对应一个 ChatTab，用 hidden 切换可见性 */}
        {sessions.map(session => {
          const episode = session.episodeId ? episodes.find(e => e.episode_id === session.episodeId || (e as any).asset_id === session.episodeId) : undefined;
          return (
            <div
              key={session.key}
              className={`flex-1 flex flex-col min-h-0 ${session.key === activeKey ? '' : 'hidden'}`}
            >
              <ChatTab
                projectId={session.projectId}
                episodeId={session.episodeId}
                label={session.label}
                tabName={session.tabName}
                scriptContent={episode?.script_content}
              />
            </div>
          );
        })}
      </div>

      {/* 调试提示词弹窗 */}
      {debugOpen && activeSession && (
        <DebugPromptModal
          projectId={activeSession.projectId}
          episodeId={activeSession.episodeId}
          tabName={activeSession.tabName}
          onClose={() => setDebugOpen(false)}
        />
      )}
    </>
  );
}
