import { create } from 'zustand';

interface GenerationTask {
  storyboardId: string;
  operation: 'prompt' | 'image' | 'video' | 'auto_generate' | 'image_edit' | 'triple_grid' | 'insert_storyboard' | 'inbetween' | 'multi_fusion' | 'first_last_video' | 'create_end_frame';
  status: 'pending' | 'generating' | 'success' | 'error';
  error?: string;
}

interface StoryboardGenerationState {
  tasks: GenerationTask[];
  // 获取特定分镜和操作的状态
  getTaskStatus: (storyboardId: string, operation: GenerationTask['operation']) => GenerationTask['status'] | null;
  // 开始任务
  startTask: (storyboardId: string, operation: GenerationTask['operation']) => void;
  // 标记任务成功
  completeTask: (storyboardId: string, operation: GenerationTask['operation']) => void;
  // 标记任务失败
  failTask: (storyboardId: string, operation: GenerationTask['operation'], error: string) => void;
  // 清除特定分镜的所有任务
  clearStoryboardTasks: (storyboardId: string) => void;
  // 检查是否有任何操作正在进行
  hasRunningTask: (storyboardId?: string) => boolean;
}

export const useStoryboardGenerationStore = create<StoryboardGenerationState>((set, get) => ({
  tasks: [],

  getTaskStatus: (storyboardId, operation) => {
    const task = get().tasks.find(t => t.storyboardId === storyboardId && t.operation === operation);
    return task?.status || null;
  },

  startTask: (storyboardId, operation) => {
    set(state => {
      // 移除同一分镜同一操作的旧任务
      const filteredTasks = state.tasks.filter(
        t => !(t.storyboardId === storyboardId && t.operation === operation)
      );
      return {
        tasks: [...filteredTasks, { storyboardId, operation, status: 'generating' }]
      };
    });
  },

  completeTask: (storyboardId, operation) => {
    set(state => ({
      tasks: state.tasks.map(t =>
        t.storyboardId === storyboardId && t.operation === operation
          ? { ...t, status: 'success' as const }
          : t
      )
    }));
  },

  failTask: (storyboardId, operation, error) => {
    set(state => ({
      tasks: state.tasks.map(t =>
        t.storyboardId === storyboardId && t.operation === operation
          ? { ...t, status: 'error' as const, error }
          : t
      )
    }));
  },

  clearStoryboardTasks: (storyboardId) => {
    set(state => ({
      tasks: state.tasks.filter(t => t.storyboardId !== storyboardId)
    }));
  },

  hasRunningTask: (storyboardId) => {
    const tasks = get().tasks;
    const filteredTasks = storyboardId
      ? tasks.filter(t => t.storyboardId === storyboardId)
      : tasks;
    return filteredTasks.some(t => t.status === 'generating');
  },
}));

// 便捷 hook：获取特定分镜的生成状态
export const useStoryboardGenerating = (storyboardId: string, operation: GenerationTask['operation']) => {
  const status = useStoryboardGenerationStore(state => state.getTaskStatus(storyboardId, operation));
  return status === 'generating';
};

// 便捷 hook：检查整个组件是否有任何正在运行的任务
export const useAnyGenerating = () => {
  return useStoryboardGenerationStore(state => state.hasRunningTask());
};
