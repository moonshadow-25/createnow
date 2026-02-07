import { useState, useEffect } from 'react';
import { Plus, RefreshCw, Wand2, Loader2, HardDrive } from 'lucide-react';
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

      const response = await generationApi.generateImagePrompt(projectId, {
        asset_type: type,
        description: enhancedDescription,
      });

      const newPrompt = response.data.positive_prompt;

      // 自动保存到资产
      await fetch(`/api/projects/${projectId}/assets/${type}/${asset.asset_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_prompt: newPrompt }),
      });
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
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
              >
                <Plus size={16} />
                创建角色
              </button>
              <button
                onClick={() => handleOpenCreate('scene')}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
              >
                <Plus size={16} />
                创建场景
              </button>
              <button
                onClick={() => handleOpenCreate('prop')}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
              >
                <Plus size={16} />
                创建道具
              </button>
            </>
          )}
          {assetFilter === 'character' && (
            <>
              <button
                onClick={() => handleOpenCreate('character')}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
              >
                <Plus size={16} />
                创建角色
              </button>
              <button
                onClick={handleBatchGenerate}
                disabled={isRunning}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-lg"
              >
                {isRunning ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    生成中 {tasks.filter(t => t.status === 'success').length}/{tasks.length}
                  </>
                ) : (
                  <>
                    <Wand2 size={16} />
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
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
              >
                <Plus size={16} />
                创建场景
              </button>
              <button
                onClick={handleBatchGenerate}
                disabled={isRunning}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-lg"
              >
                {isRunning ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    生成中 {tasks.filter(t => t.status === 'success').length}/{tasks.length}
                  </>
                ) : (
                  <>
                    <Wand2 size={16} />
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
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
              >
                <Plus size={16} />
                创建道具
              </button>
              <button
                onClick={handleBatchGenerate}
                disabled={isRunning}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-lg"
              >
                {isRunning ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    生成中 {tasks.filter(t => t.status === 'success').length}/{tasks.length}
                  </>
                ) : (
                  <>
                    <Wand2 size={16} />
                    批量生成提示词
                  </>
                )}
              </button>
            </>
          )}
          <button
            onClick={onRefresh}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg"
          >
            <RefreshCw size={16} />
            刷新
          </button>
          {/* 一键下载按钮 */}
          <button
            onClick={handleDownloadAll}
            disabled={isDownloading}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed px-4 py-2 rounded-lg"
            title="下载所有外部图片到本地"
          >
            {isDownloading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                下载中 {Math.round(downloadProgress)}%
              </>
            ) : (
              <>
                <HardDrive size={16} />
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
