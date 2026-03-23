import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SessionEntry {
  key: string;        // `${projectId}_${episodeId || tabName}`
  projectId: string;
  episodeId?: string;
  tabName: string;
  label: string;      // "第3集" | "资产面板" | "剧本"
  createdAt: string;
}

interface VibeDramaState {
  isOpen: boolean;
  activeKey: string | null;
  sessions: SessionEntry[];

  open: () => void;
  close: () => void;
  toggle: () => void;
  setContext: (ctx: Omit<SessionEntry, 'key' | 'createdAt'>) => void;
  removeSession: (key: string) => void;
}

export const useVibeDramaStore = create<VibeDramaState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      activeKey: null,
      sessions: [],

      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set(s => ({ isOpen: !s.isOpen })),

      setContext: (ctx) => {
        const key = `${ctx.projectId}_${ctx.episodeId || ctx.tabName}`;
        const sessions = get().sessions;
        if (!sessions.find(s => s.key === key)) {
          set({ sessions: [...sessions, { ...ctx, key, createdAt: new Date().toISOString() }] });
        } else {
          // 更新 label（集名称可能变化）
          set({
            sessions: sessions.map(s => s.key === key ? { ...s, label: ctx.label } : s),
          });
        }
        set({ activeKey: key });
      },

      removeSession: (key) => {
        const { sessions, activeKey } = get();
        // 同时清除该 session 对应的 localStorage 对话数据，防止旧 conversationId 残留
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
    }),
    {
      name: 'vibe-drama-store',
      partialize: (s) => ({ isOpen: s.isOpen, activeKey: s.activeKey, sessions: s.sessions }),
    }
  )
);
