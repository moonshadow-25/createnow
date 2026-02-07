import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, Users, Film, FileText, Settings, Palette } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { useAssetStore } from '@/store/assetStore';
import { ChatTab } from '@/components/chat/ChatTab';
import { AssetsTab } from '@/components/assets/AssetsTab';
import { StoryboardTab } from '@/components/storyboard/StoryboardTab';
import { ScriptTab } from '@/components/script/ScriptTab';
import { CanvasTab } from '@/components/canvas/CanvasTab';
import { SettingsModal } from '@/components/settings/SettingsModal';

type TabType = 'chat' | 'assets' | 'script' | 'storyboard' | 'canvas';

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { currentProject } = useProjectStore();
  const { characters, scenes, props, episodes, fetchAssets } = useAssetStore();

  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [showSettings, setShowSettings] = useState(false);

  // 加载资产
  const handleRefreshAssets = async () => {
    if (!projectId) return;
    fetchAssets(projectId, 'character');
    fetchAssets(projectId, 'scene');
    fetchAssets(projectId, 'prop');
    fetchAssets(projectId, 'episode');
    fetchAssets(projectId, 'storyboard');
  };

  // 初始化加载
  useEffect(() => {
    if (projectId) {
      if (!currentProject || currentProject.project_id !== projectId) {
        // 重新加载项目
        window.location.reload();
      }
      // 加载资产
      fetchAssets(projectId, 'character');
      fetchAssets(projectId, 'scene');
      fetchAssets(projectId, 'prop');
      fetchAssets(projectId, 'episode');
      fetchAssets(projectId, 'storyboard');
    }
  }, [projectId]);

  const handleOpenSettings = () => {
    setShowSettings(true);
  };

  if (!currentProject) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div>加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* 顶部导航 */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="flex justify-between items-center">
          <div>
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white mr-4">
              ← 返回
            </button>
            <h1 className="text-2xl font-bold inline">{currentProject.name}</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-4 py-2 rounded-lg transition ${
                activeTab === 'chat' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <MessageSquare size={18} className="inline mr-2" />
              对话
            </button>
            <button
              onClick={() => setActiveTab('script')}
              className={`px-4 py-2 rounded-lg transition ${
                activeTab === 'script' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <FileText size={18} className="inline mr-2" />
              剧本
            </button>
            <button
              onClick={() => setActiveTab('assets')}
              className={`px-4 py-2 rounded-lg transition ${
                activeTab === 'assets' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <Users size={18} className="inline mr-2" />
              资产
            </button>
            <button
              onClick={() => setActiveTab('storyboard')}
              className={`px-4 py-2 rounded-lg transition ${
                activeTab === 'storyboard' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <Film size={18} className="inline mr-2" />
              分镜
            </button>
            <button
              onClick={() => setActiveTab('canvas')}
              className={`px-4 py-2 rounded-lg transition ${
                activeTab === 'canvas' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <Palette size={18} className="inline mr-2" />
              画布
            </button>
            <button
              onClick={handleOpenSettings}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg flex items-center gap-2"
              title="设置"
            >
              <Settings size={18} />
              设置
            </button>
          </div>
        </div>
      </div>

      {/* 主内容区 - 使用 CSS 控制显示/隐藏，保持组件挂载状态 */}
      <div className="h-[calc(100vh-73px)]">
        <div className={activeTab === 'chat' ? 'flex h-full' : 'hidden'}>
          <ChatTab projectId={projectId!} onAssetsCreated={handleRefreshAssets} />
        </div>

        <div className={activeTab === 'assets' ? 'flex h-full' : 'hidden'}>
          <AssetsTab
            projectId={projectId!}
            characters={characters}
            scenes={scenes}
            props={props}
            onRefresh={handleRefreshAssets}
          />
        </div>

        <div className={activeTab === 'script' ? 'flex h-full' : 'hidden'}>
          <ScriptTab projectId={projectId!} />
        </div>

        <div className={activeTab === 'storyboard' ? 'flex h-full' : 'hidden'}>
          <StoryboardTab
            projectId={projectId!}
            episodes={episodes}
            characters={characters}
            scenes={scenes}
            props={props}
            onUpdated={handleRefreshAssets}
          />
        </div>

        <div className={activeTab === 'canvas' ? 'flex h-full' : 'hidden'}>
          <CanvasTab projectId={projectId!} />
        </div>
      </div>

      {/* 设置弹框 */}
      {showSettings && projectId && (
        <SettingsModal projectId={projectId} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
