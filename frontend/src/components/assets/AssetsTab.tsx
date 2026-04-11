import { useState, useEffect, useRef } from 'react';
import { Plus, RefreshCw, Wand2, Loader2, HardDrive, Zap, ChevronDown } from 'lucide-react';
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

  // 更多菜单
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMoreMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMoreMenu]);

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
    const allAssets = [
      ...characters.filter(c => !c.parent_id),
      ...scenes,
      ...props
    ];

    const eligible = allAssets.filter(a => a.image_prompt && (a.image_count === 0 || a.image_count === undefined));

    if (eligible.length === 0) {
      toast('暂无可生成的资产（请先为资产添加图片提示词）', 'info');
      return;
    }

    if (!confirm(`共 ${eligible.length} 个资产有提示词，将生成 ${eligible.length} 张图，确认？`)) return;

    abortControllerRef.current = new AbortController();
    setIsOneClickGenerating(true);

    try {
      setOneClickPhase('image');
      setOneClickProgress({ current: 0, total: eligible.length });

      const imageResults = await runWithConcurrency(
        eligible,
        async (asset: Asset) => {
          const assetType = characters.some(c => c.asset_id === asset.asset_id)
            ? 'character'
            : scenes.some(s => s.asset_id === asset.asset_id)
              ? 'scene'
              : 'prop';

          await generationApi.generateImage(projectId, {
            asset_id: asset.asset_id,
            asset_type: assetType,
            prompt: asset.image_prompt,
            negative_prompt: '',
          });

          return { assetType };
        },
        10,
        (completed, total) => {
          if (isMountedRef.current) setOneClickProgress({ current: completed, total });
        }
      );

      const successCount = imageResults.filter(r => r.success).length;
      const failCount = imageResults.filter(r => !r.success && r.error !== 'Aborted').length;

      if (!isMountedRef.current) return;

      if (failCount > 0) {
        const failedAssets = imageResults
          .filter(r => !r.success && r.error !== 'Aborted')
          .map(r => (r.task as Asset).name)
          .slice(0, 3)
          .join(', ');
        toast(`图片生成完成: ${successCount}/${eligible.length}，失败: ${failedAssets}${failCount > 3 ? '...' : ''}`, 'info');
      } else {
        toast(`图片生成完成: ${successCount}个`, 'success');
      }

      await onRefresh();
    } catch (error: any) {
      if (isMountedRef.current && error.name !== 'AbortError') {
        toast('一键生成失败: ' + (error.message || '未知错误'), 'error');
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
        <div className="flex gap-2 items-center">
          {/* 全部 tab：一键生成保留外层，其余进"更多" */}
          {assetFilter === 'all' && (
            <>
              <button
                onClick={handleOneClickGenerate}
                disabled={isOneClickGenerating}
                className="flex items-center gap-1.5 bg-purple-700/60 hover:bg-purple-700/80 text-purple-100 disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-sm font-medium"
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
              <div className="relative" ref={moreMenuRef}>
                <button
                  onClick={() => setShowMoreMenu(v => !v)}
                  className="flex items-center gap-1 text-sm bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg"
                >
                  更多
                  <ChevronDown size={14} className={`transition-transform ${showMoreMenu ? 'rotate-180' : ''}`} />
                </button>
                {showMoreMenu && (
                  <div className="absolute right-0 top-full mt-1 w-44 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 py-1">
                    <button
                      onClick={() => { handleOpenCreate('character'); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700"
                    >
                      <Plus size={14} />
                      创建角色
                    </button>
                    <button
                      onClick={() => { handleOpenCreate('scene'); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700"
                    >
                      <Plus size={14} />
                      创建场景
                    </button>
                    <button
                      onClick={() => { handleOpenCreate('prop'); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700"
                    >
                      <Plus size={14} />
                      创建道具
                    </button>
                    <div className="border-t border-gray-600 my-1" />
                    <button
                      onClick={() => { onRefresh(); setShowMoreMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700"
                    >
                      <RefreshCw size={14} />
                      刷新
                    </button>
                    <button
                      onClick={() => { handleDownloadAll(); setShowMoreMenu(false); }}
                      disabled={isDownloading}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
                )}
              </div>
            </>
          )}

          {/* 角色 tab */}
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

          {/* 场景 tab */}
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

          {/* 道具 tab */}
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
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
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
