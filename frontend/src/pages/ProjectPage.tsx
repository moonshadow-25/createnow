import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, Film, Settings, ChevronDown, RefreshCw, Video, Sun, Moon, FileText } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { useAssetStore } from '@/store/assetStore';
import { useGlobalStyleStore } from '@/store/globalStyleStore';
import { adminApi } from '@/services/api';
import { ChatTab } from '@/components/chat/ChatTab';
import { AssetsTab } from '@/components/assets/AssetsTab';
import { StoryboardTab } from '@/components/storyboard/StoryboardTab';
import { GenerateTab } from '@/components/generate/GenerateTab';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useVibeDramaStore } from '@/store/vibeDramaStore';
import { useThemeStore } from '@/store/themeStore';
import { FullScriptImportModal } from '@/components/script/FullScriptImportModal';

type TabType = 'chat' | 'assets' | 'storyboard' | 'generate';

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { currentProject, fetchProject } = useProjectStore();
  const { characters, scenes, props, episodes, fetchAssets, loadedProjectId } = useAssetStore();
  const setGlobalStyleConfig = useGlobalStyleStore(s => s.setConfig);
  const setVibeDramaContext = useVibeDramaStore(s => s.setContext);
  const { theme, toggle: toggleTheme } = useThemeStore();

  const [activeTab, setActiveTab] = useState<TabType>('storyboard');
  const [showSettings, setShowSettings] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [showFullScriptImport, setShowFullScriptImport] = useState(false);
  // 项目没有分集时自动弹出导入弹框
  const autoImportTriggered = useRef(false);
  const [episodesInitLoaded, setEpisodesInitLoaded] = useState(false);
  useEffect(() => {
    if (episodesInitLoaded && episodes.length === 0 && !autoImportTriggered.current) {
      autoImportTriggered.current = true;
      setShowFullScriptImport(true);
    }
  }, [episodesInitLoaded, episodes.length]);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  // 生成 tab 首次访问后保持挂载，避免切换时状态丢失
  const [generateMounted, setGenerateMounted] = useState(false);
  useEffect(() => { if (activeTab === 'generate') setGenerateMounted(true); }, [activeTab]);

  // Vibe Drama：非分镜 tab 切换时设置上下文（分镜 tab 由 StoryboardDetail 负责）
  const TAB_LABELS: Record<string, string> = {
    assets: '资产面板', chat: '项目对话', generate: '视频生成',
  };
  useEffect(() => {
    if (!projectId || activeTab === 'storyboard') return;
    setVibeDramaContext({
      projectId,
      projectName: currentProject?.name || '',
      tabName: activeTab,
      label: TAB_LABELS[activeTab] || activeTab,
    });
  }, [activeTab, projectId]);

  // 订阅 Vibe Drama 资产刷新事件
  useEffect(() => {
    if (!projectId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === projectId) {
        fetchAssets(projectId, 'character');
        fetchAssets(projectId, 'scene');
        fetchAssets(projectId, 'prop');
        fetchAssets(projectId, 'episode');
        fetchAssets(projectId, 'storyboard');
      }
    };
    window.addEventListener('vibe-drama:assets-created', handler);
    return () => window.removeEventListener('vibe-drama:assets-created', handler);
  }, [projectId]);

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

  // 清后端内存缓存，再重新拉取所有资产
  const handleClearCache = async () => {
    if (!projectId || isClearingCache) return;
    setIsClearingCache(true);
    try {
      await adminApi.clearCache(projectId);
      await handleRefreshAssets();
    } catch (e) {
      console.error('清缓存失败', e);
    } finally {
      setIsClearingCache(false);
    }
  };

  // 初始化加载
  useEffect(() => {
    if (!projectId) return;
    if (!currentProject || currentProject.project_id !== projectId) {
      fetchProject(projectId);
    }
    // 已有该项目缓存时跳过，避免从子页面返回时重复请求
    // storyboard 由 StoryboardDetail.loadStoryboards() 独立管理，无需此处拉取
    if (loadedProjectId === projectId) {
      setEpisodesInitLoaded(true);
      return;
    }
    setEpisodesInitLoaded(false);
    autoImportTriggered.current = false;
    fetchAssets(projectId, 'character');
    fetchAssets(projectId, 'scene');
    fetchAssets(projectId, 'prop');
    fetchAssets(projectId, 'episode').then(() => setEpisodesInitLoaded(true));
    fetchAssets(projectId, 'storyboard');
  }, [projectId]);

  // 同步全局风格配置到 store
  useEffect(() => {
    const cfg = (currentProject as any)?.ai_config?.global_style_config;
    if (cfg) {
      setGlobalStyleConfig({
        global_resolution: cfg.global_resolution || '1280x720',
        nine_grid_mode: cfg.nine_grid_mode || false,
      });
    }
  }, [(currentProject as any)?.ai_config?.global_style_config]);

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
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* 顶部导航 */}
      <div className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex-shrink-0">
        <div className="flex justify-between items-center">
          <div>
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white mr-4">
              ← 返回
            </button>
            <h1 className="text-2xl font-bold inline">{currentProject.name}</h1>
          </div>
          <div className="flex gap-2 pr-10">
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
                  ['generate', 'chat'].includes(activeTab)
                    ? 'bg-blue-600'
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                更多
                <ChevronDown size={16} />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 min-w-[140px]">
                  <button
                    onClick={() => { setActiveTab('generate'); setShowMoreMenu(false); }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm rounded-t-lg hover:bg-gray-600 ${activeTab === 'generate' ? 'text-blue-400' : 'text-gray-200'}`}
                  >
                    <Video size={16} />
                    广场
                  </button>
                  <div className="border-t border-gray-600 my-1" />
                  <button
                    onClick={() => { setShowFullScriptImport(true); setShowMoreMenu(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-600 text-gray-200 whitespace-nowrap"
                  >
                    <FileText size={16} />
                    导入全剧本
                  </button>
                  <div className="border-t border-gray-600 my-1" />
                  <button
                    onClick={() => { handleClearCache(); setShowMoreMenu(false); }}
                    disabled={isClearingCache}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm rounded-b-lg hover:bg-gray-600 text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw size={16} className={isClearingCache ? 'animate-spin' : ''} />
                    {isClearingCache ? '刷新中...' : '刷新缓存'}
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
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-gray-200 transition-colors"
              title={theme === 'light' ? '切换暗色主题' : '切换亮色主题'}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* 主体：内容区 */}
      <div
        className="overflow-hidden h-[calc(100vh-73px)]"
      >
        {/* 主内容区 */}
        <div className="h-full overflow-hidden">
          {activeTab === 'chat' && (
            <div className="flex h-full">
              <ChatTab projectId={projectId!} tabName="chat" />
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

          {activeTab === 'storyboard' && (
            <div className="flex h-full">
              <StoryboardTab
                projectId={projectId!}
                episodes={episodes}
                characters={characters}
                scenes={scenes}
                props={props}
                onUpdated={handleRefreshAssets}
                multimodalReference={currentProject?.ai_config?.video?.multimodal_reference || false}
                showAssetSubmit={['createnow', 'byteseed'].includes(currentProject?.ai_config?.video?.api_type || '')}
              />
            </div>
          )}

          {generateMounted && (
            <div className={`flex h-full ${activeTab !== 'generate' ? 'hidden' : ''}`}>
              <div className="flex-1 overflow-hidden">
                <GenerateTab
                  projectId={projectId!}
                  showAssetSubmit={['createnow', 'byteseed'].includes(currentProject?.ai_config?.video?.api_type || '')}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 设置弹框 */}
      {showSettings && projectId && (
        <SettingsModal projectId={projectId} onClose={() => setShowSettings(false)} />
      )}

      {/* 全剧本导入弹框（始终挂载，关闭只是隐藏，保留状态） */}
      {projectId && (
        <FullScriptImportModal
          projectId={projectId}
          visible={showFullScriptImport}
          onClose={() => setShowFullScriptImport(false)}
          onSuccess={() => {
            handleRefreshAssets();
          }}
        />
      )}
    </div>
  );
}
