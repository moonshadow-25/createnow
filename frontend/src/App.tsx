import { useEffect, useState, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import HomePage from '@/pages/HomePage';
import ProjectPage from '@/pages/ProjectPage';
import StoryboardEditorPage from '@/pages/StoryboardEditorPage';
import { ToastProvider } from '@/components/common/Toast';
import { AdminLoginModal } from '@/components/auth/AdminLoginModal';
import { SaasLoginModal } from '@/components/auth/SaasLoginModal';
import { useAdminAuthStore } from '@/store/adminAuthStore';
import { useSaasAuthStore } from '@/store/saasAuthStore';
import { VibeDramaPanel } from '@/components/chat/VibeDramaPanel';
import { useVibeDramaStore } from '@/store/vibeDramaStore';
import { useThemeStore, applyStoredTheme } from '@/store/themeStore';
import { useCreatenowModelConfigStore } from '@/store/createnowModelConfigStore';

// 立即同步主题，避免闪白/闪黑
applyStoredTheme();

const CONFIG_URL = (import.meta.env.DEV ? 'http://localhost:8501' : '') + '/api/config';

function StoryboardEditorRoute() {
  const { projectId, storyboardId } = useParams();
  return <StoryboardEditorPage key={`${projectId}:${storyboardId}`} />;
}

function App() {
  const adminAuth = useAdminAuthStore();
  const saasAuth = useSaasAuthStore();
  const { isOpen: vibeDramaOpen, panelWidth: vibeDramaPanelWidth, toggle: toggleVibeDrama } = useVibeDramaStore();
  const { theme, appearanceMode } = useThemeStore();
  const setCreatenowModelConfig = useCreatenowModelConfigStore(state => state.setConfig);

  // 组件挂载时确保 DOM 属性和 store 同步
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-app-mode', appearanceMode);
  }, [theme, appearanceMode]);

  // 悬浮按钮拖拽状态：存 right/top 距离，天然跟随窗口边缘
  const [btnPos, setBtnPos] = useState({ right: 12, top: 12 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleBtnMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    // 记录鼠标相对于按钮右边缘的偏移
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffset.current = {
      x: window.innerWidth - e.clientX - (window.innerWidth - rect.right),
      y: e.clientY - rect.top,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const newRight = Math.max(0, Math.min(window.innerWidth - 36, window.innerWidth - ev.clientX - dragOffset.current.x));
      const newTop = Math.max(0, Math.min(window.innerHeight - 36, ev.clientY - dragOffset.current.y));
      setBtnPos({ right: newRight, top: newTop });
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const [deployMode, setDeployMode] = useState<'selfhosted' | 'saas' | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // 启动时获取部署模式 + 恢复认证状态
  useEffect(() => {
    fetch(CONFIG_URL)
      .then((r) => r.json())
      .then((cfg) => {
        const mode = cfg.deploy_mode === 'saas' ? 'saas' : 'selfhosted';
        setCreatenowModelConfig(cfg.createnow_model_config);
        setDeployMode(mode);
        if (mode === 'saas') {
          saasAuth.restoreFromStorage();
        } else {
          adminAuth.restoreFromStorage();
        }
      })
      .catch(() => {
        // 无法获取配置时默认 selfhosted
        setDeployMode('selfhosted');
        adminAuth.restoreFromStorage();
      });
  }, []);

  // 监听 401 全局事件 → 显示登录弹窗
  useEffect(() => {
    const handler = () => setShowLogin(true);
    window.addEventListener('admin:unauthorized', handler);
    return () => window.removeEventListener('admin:unauthorized', handler);
  }, []);

  // 登录成功后关闭弹窗
  useEffect(() => {
    if (adminAuth.isAuthenticated || saasAuth.isAuthenticated) setShowLogin(false);
  }, [adminAuth.isAuthenticated, saasAuth.isAuthenticated]);

  // 配置加载中时不渲染
  if (deployMode === null) return null;

  const needsLogin = deployMode === 'saas'
    ? !saasAuth.isAuthenticated
    : (!adminAuth.isAuthenticated || showLogin);
  const isVipMode = appearanceMode === 'vip';
  const contentRightPadding = isVipMode
    ? (vibeDramaOpen ? vibeDramaPanelWidth + 18 : 18)
    : (vibeDramaOpen ? vibeDramaPanelWidth : 0);

  return (
    <ToastProvider>
      {needsLogin && (
        deployMode === 'saas'
          ? <SaasLoginModal />
          : <AdminLoginModal />
      )}
      {/* 全局布局：内容区随侧边栏自动让位 */}
      <div
        className={isVipMode ? 'vip-app-shell transition-all duration-300' : 'h-screen transition-all duration-300'}
        style={{ paddingRight: contentRightPadding }}
      >
        {isVipMode ? (
          <div className="vip-app-shell__frame">
            <div className="vip-app-shell__topbar">VIP Privilege Workspace</div>
            <div className="vip-app-shell__content">
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/project/:projectId/storyboard/:storyboardId/edit" element={<StoryboardEditorRoute />} />
                  <Route path="/project/:projectId" element={<ProjectPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </BrowserRouter>
            </div>
          </div>
        ) : (
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/project/:projectId/storyboard/:storyboardId/edit" element={<StoryboardEditorRoute />} />
              <Route path="/project/:projectId" element={<ProjectPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        )}
      </div>
      <VibeDramaPanel />
      {/* 全局悬浮呼出按钮，面板关闭时显示，可拖拽 */}
      {!vibeDramaOpen && (
        <button
          onMouseDown={handleBtnMouseDown}
          onClick={toggleVibeDrama}
          className={`fixed z-50 w-9 h-9 rounded-full border shadow-lg flex items-center justify-center transition-colors select-none cursor-grab active:cursor-grabbing ${appearanceMode === 'vip' ? 'bg-gray-900/95 hover:bg-gray-800 border-yellow-700/40 hover:border-yellow-500/70' : 'bg-gray-800 hover:bg-gray-700 border-gray-600 hover:border-red-500'}`}
          style={{ right: btnPos.right, top: btnPos.top }}
          title="小龙虾 AI 助手"
        >
          <span className="text-lg leading-none">🦞</span>
        </button>
      )}
    </ToastProvider>
  );
}

export default App;

