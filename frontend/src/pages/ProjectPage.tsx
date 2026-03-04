import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MessageSquare, Users, Film, FileText, Settings, Palette, ChevronDown } from 'lucide-react';
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

  const [activeTab, setActiveTab] = useState<TabType>('storyboard');
  const [showSettings, setShowSettings] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
              onClick={() => setActiveTab('storyboard')}
              className={`px-4 py-2 rounded-lg transition ${
                activeTab === 'storyboard' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <Film size={18} className="inline mr-2" />
              分镜
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
            {/* 更多下拉 */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className={`px-4 py-2 rounded-lg transition flex items-center gap-1 ${
                  ['chat', 'script', 'canvas'].includes(activeTab)
                    ? 'bg-blue-600'
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                更多
                <ChevronDown size={16} />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 min-w-[120px]">
                  <button
                    onClick={() => { setActiveTab('chat'); setShowMoreMenu(false); }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm rounded-t-lg hover:bg-gray-600 ${activeTab === 'chat' ? 'text-blue-400' : 'text-gray-200'}`}
                  >
                    <MessageSquare size={16} />
                    对话
                  </button>
                  <button
                    onClick={() => { setActiveTab('script'); setShowMoreMenu(false); }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-600 ${activeTab === 'script' ? 'text-blue-400' : 'text-gray-200'}`}
                  >
                    <FileText size={16} />
                    剧本
                  </button>
                  <button
                    onClick={() => { setActiveTab('canvas'); setShowMoreMenu(false); }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm rounded-b-lg hover:bg-gray-600 ${activeTab === 'canvas' ? 'text-blue-400' : 'text-gray-200'}`}
                  >
                    <Palette size={16} />
                    画布
                  </button>
                </div>
              )}
            </div>
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

      {/* 主内容区 - 条件渲染，仅挂载当前激活的tab */}
      <div className="h-[calc(100vh-73px)]">
        {activeTab === 'chat' && (
          <div className="flex h-full">
            <ChatTab projectId={projectId!} onAssetsCreated={handleRefreshAssets} />
          </div>
        )}

        {activeTab === 'assets' && (
          <div className="flex h-full">
            <AssetsTab
              projectId={projectId!}
              characters={characters}
              scenes={scenes}
              props={props}
              onRefresh={handleRefreshAssets}
            />
          </div>
        )}

        {activeTab === 'script' && (
          <div className="flex h-full">
            <ScriptTab projectId={projectId!} />
          </div>
        )}

        {activeTab === 'storyboard' && (
          <div className="flex h-full">
            <StoryboardTab
              projectId={projectId!}
              episodes={episodes}
              characters={characters}
              scenes={scenes}
              props={props}
              onUpdated={handleRefreshAssets}
            />
          </div>
        )}

        {activeTab === 'canvas' && (
          <div className="flex h-full">
            <CanvasTab projectId={projectId!} />
          </div>
        )}
      </div>

      {/* 设置弹框 */}
      {showSettings && projectId && (
        <SettingsModal projectId={projectId} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
