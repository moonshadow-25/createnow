import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SessionEntry {
  key: string;        // `${projectId}_${episodeId || tabName}`
  projectId: string;
  projectName: string;
  episodeId?: string;
  tabName: string;
  label: string;      // "第3集" | "资产面板" | "剧本"
  createdAt: string;
  hasConversation: boolean; // 是否有过实际对话，false 时不显示在历史列表
}

interface VibeDramaState {
  isOpen: boolean;
  activeKey: string | null;
  sessions: SessionEntry[];
  panelWidth: number;

  open: () => void;
  close: () => void;
  toggle: () => void;
  setPanelWidth: (w: number) => void;
  /** 切换上下文：立即创建或更新 session（与原设计一致），hasConversation 默认 false */
  setContext: (ctx: Omit<SessionEntry, 'key' | 'createdAt' | 'hasConversation'>) => void;
  /** 发生实际对话时调用：将当前 activeKey 对应的 session 标记为 hasConversation=true */
  commitSession: () => void;
  removeSession: (key: string) => void;
  clearAllSessions: () => void;
}

export const useVibeDramaStore = create<VibeDramaState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      activeKey: null,
      sessions: [],
      panelWidth: 384,

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set(s => ({ isOpen: !s.isOpen })),
      setPanelWidth: (w) => set({ panelWidth: w }),

      setContext: (ctx) => {
        const key = `${ctx.projectId}_${ctx.episodeId || ctx.tabName}`;
        const { sessions } = get();
        const existing = sessions.find(s => s.key === key);
        if (!existing) {
          set({
            sessions: [...sessions, { ...ctx, key, createdAt: new Date().toISOString(), hasConversation: false }],
            activeKey: key,
          });
        } else {
          // 更新 label / projectName（集名称可能变化），保留 hasConversation
          set({
            sessions: sessions.map(s =>
              s.key === key ? { ...s, label: ctx.label, projectName: ctx.projectName } : s
            ),
            activeKey: key,
          });
        }
      },

      commitSession: () => {
        const { activeKey, sessions } = get();
        if (!activeKey) return;
        set({
          sessions: sessions.map(s =>
            s.key === activeKey ? { ...s, hasConversation: true } : s
          ),
        });
      },

      removeSession: (key) => {
        const { sessions, activeKey } = get();
        const session = sessions.find(s => s.key === key);
        if (session) {
          const storageKey = session.episodeId
            ? `conversation_${session.projectId}_${session.episodeId}`
            : `conversation_${session.projectId}_${session.tabName}`;
          localStorage.removeItem(storageKey);
        }
        const remaining = sessions.filter(s => s.key !== key);
        const newActive = activeKey === key
          ? (remaining.length > 0 ? remaining[remaining.length - 1].key : null)
          : activeKey;
        set({ sessions: remaining, activeKey: newActive });
      },

      clearAllSessions: () => {
        const { sessions } = get();
        sessions.forEach(session => {
          const storageKey = session.episodeId
            ? `conversation_${session.projectId}_${session.episodeId}`
            : `conversation_${session.projectId}_${session.tabName}`;
          localStorage.removeItem(storageKey);
        });
        set({ sessions: [], activeKey: null });
      },
    }),
    {
      name: 'vibe-drama-store',
      partialize: (s) => ({
        isOpen: s.isOpen,
        activeKey: s.activeKey,
        sessions: s.sessions,
        panelWidth: s.panelWidth,
      }),
    }
  )
);
