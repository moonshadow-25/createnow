export interface ConcurrencyTask<T, R> {
  task: T;
  success: boolean;
  result?: R;
  error?: any;
}

/**
 * 并发控制执行器
 * @param tasks 任务数组
 * @param fn 执行函数
 * @param concurrency 并发上限（默认10）
 * @param onProgress 进度回调
 * @param isMountedRef 组件挂载状态引用
 */
export async function runWithConcurrency<T, R>(
  tasks: T[],
  fn: (task: T) => Promise<R>,
  concurrency: number = 10,
  onProgress?: (completed: number, total: number) => void,
  isMountedRef?: { current: boolean }
): Promise<Array<ConcurrencyTask<T, R>>> {
  const results: Array<ConcurrencyTask<T, R>> = [];
  let completed = 0;
  let index = 0;

  const shouldContinue = () => isMountedRef ? isMountedRef.current : true;

  // 创建并发执行器
  const workers = Array(Math.min(concurrency, tasks.length))
    .fill(null)
    .map(async () => {
      while (index < tasks.length && shouldContinue()) {
        const currentIndex = index++;
        const task = tasks[currentIndex];

        try {
          const result = await fn(task);
          results[currentIndex] = { success: true, result, task };
        } catch (error) {
          // 如果是中止错误，不记录为失败
          if (error instanceof Error && error.name === 'AbortError') {
            results[currentIndex] = { success: false, error: 'Aborted', task };
          } else {
            console.error(`Task failed:`, task, error);
            results[currentIndex] = { success: false, error, task };
          }
        }

        completed++;
        if (shouldContinue() && onProgress) {
          onProgress(completed, tasks.length);
        }
      }
    });

  await Promise.all(workers);
  return results;
}
