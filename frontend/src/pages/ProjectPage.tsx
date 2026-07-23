import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, Film, Settings, ChevronDown, RefreshCw, Video, Sun, Moon, FileText, BarChart2, Workflow, Download } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { useAssetStore } from '@/store/assetStore';
import { useGlobalStyleStore } from '@/store/globalStyleStore';
import { adminApi, projectApi } from '@/services/api';
import { useAdminAuthStore } from '@/store/adminAuthStore';
import { useToast } from '@/components/common/Toast';
import { ChatTab } from '@/components/chat/ChatTab';
import { AssetsTab } from '@/components/assets/AssetsTab';
import { StoryboardTab } from '@/components/storyboard/StoryboardTab';
import { GenerateTab } from '@/components/generate/GenerateTab';
import { NewCanvasTab } from '@/components/new-canvas/NewCanvasTab';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useVibeDramaStore } from '@/store/vibeDramaStore';
import { useThemeStore } from '@/store/themeStore';
import { FullScriptImportModal } from '@/components/script/FullScriptImportModal';
import { ProjectCostDashboard } from '@/components/dashboard/ProjectCostDashboard';

type TabType = 'chat' | 'assets' | 'storyboard' | 'generate' | 'canvas';

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { currentProject, projects, fetchProject, fetchProjects } = useProjectStore();
  const { characters, scenes, props, episodes, storyboards, fetchAssets, loadedProjectId } = useAssetStore();
  const setGlobalStyleConfig = useGlobalStyleStore(s => s.setConfig);
  const setVibeDramaContext = useVibeDramaStore(s => s.setContext);
  const { theme, toggle: toggleTheme, appearanceMode } = useThemeStore();
  const adminRole = useAdminAuthStore(s => s.role);
  const { toast } = useToast();
  const isAdmin = adminRole === 'admin';
  const isVipMode = appearanceMode === 'vip';

  const [activeTab, setActiveTab] = useState<TabType>('storyboard');
  const [showSettings, setShowSettings] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showProjectCostDashboard, setShowProjectCostDashboard] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [showFullScriptImport, setShowFullScriptImport] = useState(false);
  const [isExportingAssets, setIsExportingAssets] = useState(false);
  // 项目数据加载状态（用于显示加载遮罩和进度）
  const [projectDataLoading, setProjectDataLoading] = useState(true);
  const [storyboardsReady, setStoryboardsReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{
    loaded: string[]; pending: string[]; images_loaded: boolean; progress_pct: number;
  }>({ loaded: [], pending: [], images_loaded: false, progress_pct: 0 });
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
  // 画布 tab 首次访问后保持挂载，避免切换时节点状态丢失
  const [canvasMounted, setCanvasMounted] = useState(false);
  useEffect(() => { if (activeTab === 'canvas') setCanvasMounted(true); }, [activeTab]);

  const projectWithStats = projectId ? projects.find(p => p.project_id === projectId) : undefined;
  const dashboardStats = projectWithStats?.stats;
  const dashboardUserCosts = projectWithStats?.user_costs || {};
  const dashboardUnknownCosts = projectWithStats?.unknown_costs;

  useEffect(() => {
    if (!projectId) return;
    if (!projectWithStats?.stats || !projectWithStats?.unknown_costs) {
      fetchProjects();
    }
  }, [projectId, projectWithStats?.stats, projectWithStats?.unknown_costs, fetchProjects]);

  // Vibe Drama：非分镜 tab 切换时设置上下文（分镜 tab 由 StoryboardDetail 负责）
  const TAB_LABELS: Record<string, string> = {
    assets: '资产面板', chat: '项目对话', generate: '视频生成', canvas: '画布工作流',
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

  const handleExportAssets = async () => {
    if (!projectId || isExportingAssets) return;
    const confirmed = window.confirm(
      '将把当前项目资产复制到客户机器当前 data 目录下的 output/assets/{项目名-短ID}/{时间}/，不生成 zip。是否继续？'
    );
    if (!confirmed) return;

    setIsExportingAssets(true);
    try {
      const res = await projectApi.exportAssets(projectId);
      const data = res.data || {};
      const summary = data.summary || {};
      const copied = [
        summary.episode_videos,
        summary.asset_images,
        summary.canvas_videos,
        summary.canvas_images,
        summary.square_videos,
        summary.square_images,
      ].reduce((sum: number, value: any) => sum + Number(value || 0), 0);
      toast(`资产导出完成：${data.output_dir || ''}（共 ${copied} 个文件）`, 'success');
    } catch (e: any) {
      const message = e?.response?.data?.detail || e?.message || '导出资产失败';
      toast(message, 'error');
    } finally {
      setIsExportingAssets(false);
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
        global_resolution: cfg.global_resolution || '16:9-720p',
        nine_grid_mode: cfg.nine_grid_mode || false,
      });
    }
  }, [(currentProject as any)?.ai_config?.global_style_config]);

  // 数据加载状態轮询：检查项目数据是否已完全加载到后端缓存
  // 加载完成条件：后端缓存就绪 + 前端 store 已拉取过该项目数据
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const check = async () => {
      try {
        const res = await projectApi.getLoadingStatus(projectId!);
        if (cancelled) return;
        const data = res.data;
        setLoadProgress({
          loaded: data.loaded || [],
          pending: data.pending || [],
          images_loaded: data.images_loaded || false,
          progress_pct: data.progress_pct || 0,
        });
        // 后端缓存就绪 + 前端 assetStore 已拉取过该项目 → 数据真正可用
        if (data.ready) {
          setProjectDataLoading(false);
        } else {
          timer = setTimeout(check, 500);
        }
      } catch {
        if (!cancelled) timer = setTimeout(check, 1000);
      }
    };

    setProjectDataLoading(true);
    setStoryboardsReady(false);
    setLoadProgress({ loaded: [], pending: [], images_loaded: false, progress_pct: 0 });
    check();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId]);

  const handleOpenSettings = () => {
    setShowSettings(true);
  };

  if (!currentProject) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 bg-gray-900 text-white flex flex-col overflow-hidden">
      {/* 数据加载遮罩：后端缓存就绪 + 前端分镜数据到达才算完成 */}
      {(projectDataLoading || !storyboardsReady) && (
        <div className="fixed inset-0 z-50 bg-gray-900 bg-opacity-85 flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mb-4" />
          <p className="text-gray-300 text-lg font-medium">正在加载项目数据...</p>
          <div className="mt-4 w-64 bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${loadProgress.progress_pct}%` }}
            />
          </div>
          <p className="text-gray-500 text-sm mt-2">
            {loadProgress.loaded.length > 0 && (
              <span>已加载: {loadProgress.loaded.join(', ')}</span>
            )}
            {loadProgress.pending.length > 0 && (
              <span className="ml-2 text-gray-600">| 等待: {loadProgress.pending.join(', ')}</span>
            )}
            {!loadProgress.images_loaded && loadProgress.loaded.length > 0 && (
              <span className="ml-2 text-gray-600">| 图片加载中...</span>
            )}
          </p>
          <p className="text-gray-600 text-xs mt-1">{loadProgress.progress_pct}%</p>
        </div>
      )}
      {/* 顶部导航 */}
      <div className={`border-b px-6 py-4 flex-shrink-0 ${isVipMode ? 'vip-nav-shell bg-gray-800 border-gray-700' : 'bg-gray-800 border-gray-700'}`}>
        <div className="flex justify-between items-center">
          <div>
            <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white mr-4">
              ← 返回
            </button>
            <h1 className="text-2xl font-bold inline">{currentProject.name}</h1>
          </div>
          <div className="flex items-center gap-2 pr-10">
            <button
              onClick={() => setShowProjectCostDashboard(true)}
              className={`px-4 py-2 rounded-lg transition flex items-center gap-2 text-sm ${isVipMode ? 'bg-[#151922] hover:bg-[#1b2130] text-gray-200 border border-transparent' : 'bg-gray-700 hover:bg-gray-600'}`}
              title="项目消耗看板"
            >
              <BarChart2 size={18} className="inline mr-2" />
              消耗看板
            </button>
            <button
              onClick={() => setActiveTab('storyboard')}
              className={`px-4 py-2 rounded-lg transition flex items-center gap-2 text-sm ${
                activeTab === 'storyboard'
                  ? 'bg-gradient-to-r from-[#efd488] to-[#cfab5f] text-[#241b0d] border border-[#d0ad63] shadow-[0_6px_16px_rgba(216,179,96,0.32)]'
                  : isVipMode ? 'bg-[#151922] hover:bg-[#1b2130] text-gray-200 border border-transparent' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <Film size={18} className="inline mr-2" />
              分镜
            </button>
            <button
              onClick={() => setActiveTab('assets')}
              className={`px-4 py-2 rounded-lg transition flex items-center gap-2 text-sm ${
                activeTab === 'assets'
                  ? 'bg-gradient-to-r from-[#efd488] to-[#cfab5f] text-[#241b0d] border border-[#d0ad63] shadow-[0_6px_16px_rgba(216,179,96,0.32)]'
                  : isVipMode ? 'bg-[#151922] hover:bg-[#1b2130] text-gray-200 border border-transparent' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <Users size={18} className="inline mr-2" />
              资产
            </button>
            {/* 更多下拉 */}
            <div className="relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className={`px-4 py-2 rounded-lg transition flex items-center gap-1 text-sm ${
                  ['generate', 'canvas', 'chat'].includes(activeTab)
                    ? 'bg-gradient-to-r from-[#efd488] to-[#cfab5f] text-[#241b0d] border border-[#d0ad63] shadow-[0_6px_16px_rgba(216,179,96,0.32)]'
                    : isVipMode ? 'bg-[#151922] hover:bg-[#1b2130] text-gray-200 border border-transparent' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                更多
                <ChevronDown size={16} />
              </button>
              {showMoreMenu && (
                <div className={`absolute right-0 top-full mt-1 border rounded-lg shadow-lg z-50 min-w-[140px] ${isVipMode ? 'bg-gray-800 border-yellow-700/40' : 'bg-gray-700 border-gray-600'}`}>
                  <button
                    onClick={() => { setActiveTab('generate'); setShowMoreMenu(false); }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm rounded-t-lg hover:bg-gray-600 ${activeTab === 'generate' ? 'text-blue-400' : 'text-gray-200'}`}
                  >
                    <Video size={16} />
                    广场
                  </button>
                  <button
                    onClick={() => { setActiveTab('canvas'); setShowMoreMenu(false); }}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-600 ${activeTab === 'canvas' ? 'text-blue-400' : 'text-gray-200'}`}
                  >
                    <Workflow size={16} />
                    画布
                  </button>
                  <div className="border-t border-gray-600 my-1" />
                  <button
                    onClick={() => { setShowFullScriptImport(true); setShowMoreMenu(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-600 text-gray-200 whitespace-nowrap"
                  >
                    <FileText size={16} />
                    导入全剧本
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => { setShowMoreMenu(false); handleExportAssets(); }}
                      disabled={isExportingAssets}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-gray-600 text-gray-200 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download size={16} className={isExportingAssets ? 'animate-pulse' : ''} />
                      {isExportingAssets ? '导出中...' : '导出资产'}
                    </button>
                  )}
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
              className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm transition ${isVipMode ? 'bg-[#151922] hover:bg-[#1b2130] text-gray-200 border border-transparent' : 'bg-gray-700 hover:bg-gray-600'}`}
              title="设置"
            >
              <Settings size={18} />
              设置
            </button>
            {appearanceMode !== 'vip' && (
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-gray-200 transition-colors"
                title={theme === 'light' ? '切换暗色主题' : '切换亮色主题'}
              >
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 主体：内容区 */}
      <div className="flex-1 min-h-0 overflow-hidden">
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
                episodes={episodes}
                storyboards={storyboards}
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
                onStoryboardsReady={() => setStoryboardsReady(true)}
              />
            </div>
          )}

          {generateMounted && (
            <div className={`flex h-full ${activeTab !== 'generate' ? 'hidden' : ''}`}>
              <div className="flex-1 overflow-hidden">
                <GenerateTab
                  projectId={projectId!}
                  showAssetSubmit={['createnow', 'byteseed'].includes(currentProject?.ai_config?.video?.api_type || '')}
                  imageApiType={currentProject?.ai_config?.image?.api_type || ''}
                  videoApiType={currentProject?.ai_config?.video?.api_type || ''}
                />
              </div>
            </div>
          )}

          {canvasMounted && (
            <div className={`flex h-full ${activeTab !== 'canvas' ? 'hidden' : ''}`}>
              <div className="flex-1 overflow-hidden">
                <NewCanvasTab
                  projectId={projectId!}
                  showAssetSubmit={['createnow', 'byteseed'].includes(currentProject?.ai_config?.video?.api_type || '')}
                  imageApiType={currentProject?.ai_config?.image?.api_type || ''}
                  videoApiType={currentProject?.ai_config?.video?.api_type || ''}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 设置弹框 */}
      {showProjectCostDashboard && projectId && (
        <ProjectCostDashboard
          projectId={projectId}
          stats={dashboardStats}
          userCosts={dashboardUserCosts}
          unknownCosts={dashboardUnknownCosts}
          onClose={() => setShowProjectCostDashboard(false)}
        />
      )}

      {showSettings && projectId && (
        <SettingsModal projectId={projectId} onClose={() => setShowSettings(false)} />
      )}

      {/* 全剧本导入弹框（始终挂载，关闭只是隐藏，保留状态） */}
      {projectId && (
        <FullScriptImportModal
          projectId={projectId}
          visible={showFullScriptImport}
          isEmptyProject={episodes.length === 0 && characters.length === 0 && scenes.length === 0 && props.length === 0}
          onClose={() => setShowFullScriptImport(false)}
          onSuccess={() => {
            handleRefreshAssets();
          }}
        />
      )}
    </div>
  );
}
