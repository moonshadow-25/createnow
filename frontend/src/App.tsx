import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from '@/pages/HomePage';
import ProjectPage from '@/pages/ProjectPage';
import { ToastProvider } from '@/components/common/Toast';
import { AdminLoginModal } from '@/components/auth/AdminLoginModal';
import { useAdminAuthStore } from '@/store/adminAuthStore';
import { VibeDramaPanel } from '@/components/chat/VibeDramaPanel';

function App() {
  const { isAuthenticated, restoreFromStorage } = useAdminAuthStore();
  const [showLogin, setShowLogin] = useState(false);

  // 启动时从 localStorage 恢复认证状态
  useEffect(() => {
    restoreFromStorage();
  }, []);

  // 监听 401 全局事件 → 显示登录弹窗
  useEffect(() => {
    const handler = () => setShowLogin(true);
    window.addEventListener('admin:unauthorized', handler);
    return () => window.removeEventListener('admin:unauthorized', handler);
  }, []);

  // 未认证时显示登录弹窗（覆盖所有路由）
  const needsLogin = !isAuthenticated || showLogin;

  // 登录成功后关闭弹窗
  useEffect(() => {
    if (isAuthenticated) setShowLogin(false);
  }, [isAuthenticated]);

  return (
    <ToastProvider>
      {needsLogin && <AdminLoginModal />}
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/project/:projectId" element={<ProjectPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <VibeDramaPanel />
    </ToastProvider>
  );
}

export default App;
