import React, { useState, useRef } from 'react';
import { Sparkles, X, History, ChevronRight, Trash2 } from 'lucide-react';
import { useVibeDramaStore, SessionEntry } from '@/store/vibeDramaStore';
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

export function VibeDramaPanel() {
  const { isOpen, activeKey, sessions, toggle, close, setContext, removeSession } = useVibeDramaStore();
  const [showHistory, setShowHistory] = useState(false);
  const [panelWidth, setPanelWidth] = useState(384);
  const dragStartX = useRef<number | null>(null);
  const dragStartWidth = useRef(384);

  const activeSession = sessions.find(s => s.key === activeKey) ?? null;

  const handleResizeStart = (e: React.MouseEvent) => {
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
  };

  return (
    <>
      {/* FAB 触发按钮 */}
      <button
        onClick={toggle}
        className="fixed bottom-6 right-6 z-50 w-13 h-13 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 bg-indigo-600 hover:bg-indigo-500 active:scale-95"
        style={{ width: 52, height: 52 }}
        title="Vibe Drama AI"
      >
        {isOpen ? (
          <X size={22} className="text-white" />
        ) : (
          <Sparkles size={22} className="text-white" />
        )}
        {/* 有上下文时的绿点 */}
        {activeSession && !isOpen && (
          <span className="absolute top-0.5 right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-gray-900" />
        )}
      </button>

      {/* 滑出面板 */}
      <div
        className="fixed top-16 right-0 bg-gray-900 border-l border-gray-700 flex flex-col z-40 transition-transform duration-300 shadow-2xl"
        style={{
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          width: panelWidth,
          height: 'calc(100vh - 64px)',
        }}
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
            <Sparkles size={15} className="text-indigo-400" />
            <span className="text-sm font-semibold text-indigo-300">Vibe Drama</span>
            {activeSession && (
              <span className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">
                {activeSession.label}
              </span>
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
              onClick={close}
              className="p-1.5 text-gray-500 hover:text-gray-300 rounded transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 历史列表（可折叠） */}
        {showHistory && (
          <div className="border-b border-gray-700 bg-gray-850 flex-shrink-0 max-h-48 overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="text-xs text-gray-500 px-4 py-3">暂无历史对话</p>
            ) : (
              <div className="py-1">
                {[...sessions].reverse().map(session => (
                  <button
                    key={session.key}
                    onClick={() => {
                      setContext({
                        projectId: session.projectId,
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
                      <div className="text-xs font-medium text-gray-300 truncate">{session.label}</div>
                      <div className="text-xs text-gray-500 truncate">{getSessionPreview(session) || '空对话'}</div>
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
            <Sparkles size={36} className="mb-3 text-indigo-600" />
            <p className="text-sm font-medium text-gray-400">Vibe Drama 等你来</p>
            <p className="text-xs mt-1">打开一个剧集或面板，AI 会自动获取上下文</p>
          </div>
        )}

        {/* 多 Session 并发：每个 session 对应一个 ChatTab，用 hidden 切换可见性 */}
        {sessions.map(session => (
          <div
            key={session.key}
            className={`flex-1 flex flex-col min-h-0 ${session.key === activeKey ? '' : 'hidden'}`}
          >
            <ChatTab
              projectId={session.projectId}
              episodeId={session.episodeId}
              label={session.label}
            />
          </div>
        ))}
      </div>
    </>
  );
}
