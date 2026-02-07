import { create } from 'zustand';

interface BatchPromptTask {
  assetId: string;
  assetName: string;
  assetType: 'character' | 'scene' | 'prop';
  status: 'pending' | 'generating' | 'success' | 'error';
  error?: string;
}

interface BatchPromptState {
  tasks: BatchPromptTask[];
  isRunning: boolean;
  currentProjectId: string | null;
  currentTab: 'all' | 'character' | 'scene' | 'prop' | null;
  startBatch: (
    projectId: string,
    tab: 'character' | 'scene' | 'prop',
    assets: Array<{ asset_id: string; name: string; description?: string; gender?: string; age?: string; location?: string }>,
    generateFn: (asset: any) => Promise<void>
  ) => Promise<void>;
  clearTasks: () => void;
  reset: () => void;
}

const STORAGE_KEY = 'batch-prompt-state';

// 从 sessionStorage 加载状态
const loadState = () => {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : undefined;
  } catch {
    return undefined;
  }
};

// 保存状态到 sessionStorage
const saveState = (state: BatchPromptState) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      tasks: state.tasks,
      isRunning: state.isRunning,
      currentProjectId: state.currentProjectId,
      currentTab: state.currentTab,
    }));
  } catch (e) {
    console.error('Failed to save batch prompt state:', e);
  }
};

export const useBatchPromptStore = create<BatchPromptState>()((set, get) => {
  const initialState = loadState() || {
    tasks: [],
    isRunning: false,
    currentProjectId: null,
    currentTab: null,
  };

  return {
    ...initialState,

    startBatch: async (
      projectId: string,
      tab: 'character' | 'scene' | 'prop',
      assets: Array<any>,
      generateFn: (asset: any) => Promise<void>
    ) => {
      // 初始化任务列表
      const tasks: BatchPromptTask[] = assets.map(asset => ({
        assetId: asset.asset_id,
        assetName: asset.name,
        assetType: tab,
        status: 'pending' as const,
      }));

      set({
        tasks,
        isRunning: true,
        currentProjectId: projectId,
        currentTab: tab,
      });
      saveState(get());

      // 依次执行每个任务
      for (let i = 0; i < tasks.length; i++) {
        // 更新状态为生成中
        set(state => {
          const newTasks = state.tasks.map((t, idx) =>
            idx === i ? { ...t, status: 'generating' as const } : t
          );
          const newState = { ...state, tasks: newTasks };
          saveState(newState);
          return newState;
        });

        try {
          await generateFn(assets[i]);

          // 更新状态为成功
          set(state => {
            const newTasks = state.tasks.map((t, idx) =>
              idx === i ? { ...t, status: 'success' as const } : t
            );
            const newState = { ...state, tasks: newTasks };
            saveState(newState);
            return newState;
          });
        } catch (error: any) {
          // 更新状态为错误
          set(state => {
            const newTasks = state.tasks.map((t, idx) =>
              idx === i ? { ...t, status: 'error' as const, error: error.message || '生成失败' } : t
            );
            const newState = { ...state, tasks: newTasks };
            saveState(newState);
            return newState;
          });
        }
      }

      // 所有任务完成
      set({ isRunning: false });
      saveState(get());
    },

    clearTasks: () => {
      set({ tasks: [], currentProjectId: null, currentTab: null });
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    },

    reset: () => {
      set({ tasks: [], isRunning: false, currentProjectId: null, currentTab: null });
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    },
  };
});

// 获取当前项目的批量生成任务
export const useCurrentBatchTasks = (projectId: string, tab: 'character' | 'scene' | 'prop') => {
  const state = useBatchPromptStore();

  // 如果项目或tab不匹配，返回空状态
  if (state.currentProjectId !== projectId || state.currentTab !== tab) {
    return { tasks: [], isRunning: false, progress: 0 };
  }

  const completedTasks = state.tasks.filter(t => t.status === 'success' || t.status === 'error').length;
  const progress = state.tasks.length > 0 ? (completedTasks / state.tasks.length) * 100 : 0;

  return {
    tasks: state.tasks,
    isRunning: state.isRunning,
    progress,
  };
};
