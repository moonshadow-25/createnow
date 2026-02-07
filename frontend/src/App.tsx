import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from '@/pages/HomePage';
import ProjectPage from '@/pages/ProjectPage';
import { ToastProvider } from '@/components/common/Toast';

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/project/:projectId" element={<ProjectPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
