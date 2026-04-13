import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CREATENOW_ADMIN_URL } from '@/constants/urls';
import { useProjectStore } from '@/store/projectStore';
import { useAuthStore } from '@/store/authStore';
import { useAdminAuthStore } from '@/store/adminAuthStore';
import { useSaasAuthStore } from '@/store/saasAuthStore';
import { useToast } from '@/components/common/Toast';
import { LoginModal } from '@/components/auth/LoginModal';
import { AdminUserPanel } from '@/components/auth/AdminUserPanel';
import { ProjectCard } from '@/components/project/ProjectCard';
import { ProjectEditModal } from '@/components/project/ProjectEditModal';
import { QuickStartSection } from '@/components/project/QuickStartSection';
import { Plus, LogIn, CheckCircle2, Users, LogOut, KeyRound, Sun, Moon } from 'lucide-react';
import { projectApi, adminAuthApi } from '@/services/api';
import { Project } from '@/types';
import { useThemeStore } from '@/store/themeStore';

export default function HomePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { projects, loading, fetchProjects, createProject, deleteProject, setCurrentProject } =
    useProjectStore();
  const { loggedIn, apiKeyMasked, fetchAuthInfo, logout } = useAuthStore();
  const { username: adminUsername, role: adminRole, logout: adminLogout, isAuthenticated } = useAdminAuthStore();
  const saasAuth = useSaasAuthStore();
  const { theme, toggle: toggleTheme } = useThemeStore();

  const [showLogin, setShowLogin] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [projectStats, setProjectStats] = useState<Record<string, any>>({});
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [pwdForm, setPwdForm] = useState({ old: '', new1: '', new2: '' });
  const [pwdLoading, setPwdLoading] = useState(false);

  // SaaS 模式：已登录用户即有完整权限；selfhosted：需要 admin 角色
  const isSaasUser = saasAuth.isAuthenticated;
  const isAdmin = adminRole === 'admin' || isSaasUser;
  // 从 token payload 解析用户名作为兜底（user 异步加载前先显示）
  const saasDisplayName = saasAuth.user?.display_name || saasAuth.user?.email || (() => {
    try {
      const token = saasAuth.token;
      if (!token) return '';
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.display_name || payload.email || payload.sub || '';
    } catch { return ''; }
  })();

  const loadStats = useCallback(async (list: Project[]) => {
    if (!list?.length) return;
    const results = await Promise.allSettled(list.map(p => projectApi.getStats(p.project_id)));
    const statsMap: Record<string, any> = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') statsMap[list[i].project_id] = r.value.data;
      else statsMap[list[i].project_id] = null;
    });
    setProjectStats(statsMap);
  }, []);

  useEffect(() => {
    fetchProjects();
    fetchAuthInfo();
  }, [fetchProjects, fetchAuthInfo]);

  // SaaS 登录后获取用户信息 + 项目列表
  useEffect(() => {
    if (saasAuth.isAuthenticated) {
      saasAuth.fetchUser();
      fetchProjects();
    }
  }, [saasAuth.isAuthenticated]);

  // SaaS 用户：登录后立即获取积分，之后每 60 秒轮询一次
  useEffect(() => {
    if (!saasAuth.isAuthenticated) return;
    saasAuth.fetchCredits();
    const timer = setInterval(() => saasAuth.fetchCredits(), 60_000);
    return () => clearInterval(timer);
  }, [saasAuth.isAuthenticated]);

  // 登录成功后重新加载项目列表
  useEffect(() => {
    if (isAuthenticated) fetchProjects();
  }, [isAuthenticated, fetchProjects]);

  // Load stats whenever projects list changes
  useEffect(() => {
    if (projects.length > 0) loadStats(projects);
  }, [projects, loadStats]);

  const handleCreateProject = async () => {
    const name = prompt('请输入项目名称:');
    if (name) {
      try {
        const project = await createProject(name);
        setCurrentProject(project);
        navigate(`/project/${project.project_id}`);
      } catch (error) {
        toast('创建项目失败', 'error');
      }
    }
  };

  const handleDeleteProject = async (id: string) => {
    const project = projects.find(p => p.project_id === id);
    if (!project) return;

    if (!confirm(`确定要删除项目「${project.name}」吗？\n\n删除后项目将被移至回收站，可以手动恢复。`)) {
      return;
    }

    const inputName = prompt(`请输入项目名称以确认删除：\n\n「${project.name}」`);
    if (inputName !== project.name) {
      if (inputName !== null) {
        toast('项目名称不匹配，取消删除', 'error');
      }
      return;
    }

    try {
      await deleteProject(id);
      toast('项目已移至回收站', 'success');
    } catch (error) {
      toast('删除项目失败', 'error');
    }
  };

  const handleOpenProject = (project: any) => {
    setCurrentProject(project);
    navigate(`/project/${project.project_id}`);
  };

  const handleLogout = async () => {
    if (!confirm('确定要退出登录吗？退出后新建项目将不再自动使用官方接口。')) return;
    await logout();
    toast('已退出登录', 'success');
  };

  const handleAdminLogout = () => {
    adminLogout();
  };

  const handleChangePassword = async () => {
    if (pwdForm.new1 !== pwdForm.new2) {
      toast('两次输入的新密码不一致', 'error');
      return;
    }
    if (!pwdForm.new1) {
      toast('新密码不能为空', 'error');
      return;
    }
    setPwdLoading(true);
    try {
      await adminAuthApi.changePassword(pwdForm.old, pwdForm.new1);
      toast('密码修改成功', 'success');
      setShowChangePwd(false);
      setPwdForm({ old: '', new1: '', new2: '' });
    } catch (err: any) {
      const msg = err?.response?.data?.detail || '修改失败';
      toast(msg, 'error');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleEditSaved = async () => {
    setEditingProject(null);
    fetchProjects();
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">ViPro</span>
            <span className="text-sm font-medium text-gray-400 border border-gray-400 px-2 py-0.5 rounded-md">满血API</span>
          </h1>
          <div className="flex items-center gap-3 pr-10">
            {isAdmin && !isSaasUser && loggedIn && (
              <a
                href="http://47.117.182.216:8003/admin/login.html"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition text-sm"
              >
                账户
              </a>
            )}
            {isAdmin && !isSaasUser && (loggedIn ? (
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 bg-green-700 hover:bg-green-800 px-4 py-2 rounded-lg transition text-sm"
                title={`已登录 | Key: ${apiKeyMasked}`}
              >
                <CheckCircle2 size={16} />
                已登录
              </button>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition text-sm"
              >
                <LogIn size={16} />
                登录
              </button>
            ))}

            {isAdmin && !isSaasUser && (
              <button
                onClick={() => setShowUserPanel(true)}
                className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition text-sm"
                title="用户管理"
              >
                <Users size={16} />
                用户管理
              </button>
            )}

            <a
              href="https://docs.qq.com/aio/DSU5pZWRzdGFGQ1JH?p=Tti5hvBIeVGT1KIpGtCcOC&client_hint=0&client_hint=0&client_hint=0"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 border border-gray-500 hover:border-gray-300 text-white hover:text-white px-4 py-2 rounded-lg transition"
            >
              使用教程
            </a>

            {isAdmin && (
              <button
                onClick={handleCreateProject}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
              >
                <Plus size={20} />
                新建项目
              </button>
            )}

            {isSaasUser && (
              <>
                <a
                  href={CREATENOW_ADMIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition text-sm"
                >
                  账户
                  {saasAuth.user?.credits != null && (
                    <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">
                      {saasAuth.user.credits}
                    </span>
                  )}
                </a>
                <div className="flex items-center gap-2 ml-2 pl-2 border-l border-gray-700">
                  {saasDisplayName && (
                    <span className="text-xs text-gray-400">{saasDisplayName}</span>
                  )}
                  <button
                    onClick={() => saasAuth.logout()}
                    className="flex items-center gap-1 text-gray-400 hover:text-white transition text-sm"
                    title="退出登录"
                  >
                    <LogOut size={16} />
                  </button>
                </div>
              </>
            )}
            {!isSaasUser && adminUsername && (
              <div className="flex items-center gap-2 ml-2 pl-2 border-l border-gray-700">
                <span className="text-xs text-gray-400">{adminUsername}</span>
                {isAdmin && (
                  <button
                    onClick={() => setShowChangePwd(true)}
                    className="flex items-center gap-1 text-gray-400 hover:text-white transition text-sm"
                    title="修改密码"
                  >
                    <KeyRound size={15} />
                  </button>
                )}
                <button
                  onClick={handleAdminLogout}
                  className="flex items-center gap-1 text-gray-400 hover:text-white transition text-sm"
                  title="退出登录"
                >
                  <LogOut size={16} />
                </button>
              </div>
            )}
            {/* 主题切换 */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title={theme === 'light' ? '切换暗色主题' : '切换亮色主题'}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">加载中...</div>
        ) : projects.length === 0 ? (
          <div>
            <QuickStartSection />
            {isAdmin && (
              <div className="text-center py-4 text-gray-400">
                <button
                  onClick={handleCreateProject}
                  className="text-blue-400 hover:text-blue-300 underline text-sm"
                >
                  或者创建空白项目
                </button>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
              {[...projects].sort((a, b) => a.name.localeCompare(b.name, 'zh')).map((project) => (
                <ProjectCard
                  key={project.project_id}
                  project={project}
                  stats={projectStats[project.project_id]}
                  isAdmin={isAdmin}
                  hideCost={isSaasUser}
                  onOpen={() => handleOpenProject(project)}
                  onDelete={() => handleDeleteProject(project.project_id)}
                  onEdit={() => setEditingProject(project)}
                />
              ))}
            </div>
            <div className="border-t border-gray-700 pt-6">
              <QuickStartSection />
            </div>
          </div>
        )}
      </div>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
      {showUserPanel && <AdminUserPanel onClose={() => setShowUserPanel(false)} />}
      {editingProject && (
        <ProjectEditModal
          project={editingProject}
          stats={projectStats[editingProject.project_id]}
          onClose={() => setEditingProject(null)}
          onSaved={handleEditSaved}
        />
      )}
      {showChangePwd && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-80 space-y-4">
            <h3 className="text-lg font-semibold">修改密码</h3>
            <input
              type="password"
              placeholder="原密码"
              value={pwdForm.old}
              onChange={e => setPwdForm(f => ({ ...f, old: e.target.value }))}
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="password"
              placeholder="新密码"
              value={pwdForm.new1}
              onChange={e => setPwdForm(f => ({ ...f, new1: e.target.value }))}
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="password"
              placeholder="确认新密码"
              value={pwdForm.new2}
              onChange={e => setPwdForm(f => ({ ...f, new2: e.target.value }))}
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setShowChangePwd(false); setPwdForm({ old: '', new1: '', new2: '' }); }}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                取消
              </button>
              <button
                onClick={handleChangePassword}
                disabled={pwdLoading}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm disabled:opacity-50"
              >
                {pwdLoading ? '保存中...' : '确认修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
