import { useState, useEffect } from 'react';
import { FileText, Plus, Trash2, Download, User } from 'lucide-react';
import { scriptApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import { ScriptCharacterPanel } from './ScriptCharacterPanel';
import { SceneCard } from './SceneCard';
import { ScriptImportModal } from './ScriptImportModal';

interface ScriptTabProps {
  projectId: string;
}

interface Script {
  script_id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface ScriptEpisode {
  episode_id: string;
  script_id: string;
  episode_number: number;
  title: string;
  created_at: string;
}

interface ScriptScene {
  scene_id: string;
  episode_id: string;
  sequence: number;
  location: string;
  time_of_day: string;
  interior_exterior: string;
  content: string;
  created_at: string;
}

interface ScriptCharacter {
  character_id: string;
  script_id: string;
  name: string;
  age?: string;
  gender?: string;
  description: string;
  notes: string;
  created_at: string;
}

export function ScriptTab({ projectId }: ScriptTabProps) {
  const { toast } = useToast();
  const [currentScript, setCurrentScript] = useState<Script | null>(null);
  const [episodes, setEpisodes] = useState<ScriptEpisode[]>([]);
  const [currentEpisode, setCurrentEpisode] = useState<ScriptEpisode | null>(null);
  const [scenes, setScenes] = useState<ScriptScene[]>([]);
  const [characters, setCharacters] = useState<ScriptCharacter[]>([]);

  const [showCharacterPanel, setShowCharacterPanel] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // 加载剧本（自动加载第一个剧本）
  const loadScript = async () => {
    try {
      const response = await scriptApi.list(projectId);
      const scripts = response.data.scripts || [];
      // 自动选择第一个剧本
      if (scripts.length > 0) {
        setCurrentScript(scripts[0]);
      } else {
        setCurrentScript(null);
      }
    } catch (error: any) {
      console.error('Failed to load scripts:', error);
    }
  };

  // 加载剧集列表
  const loadEpisodes = async () => {
    if (!currentScript) return;
    try {
      const response = await scriptApi.listEpisodes(projectId, currentScript.script_id);
      setEpisodes(response.data.episodes || []);
      if (response.data.episodes && response.data.episodes.length > 0) {
        setCurrentEpisode(response.data.episodes[0]);
      }
    } catch (error: any) {
      console.error('Failed to load episodes:', error);
    }
  };

  // 加载场景列表
  const loadScenes = async () => {
    if (!currentEpisode || !currentScript) return;
    try {
      const response = await scriptApi.listScenes(projectId, currentScript.script_id, currentEpisode.episode_id);
      setScenes(response.data.scenes || []);
    } catch (error: any) {
      console.error('Failed to load scenes:', error);
    }
  };

  // 加载人物表
  const loadCharacters = async () => {
    if (!currentScript) return;
    try {
      const response = await scriptApi.listCharacters(projectId, currentScript.script_id);
      setCharacters(response.data.characters || []);
    } catch (error: any) {
      console.error('Failed to load characters:', error);
    }
  };

  // 创建新剧本
  const handleCreateScript = async () => {
    const title = prompt('请输入剧本名称：', '新剧本');
    if (!title) return;

    try {
      await scriptApi.create(projectId, { title });
      toast('剧本创建成功', 'success');
      await loadScript();
    } catch (error: any) {
      toast(`创建失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  // 添加新剧集
  const handleAddEpisode = async () => {
    if (!currentScript) {
      toast('请先选择剧本', 'error');
      return;
    }

    // 获取当前最大集数
    const maxEpisode = episodes.length > 0
      ? Math.max(...episodes.map(e => e.episode_number))
      : 0;
    const newEpisodeNumber = maxEpisode + 1;

    try {
      await scriptApi.addEpisode(projectId, currentScript.script_id, newEpisodeNumber);
      await loadEpisodes();
      toast(`第${newEpisodeNumber}集已添加`, 'success');
    } catch (error: any) {
      toast(`添加失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  // 删除剧集
  const handleDeleteEpisode = async (episodeId: string) => {
    if (!confirm('确定删除该集吗？这将同时删除该集的所有场景和镜头。')) return;

    if (!currentScript) return;
    try {
      await scriptApi.deleteEpisode(projectId, currentScript.script_id, episodeId);
      await loadEpisodes();
      toast('剧集已删除', 'success');
    } catch (error: any) {
      toast(`删除失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  // 导出剧本
  const handleExportScript = async (format: 'txt' | 'pdf') => {
    if (!currentScript) return;

    try {
      const response = await scriptApi.export(projectId, currentScript.script_id, format);

      if (format === 'txt') {
        // response.data 直接是文本内容
        const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${currentScript.title}.txt`;
        link.click();
        URL.revokeObjectURL(url);
      } else if (format === 'pdf') {
        // response.data 是 ArrayBuffer
        const blob = new Blob([response.data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${currentScript.title}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      }

      toast(`导出${format.toUpperCase()}成功`, 'success');
    } catch (error: any) {
      toast(`导出失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  // 刷新当前剧集的场景
  const handleRefreshScenes = () => {
    loadScenes();
  };

  // 刷新人物
  const handleRefreshCharacters = () => {
    loadCharacters();
  };

  // 初始化加载
  useEffect(() => {
    loadScript();
  }, [projectId]);

  // 当选择剧本时，加载其剧集和人物
  useEffect(() => {
    if (currentScript) {
      loadEpisodes();
      loadCharacters();
    } else {
      setEpisodes([]);
      setCurrentEpisode(null);
      setCharacters([]);
    }
  }, [currentScript]);

  // 当选择剧集时，加载其场景
  useEffect(() => {
    if (currentEpisode) {
      loadScenes();
    } else {
      setScenes([]);
    }
  }, [currentEpisode]);

  return (
    <div className="flex h-full bg-gray-900 text-white">
      {/* 左侧：剧集列表 */}
      <div className="w-48 bg-gray-800 border-r border-gray-700 flex flex-col">
        {/* 剧集列表 */}
        <div className="flex-1 p-3 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-400">剧集</span>
            <button
              onClick={handleAddEpisode}
              disabled={!currentScript}
              className="text-blue-400 hover:text-blue-300 disabled:text-gray-600"
              title="添加剧集"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="space-y-1">
            {episodes.map(episode => (
              <div
                key={episode.episode_id}
                onClick={() => setCurrentEpisode(episode)}
                className={`flex items-center justify-between px-2 py-2 rounded cursor-pointer transition ${
                  currentEpisode?.episode_id === episode.episode_id
                    ? 'bg-blue-600'
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                <span className="text-sm">第{episode.episode_number}集</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteEpisode(episode.episode_id);
                  }}
                  className="text-red-400 hover:text-red-300 p-1"
                  title="删除剧集"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {episodes.length === 0 && currentScript && (
              <div className="text-xs text-gray-500 text-center py-4">
                暂无剧集
              </div>
            )}
          </div>
        </div>

        {/* 人物表按钮 */}
        <div className="p-3 border-t border-gray-700">
          <button
            onClick={() => setShowCharacterPanel(true)}
            disabled={!currentScript}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <User size={16} />
            <span className="text-sm">人物表</span>
            {characters.length > 0 && (
              <span className="ml-auto text-xs text-gray-400">({characters.length})</span>
            )}
          </button>
        </div>
      </div>

      {/* 右侧：场景编辑区 */}
      <div className="flex-1 flex flex-col overflow-hidden w-full min-w-0">
        {/* 工具栏 */}
        {currentScript && (
          <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="font-semibold">{currentScript.title}</h2>
              {currentEpisode && (
                <span className="text-sm text-gray-400">第{currentEpisode.episode_number}集</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowImportModal(true)}
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                <FileText size={14} />
                导入剧本
              </button>
              <button
                onClick={() => handleExportScript('txt')}
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                <Download size={14} />
                导出TXT
              </button>
              <button
                onClick={() => handleExportScript('pdf')}
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                <Download size={14} />
                导出PDF
              </button>
            </div>
          </div>
        )}

        {/* 场景列表 */}
        <div className="flex-1 overflow-y-auto w-full min-w-0">
          {!currentScript ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-4">
              <FileText size={48} className="mb-4 opacity-50" />
              <p className="mb-2">该项目暂无剧本</p>
              <button
                onClick={handleCreateScript}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
              >
                创建新剧本
              </button>
            </div>
          ) : !currentEpisode ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-4">
              <p>请添加或选择一集</p>
            </div>
          ) : scenes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-4">
              <p>该集暂无场景</p>
              <p className="text-sm mt-2">可以通过导入剧本或手动添加场景</p>
            </div>
          ) : (
            <div className="p-4 space-y-4 w-full min-w-0 max-w-none">
              {scenes.map((scene, index) => (
                <SceneCard
                  key={scene.scene_id}
                  projectId={projectId}
                  scriptId={currentScript.script_id}
                  scene={scene}
                  sceneNumber={index + 1}
                  characters={characters}
                  onRefresh={handleRefreshScenes}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 人物表面板 */}
      {showCharacterPanel && currentScript && (
        <ScriptCharacterPanel
          projectId={projectId}
          scriptId={currentScript.script_id}
          characters={characters}
          onClose={() => setShowCharacterPanel(false)}
          onRefresh={handleRefreshCharacters}
        />
      )}

      {/* 导入剧本弹框 */}
      {showImportModal && currentScript && (
        <ScriptImportModal
          projectId={projectId}
          scriptId={currentScript.script_id}
          scriptTitle={currentScript.title}
          onClose={() => setShowImportModal(false)}
          onImport={async () => {
            setShowImportModal(false);
            await loadEpisodes();
            await loadCharacters();
            if (currentEpisode) {
              await loadScenes();
            }
          }}
        />
      )}
    </div>
  );
}
