import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from '@/pages/HomePage';
import ProjectPage from '@/pages/ProjectPage';
import StoryboardEditorPage from '@/pages/StoryboardEditorPage';
import { ToastProvider } from '@/components/common/Toast';
import { AdminLoginModal } from '@/components/auth/AdminLoginModal';
import { SaasLoginModal } from '@/components/auth/SaasLoginModal';
import { useAdminAuthStore } from '@/store/adminAuthStore';
import { useSaasAuthStore } from '@/store/saasAuthStore';
import { VibeDramaPanel } from '@/components/chat/VibeDramaPanel';

const CONFIG_URL = (import.meta.env.DEV ? 'http://localhost:8501' : '') + '/api/config';

function App() {
  const adminAuth = useAdminAuthStore();
  const saasAuth = useSaasAuthStore();

  const [deployMode, setDeployMode] = useState<'selfhosted' | 'saas' | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // 启动时获取部署模式 + 恢复认证状态
  useEffect(() => {
    fetch(CONFIG_URL)
      .then((r) => r.json())
      .then((cfg) => {
        const mode = cfg.deploy_mode === 'saas' ? 'saas' : 'selfhosted';
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

  return (
    <ToastProvider>
      {needsLogin && (
        deployMode === 'saas'
          ? <SaasLoginModal />
          : <AdminLoginModal />
      )}
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/project/:projectId/storyboard/:storyboardId/edit" element={<StoryboardEditorPage />} />
          <Route path="/project/:projectId" element={<ProjectPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <VibeDramaPanel />
    </ToastProvider>
  );
}

export default App;

