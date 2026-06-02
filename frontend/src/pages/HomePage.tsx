import { useEffect, useState } from 'react';
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
import { ProjectRatingModal } from '@/components/project/ProjectRatingModal';
import { ProjectParticipantsModal } from '@/components/project/ProjectParticipantsModal';
import { QuickStartSection } from '@/components/project/QuickStartSection';
import { Plus, LogIn, CheckCircle2, Users, LogOut, KeyRound, Sun, Moon, BarChart2, WalletCards } from 'lucide-react';
import { adminAuthApi, adminUserApi } from '@/services/api';
import { Project } from '@/types';
import { useThemeStore } from '@/store/themeStore';
import { CostDashboard } from '@/components/dashboard/CostDashboard';
import { AppVersionBadge } from '@/components/common/AppVersionBadge';
import { UpdateModal } from '@/components/settings/UpdateModal';

interface ParticipantUser {
  id: string;
  username: string;
  role: string;
  display_name: string;
  last_login_at: string | null;
  assigned_project_ids: string[];
  readonly?: boolean;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    projects,
    dashboardUserCosts,
    dashboardUnknownCost,
    loading,
    fetchProjects,
    createProject,
    deleteProject,
    setCurrentProject,
  } = useProjectStore();
  const { loggedIn, apiKeyMasked, fetchAuthInfo, logout } = useAuthStore();
  const { username: adminUsername, role: adminRole, logout: adminLogout, isAuthenticated } = useAdminAuthStore();
  const saasAuth = useSaasAuthStore();
  const { theme, toggle: toggleTheme, appearanceMode } = useThemeStore();
  const [showLogin, setShowLogin] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [viewingRatingProject, setViewingRatingProject] = useState<Project | null>(null);
  const [participantsProject, setParticipantsProject] = useState<Project | null>(null);
  const [participants, setParticipants] = useState<ParticipantUser[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState('');
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [pwdForm, setPwdForm] = useState({ old: '', new1: '', new2: '' });
  const [pwdLoading, setPwdLoading] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  // SaaS 模式：已登录用户即有完整权限；selfhosted：需要 admin 角色
  const isSaasUser = saasAuth.isAuthenticated;
  const isAdmin = adminRole === 'admin' || isSaasUser;
  const canCheckUpdate = !isSaasUser && adminRole === 'admin';
  const selfhostedUserCost = !isSaasUser && adminRole === 'user'
    ? dashboardUserCosts.find((item) => item.username === adminUsername)
    : null;
  const selfhostedUserCostValue = selfhostedUserCost?.total_cost ?? 0;
  // 从 token payload 解析用户名作为兜底（user 异步加载前先显示）
  const saasDisplayName = saasAuth.user?.display_name || saasAuth.user?.email || (() => {
    try {
      const token = saasAuth.token;
      if (!token) return '';
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.display_name || payload.email || payload.sub || '';
    } catch { return ''; }
  })();

  useEffect(() => {
    fetchAuthInfo();
  }, [fetchAuthInfo]);

  // SaaS 登录后获取用户信息
  useEffect(() => {
    if (saasAuth.isAuthenticated) {
      saasAuth.fetchUser();
    }
  }, [saasAuth.isAuthenticated]);

  // SaaS 用户：登录后立即获取积分，之后每 60 秒轮询一次
  useEffect(() => {
    if (!saasAuth.isAuthenticated) return;
    saasAuth.fetchCredits();
    const timer = setInterval(() => saasAuth.fetchCredits(), 60_000);
    return () => clearInterval(timer);
  }, [saasAuth.isAuthenticated]);

  // 认证状态就绪后统一加载项目列表（避免多处重复触发）
  useEffect(() => {
    if (saasAuth.isAuthenticated || isAuthenticated) {
      fetchProjects();
    }
  }, [saasAuth.isAuthenticated, isAuthenticated, fetchProjects]);

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

  const handleViewParticipants = async (project: Project) => {
    setParticipantsProject(project);
    setParticipants([]);
    setParticipantsError('');
    setParticipantsLoading(true);
    try {
      const response = await adminUserApi.list();
      const users = (response.data as ParticipantUser[]).filter((user) =>
        (user.assigned_project_ids || []).includes(project.project_id)
      );
      setParticipants(users);
    } catch {
      setParticipantsError('加载参与者失败');
    } finally {
      setParticipantsLoading(false);
    }
  };

  const handleCloseParticipants = () => {
    setParticipantsProject(null);
    setParticipants([]);
    setParticipantsError('');
    setParticipantsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">ViPro</span>
            <span className="text-sm font-medium text-gray-400 border border-gray-400 px-2 py-0.5 rounded-md">满血API</span>
            <AppVersionBadge canCheckUpdate={canCheckUpdate} onClick={() => setShowUpdateModal(true)} />
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

            {isAdmin && !isSaasUser && (
              <button
                onClick={() => setShowDashboard(true)}
                className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition text-sm"
                title="消耗看板"
              >
                <BarChart2 size={16} />
                消耗看板
              </button>
            )}

            {!isSaasUser && adminRole === 'user' && adminUsername && (
              <div
                className="flex items-center gap-2 bg-gray-800 border border-gray-700 px-3 py-2 rounded-lg text-sm text-gray-300"
                title="当前账号累计生成消耗"
              >
                <WalletCards size={16} className="text-blue-400" />
                <span>已消耗 {selfhostedUserCostValue.toFixed(2)} 积分</span>
              </div>
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
            {appearanceMode !== 'vip' && (
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title={theme === 'light' ? '切换暗色主题' : '切换亮色主题'}
              >
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              </button>
            )}
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
            <div className={`grid gap-3 mb-10 ${appearanceMode === 'vip' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'}`}>
              {[...projects].sort((a, b) => a.name.localeCompare(b.name, 'zh')).map((project) => (
                <ProjectCard
                  key={project.project_id}
                  project={project}
                  stats={project.stats}
                  isAdmin={isAdmin}
                  onOpen={() => handleOpenProject(project)}
                  onDelete={() => handleDeleteProject(project.project_id)}
                  onEdit={() => setEditingProject(project)}
                  onViewParticipants={isAdmin && !isSaasUser ? () => handleViewParticipants(project) : undefined}
                  onViewRating={!isAdmin && !isSaasUser ? () => setViewingRatingProject(project) : undefined}
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
      {showDashboard && (
        <CostDashboard
          projects={projects}
          projectStats={Object.fromEntries(projects.map(p => [p.project_id, p.stats ?? null]))}
          userCosts={dashboardUserCosts}
          unknownCost={dashboardUnknownCost}
          isAdmin={isAdmin}
          onClose={() => setShowDashboard(false)}
        />
      )}
      {showUserPanel && <AdminUserPanel onClose={() => setShowUserPanel(false)} userCosts={dashboardUserCosts} />}
      {showUpdateModal && <UpdateModal onClose={() => setShowUpdateModal(false)} />}
      {editingProject && (
        <ProjectEditModal
          project={editingProject}
          stats={editingProject.stats}
          onClose={() => setEditingProject(null)}
          onSaved={handleEditSaved}
        />
      )}
      {viewingRatingProject && (
        <ProjectRatingModal
          project={viewingRatingProject}
          onClose={() => setViewingRatingProject(null)}
        />
      )}
      {participantsProject && (
        <ProjectParticipantsModal
          project={participantsProject}
          participants={participants}
          loading={participantsLoading}
          error={participantsError}
          onClose={handleCloseParticipants}
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
