import { useState, useEffect, useRef } from 'react';
import { Plus, RefreshCw, Wand2, Loader2, HardDrive, Zap } from 'lucide-react';
import { AssetCard } from './AssetCard';
import { CreateAssetDialog } from './CreateAssetDialog';
import { generationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import { useCurrentBatchTasks, useBatchPromptStore } from '@/store/batchPromptStore';
import { useDownloadState, downloadStore } from '@/store/downloadStore';

interface Asset {
  asset_id: string;
  name: string;
  description: string;
  parent_id?: string;
  [key: string]: any;
}

interface AssetsTabProps {
  projectId: string;
  characters: Asset[];
  scenes: Asset[];
  props: Asset[];
  onRefresh: () => void;
}

export function AssetsTab({
  projectId,
  characters,
  scenes,
  props,
  onRefresh,
}: AssetsTabProps) {
  const { toast } = useToast();
  const [assetFilter, setAssetFilter] = useState<'all' | 'character' | 'scene' | 'prop'>('all');
  const [showCreateAsset, setShowCreateAsset] = useState(false);
  const [createAssetType, setCreateAssetType] = useState<'character' | 'scene' | 'prop'>('character');

  // 获取批量生成状态
  const { tasks, isRunning } = useCurrentBatchTasks(
    projectId,
    assetFilter === 'all' ? 'character' : assetFilter
  );
  const { startBatch, clearTasks } = useBatchPromptStore();

  // 获取图片下载状态
  const downloadState = useDownloadState(projectId);
  const isDownloading = downloadState.status === 'running';
  const downloadProgress = downloadState.progress?.download_progress || 0;

  // 一键生成状态
  const [isOneClickGenerating, setIsOneClickGenerating] = useState(false);
  const [oneClickPhase, setOneClickPhase] = useState<'prompt' | 'image' | null>(null);
  const [oneClickProgress, setOneClickProgress] = useState({ current: 0, total: 0 });

  // 组件挂载状态，用于防止组件卸载后更新状态
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 组件卸载时标记为未挂载，取消正在进行的操作
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // 轮询下载状态
  useEffect(() => {
    if (isDownloading) {
      const pollInterval = setInterval(async () => {
        try {
          const response = await generationApi.getDownloadStatus(projectId);
          downloadStore.setState(projectId, {
            status: response.data.status,
            progress: response.data.progress,
            currentImage: response.data.current || '',
            errors: response.data.errors || [],
          });

          // 下载完成或失败时停止轮询
          if (response.data.status === 'completed') {
            downloadStore.completeDownload(projectId);
            clearInterval(pollInterval);
            toast(`图片下载完成！已下载 ${response.data.progress.downloaded_images}/${response.data.progress.total_images} 张`, 'success');
            onRefresh(); // 刷新以使用本地图片
          } else if (response.data.status === 'error') {
            downloadStore.failDownload(projectId, '下载失败');
            clearInterval(pollInterval);
            toast('图片下载失败，请重试', 'error');
          }
        } catch (error) {
          console.error('Failed to poll download status:', error);
        }
      }, 1000);

      return () => clearInterval(pollInterval);
    }
  }, [isDownloading, projectId, toast, onRefresh]);

  // 当不在对应tab时清除任务
  useEffect(() => {
    if (assetFilter === 'all') {
      clearTasks();
    }
  }, [assetFilter, clearTasks]);

  const handleOpenCreate = (type: 'character' | 'scene' | 'prop') => {
    setCreateAssetType(type);
    setShowCreateAsset(true);
  };

  // 获取当前tab的主资产列表（排除子角色）
  const getMainAssets = (): { assets: Asset[]; type: 'character' | 'scene' | 'prop' } => {
    if (assetFilter === 'character') {
      return { assets: characters.filter(c => !c.parent_id), type: 'character' };
    }
    if (assetFilter === 'scene') {
      return { assets: scenes, type: 'scene' };
    }
    if (assetFilter === 'prop') {
      return { assets: props, type: 'prop' };
    }
    return { assets: [], type: 'character' };
  };

  // 批量生成提示词
  const handleBatchGenerate = async () => {
    const { assets, type } = getMainAssets();

    if (assets.length === 0) {
      toast('当前没有可生成提示词的资产', 'error');
      return;
    }

    // 单个资产生成提示词的函数
    const generateSingleAsset = async (asset: Asset) => {
      let enhancedDescription = asset.description || '';
      if (type === 'character') {
        const details = [];
        if (asset.gender) details.push(`性别: ${asset.gender}`);
        if (asset.age) details.push(`年龄: ${asset.age}`);
        if (details.length > 0) enhancedDescription += `\n${details.join(', ')}`;
      } else if (type === 'scene' && asset.location) {
        enhancedDescription += `\n地点: ${asset.location}`;
      }

      await generationApi.generateImagePrompt(projectId, {
        asset_type: type,
        description: enhancedDescription,
        asset_id: asset.asset_id,  // 传入 asset_id，后端会自动保存
      });

      // 后端已自动保存，不需要手动保存
    };

    await startBatch(projectId, type, assets, generateSingleAsset);
    onRefresh();
    toast('批量生成完成', 'success');
  };

  // 一键下载所有图片
  const handleDownloadAll = async () => {
    try {
      downloadStore.startDownload(projectId);
      await generationApi.downloadAllImages(projectId);
      toast('开始下载所有图片...', 'info');
    } catch (error: any) {
      downloadStore.failDownload(projectId, error.message || '下载启动失败');
      toast('启动下载失败: ' + (error.response?.data?.detail || error.message), 'error');
    }
  };

  /**
   * 并发控制执行器
   * @param tasks 任务数组
   * @param fn 执行函数
   * @param concurrency 并发上限（默认10）
   * @param onProgress 进度回调
   */
  async function runWithConcurrency<T, R>(
    tasks: T[],
    fn: (task: T) => Promise<R>,
    concurrency: number = 10,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Array<{ success: boolean; result?: R; error?: any; task: T }>> {
    const results: Array<{ success: boolean; result?: R; error?: any; task: T }> = [];
    let completed = 0;
    let index = 0;

    // 创建并发执行器
    const workers = Array(Math.min(concurrency, tasks.length))
      .fill(null)
      .map(async () => {
        while (index < tasks.length && isMountedRef.current) {
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
              results[currentIndex] = { success: false, error, task };
            }
          }

          completed++;
          if (isMountedRef.current && onProgress) {
            onProgress(completed, tasks.length);
          }
        }
      });

    await Promise.all(workers);
    return results;
  }

  /**
   * 一键生成：自动生成所有资产的提示词和图片
   */
  const handleOneClickGenerate = async () => {
    // 1. 收集需要处理的资产
    const allAssets = [
      ...characters.filter(c => !c.parent_id),
      ...scenes,
      ...props
    ];

    if (allAssets.length === 0) {
      toast('当前没有资产，请先创建资产', 'error');
      return;
    }

    const assetsNeedPrompt = allAssets.filter(a => !a.image_prompt);
    const assetsNeedImage = allAssets.filter(a => (a.image_count === 0 || a.image_count === undefined));

    // 如果没有需要处理的资产
    if (assetsNeedPrompt.length === 0 && assetsNeedImage.length === 0) {
      toast('所有资产已完成生成', 'info');
      return;
    }

    // 2. 确认对话框
    const confirmMessage = `即将执行一键生成（最多10个并发）：\n` +
      (assetsNeedPrompt.length > 0 ? `- 生成提示词：${assetsNeedPrompt.length}个资产\n` : '') +
      (assetsNeedImage.length > 0 ? `- 生成图片：${assetsNeedImage.length}个资产\n` : '') +
      `\n此操作可能需要一定时间，确认继续？`;

    if (!confirm(confirmMessage)) {
      return;
    }

    // 创建 AbortController 用于取消操作
    abortControllerRef.current = new AbortController();
    setIsOneClickGenerating(true);

    // 初始化 promptMap，用于存储本次生成的提示词
    const promptMap = new Map<string, string>();

    try {
      // 3. 第一阶段：并发生成提示词
      if (assetsNeedPrompt.length > 0 && isMountedRef.current) {
        setOneClickPhase('prompt');
        setOneClickProgress({ current: 0, total: assetsNeedPrompt.length });

        const promptResults = await runWithConcurrency(
          assetsNeedPrompt,
          async (asset: Asset) => {
            // 确定资产类型
            const assetType = characters.some(c => c.asset_id === asset.asset_id)
              ? 'character'
              : scenes.some(s => s.asset_id === asset.asset_id)
                ? 'scene'
                : 'prop';

            // 构建增强描述
            let enhancedDescription = asset.description || '';
            if (assetType === 'character') {
              const details = [];
              if (asset.gender) details.push(`性别: ${asset.gender}`);
              if (asset.age) details.push(`年龄: ${asset.age}`);
              if (details.length > 0) enhancedDescription += `\n${details.join(', ')}`;
            } else if (assetType === 'scene' && asset.location) {
              enhancedDescription += `\n地点: ${asset.location}`;
            }

            // 生成提示词
            const response = await generationApi.generateImagePrompt(projectId, {
              asset_type: assetType,
              description: enhancedDescription,
              asset_id: asset.asset_id,  // 传入 asset_id，后端会自动保存
            });

            // 提取生成的提示词
            const generatedPrompt = response.data.prompt || response.data.positive_prompt || '';

            // 后端已自动保存，返回提示词供后续使用
            return {
              assetType,
              assetId: asset.asset_id,
              prompt: generatedPrompt
            };
          },
          10, // 并发上限
          (completed, total) => {
            if (isMountedRef.current) {
              setOneClickProgress({ current: completed, total });
            }
          }
        );

        // 统计结果
        const successCount = promptResults.filter(r => r.success).length;
        const failCount = promptResults.filter(r => !r.success && r.error !== 'Aborted').length;

        // 填充 promptMap（构建 asset_id -> prompt 映射，用于第二阶段）
        promptResults.forEach(result => {
          if (result.success && result.result?.prompt) {
            promptMap.set(result.result.assetId, result.result.prompt);
          }
        });

        if (!isMountedRef.current) return;

        if (failCount > 0) {
          console.warn(`提示词生成完成: ${successCount}成功, ${failCount}失败`);
          const failedAssets = promptResults
            .filter(r => !r.success && r.error !== 'Aborted')
            .map(r => (r.task as Asset).name)
            .slice(0, 3)
            .join(', ');
          toast(`提示词生成完成: ${successCount}/${assetsNeedPrompt.length}\n失败: ${failedAssets}${failCount > 3 ? '...' : ''}`, 'info');
        } else if (successCount > 0) {
          toast(`提示词生成完成: ${successCount}个`, 'success');
        }

        // 刷新数据以获取最新的提示词
        await onRefresh();
      }

      // 4. 第二阶段：并发生成图片
      if (isMountedRef.current) {
        // 重新获取资产列表（包含刚生成的提示词）
        const updatedAllAssets = [
          ...characters.filter(c => !c.parent_id),
          ...scenes,
          ...props
        ];

        // 筛选：有提示词（从 props 或 promptMap）但没有图片的资产
        const finalAssetsNeedImage = updatedAllAssets.filter(
          a => {
            const hasPrompt = a.image_prompt || promptMap.has(a.asset_id);
            return hasPrompt && (a.image_count === 0 || a.image_count === undefined);
          }
        );

        if (finalAssetsNeedImage.length > 0 && isMountedRef.current) {
          setOneClickPhase('image');
          setOneClickProgress({ current: 0, total: finalAssetsNeedImage.length });

          const imageResults = await runWithConcurrency(
            finalAssetsNeedImage,
            async (asset: Asset) => {
              const assetType = characters.some(c => c.asset_id === asset.asset_id)
                ? 'character'
                : scenes.some(s => s.asset_id === asset.asset_id)
                  ? 'scene'
                  : 'prop';

              // 优先使用 promptMap 中的提示词，否则使用资产中的提示词
              const promptToUse = promptMap.get(asset.asset_id) || asset.image_prompt;

              if (!promptToUse) {
                throw new Error(`资产 ${asset.name} 没有提示词`);
              }

              // 生成图片
              await generationApi.generateImage(projectId, {
                asset_id: asset.asset_id,
                asset_type: assetType,
                prompt: promptToUse,
                negative_prompt: '',
                width: 1024,
                height: 1024,
              });

              return { assetType };
            },
            10, // 并发上限
            (completed, total) => {
              if (isMountedRef.current) {
                setOneClickProgress({ current: completed, total });
              }
            }
          );

          // 统计结果
          const successCount = imageResults.filter(r => r.success).length;
          const failCount = imageResults.filter(r => !r.success && r.error !== 'Aborted').length;

          if (!isMountedRef.current) return;

          if (failCount > 0) {
            const failedAssets = imageResults
              .filter(r => !r.success && r.error !== 'Aborted')
              .map(r => (r.task as Asset).name)
              .slice(0, 3)
              .join(', ');
            toast(`图片生成完成: ${successCount}/${finalAssetsNeedImage.length}\n失败: ${failedAssets}${failCount > 3 ? '...' : ''}`, 'info');
          } else if (successCount > 0) {
            toast(`图片生成完成: ${successCount}个`, 'success');
          }
        }
      }

      // 5. 完成
      if (isMountedRef.current) {
        toast('一键生成完成！', 'success');
        await onRefresh();
      }

    } catch (error: any) {
      if (isMountedRef.current) {
        console.error('一键生成失败:', error);
        // 忽略中止错误
        if (error.name !== 'AbortError') {
          toast('一键生成失败: ' + (error.message || '未知错误'), 'error');
        }
      }
    } finally {
      if (isMountedRef.current) {
        setIsOneClickGenerating(false);
        setOneClickPhase(null);
        setOneClickProgress({ current: 0, total: 0 });
        abortControllerRef.current = null;
      }
    }
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      {/* Tab 按钮 + 创建按钮 */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => setAssetFilter('all')}
            className={`px-4 py-2 rounded-lg transition ${
              assetFilter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            全部
          </button>
          <button
            onClick={() => setAssetFilter('character')}
            className={`px-4 py-2 rounded-lg transition ${
              assetFilter === 'character'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            角色 ({characters.length})
          </button>
          <button
            onClick={() => setAssetFilter('scene')}
            className={`px-4 py-2 rounded-lg transition ${
              assetFilter === 'scene'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            场景 ({scenes.length})
          </button>
          <button
            onClick={() => setAssetFilter('prop')}
            className={`px-4 py-2 rounded-lg transition ${
              assetFilter === 'prop'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            道具 ({props.length})
          </button>
        </div>
        <div className="flex gap-2">
          {/* 根据当前tab显示对应的创建按钮 */}
          {assetFilter === 'all' && (
            <>
              <button
                onClick={() => handleOpenCreate('character')}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm"
              >
                <Plus size={14} />
                创建角色
              </button>
              <button
                onClick={() => handleOpenCreate('scene')}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm"
              >
                <Plus size={14} />
                创建场景
              </button>
              <button
                onClick={() => handleOpenCreate('prop')}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm"
              >
                <Plus size={14} />
                创建道具
              </button>
              {/* 一键生成按钮 */}
              <button
                onClick={handleOneClickGenerate}
                disabled={isOneClickGenerating}
                className="flex items-center gap-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-sm font-medium"
                title="自动生成所有资产的提示词和图片"
              >
                {isOneClickGenerating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {oneClickPhase === 'prompt' && `提示词 ${oneClickProgress.current}/${oneClickProgress.total}`}
                    {oneClickPhase === 'image' && `图片 ${oneClickProgress.current}/${oneClickProgress.total}`}
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    一键生成
                  </>
                )}
              </button>
            </>
          )}
          {assetFilter === 'character' && (
            <>
              <button
                onClick={() => handleOpenCreate('character')}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm"
              >
                <Plus size={14} />
                创建角色
              </button>
              <button
                onClick={handleBatchGenerate}
                disabled={isRunning}
                className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-sm"
              >
                {isRunning ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    生成中 {tasks.filter(t => t.status === 'success').length}/{tasks.length}
                  </>
                ) : (
                  <>
                    <Wand2 size={14} />
                    批量生成提示词
                  </>
                )}
              </button>
            </>
          )}
          {assetFilter === 'scene' && (
            <>
              <button
                onClick={() => handleOpenCreate('scene')}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm"
              >
                <Plus size={14} />
                创建场景
              </button>
              <button
                onClick={handleBatchGenerate}
                disabled={isRunning}
                className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-sm"
              >
                {isRunning ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    生成中 {tasks.filter(t => t.status === 'success').length}/{tasks.length}
                  </>
                ) : (
                  <>
                    <Wand2 size={14} />
                    批量生成提示词
                  </>
                )}
              </button>
            </>
          )}
          {assetFilter === 'prop' && (
            <>
              <button
                onClick={() => handleOpenCreate('prop')}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-sm"
              >
                <Plus size={14} />
                创建道具
              </button>
              <button
                onClick={handleBatchGenerate}
                disabled={isRunning}
                className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-sm"
              >
                {isRunning ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    生成中 {tasks.filter(t => t.status === 'success').length}/{tasks.length}
                  </>
                ) : (
                  <>
                    <Wand2 size={14} />
                    批量生成提示词
                  </>
                )}
              </button>
            </>
          )}
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm"
          >
            <RefreshCw size={14} />
            刷新
          </button>
          {/* 一键下载按钮 */}
          <button
            onClick={handleDownloadAll}
            disabled={isDownloading}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-sm"
            title="下载所有外部图片到本地"
          >
            {isDownloading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                下载中 {Math.round(downloadProgress)}%
              </>
            ) : (
              <>
                <HardDrive size={14} />
                一键下载图片
              </>
            )}
          </button>
        </div>
      </div>

      {/* 下载进度显示 */}
      {isDownloading && (
        <div className="mb-4 bg-gray-800 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-300">
              正在下载: {downloadState.currentImage || '准备中...'}
            </span>
            <span className="text-sm text-gray-300">
              {downloadState.progress?.downloaded_images || 0} / {downloadState.progress?.total_images || 0}
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          {downloadState.errors.length > 0 && (
            <div className="mt-2 text-xs text-red-400">
              部分图片下载失败: {downloadState.errors.slice(0, 3).join(', ')}
              {downloadState.errors.length > 3 && '...'}
            </div>
          )}
        </div>
      )}

      {/* 一键生成进度显示 */}
      {isOneClickGenerating && (
        <div className="mb-4 bg-gradient-to-r from-purple-900/30 to-pink-900/30 border border-purple-700/50 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-purple-200 font-medium">
              {oneClickPhase === 'prompt' && '正在生成提示词...'}
              {oneClickPhase === 'image' && '正在生成图片...'}
            </span>
            <span className="text-sm text-purple-200">
              {oneClickProgress.current} / {oneClickProgress.total}
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
              style={{
                width: `${oneClickProgress.total > 0 ? (oneClickProgress.current / oneClickProgress.total) * 100 : 0}%`
              }}
            />
          </div>
          <div className="mt-2 text-xs text-purple-300">
            {oneClickPhase === 'prompt' && '提示词生成完成后将自动开始生成图片'}
            {oneClickPhase === 'image' && '图片生成中，请耐心等待...'}
          </div>
        </div>
      )}

      {/* 资产网格 */}
      <div className="grid grid-cols-5 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
        {/* 角色 */}
        {(assetFilter === 'all' || assetFilter === 'character') && (() => {
          const mainCharacters = characters.filter(c => !c.parent_id);
          if (mainCharacters.length === 0 && assetFilter === 'character') {
            return (
              <div className="col-span-full text-gray-500 text-center py-12">
                暂无角色
              </div>
            );
          }
          return mainCharacters.map(char => (
            <div key={char.asset_id} className="col-span-1">
              <AssetCard
                projectId={projectId}
                assetType="character"
                asset={char}
                onDeleted={onRefresh}
                childAssets={characters.filter(c => c.parent_id === char.asset_id)}
              />
            </div>
          ));
        })()}

        {/* 场景 */}
        {(assetFilter === 'all' || assetFilter === 'scene') && scenes.map((scene) => (
          <AssetCard
            key={scene.asset_id}
            projectId={projectId}
            assetType="scene"
            asset={scene}
            onDeleted={onRefresh}
          />
        ))}

        {/* 道具 */}
        {(assetFilter === 'all' || assetFilter === 'prop') && props.map((prop) => (
          <AssetCard
            key={prop.asset_id}
            projectId={projectId}
            assetType="prop"
            asset={prop}
            onDeleted={onRefresh}
          />
        ))}
      </div>

      {/* 空状态 */}
      {assetFilter === 'all' && characters.length === 0 && scenes.length === 0 && props.length === 0 && (
        <div className="text-gray-500 text-center py-12">
          暂无资产，请先创建资产
        </div>
      )}
      {assetFilter === 'character' && characters.length === 0 && (
        <div className="text-gray-500 text-center py-12">
          暂无角色
        </div>
      )}
      {assetFilter === 'scene' && scenes.length === 0 && (
        <div className="text-gray-500 text-center py-12">
          暂无场景
        </div>
      )}
      {assetFilter === 'prop' && props.length === 0 && (
        <div className="text-gray-500 text-center py-12">
          暂无道具
        </div>
      )}

      {/* 创建资产对话框 */}
      <CreateAssetDialog
        open={showCreateAsset}
        assetType={createAssetType}
        onClose={() => setShowCreateAsset(false)}
        onCreated={onRefresh}
        projectId={projectId}
      />
    </div>
  );
}
