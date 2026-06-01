import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { adminUserApi, projectApi } from '@/services/api';

interface User {
  id: string;
  username: string;
  role: string;
  display_name: string;
  last_login_at: string | null;
  assigned_project_ids: string[];
  readonly?: boolean;
  credit_limit?: number | null;
}

interface Project {
  project_id: string;
  name?: string;
  title?: string;
}

interface FormState {
  username: string;
  display_name: string;
  password: string;
  assigned_project_ids: string[];
  readonly: boolean;
  credit_limit: string;
}

const EMPTY_FORM: FormState = {
  username: '',
  display_name: '',
  password: '',
  assigned_project_ids: [],
  readonly: false,
  credit_limit: '',
};

interface Props {
  onClose: () => void;
}

function getProjectName(project: Project) {
  return project.name || project.title || project.project_id;
}

function parseCreditLimit(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('积分使用上限必须是大于等于 0 的数字，留空表示不限制');
  }
  return parsed;
}

export function AdminUserPanel({ onClose }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [projectSearch, setProjectSearch] = useState('');

  useEffect(() => {
    loadUsers();
    projectApi.list().then((r) => setProjects(r.data)).catch(() => {});
  }, []);

  const filteredProjects = useMemo(() => {
    const keyword = projectSearch.trim().toLowerCase();
    if (!keyword) return projects;
    return projects.filter((project) => {
      const name = getProjectName(project).toLowerCase();
      return name.includes(keyword) || project.project_id.toLowerCase().includes(keyword);
    });
  }, [projectSearch, projects]);

  async function loadUsers() {
    try {
      const r = await adminUserApi.list();
      setUsers(r.data);
    } catch {
      setError('加载用户列表失败');
    }
  }

  function openCreate() {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setProjectSearch('');
    setError('');
    setShowEditor(true);
  }

  function openEdit(user: User) {
    setEditingUser(user);
    setForm({
      username: user.username,
      display_name: user.display_name || '',
      password: '',
      assigned_project_ids: user.assigned_project_ids || [],
      readonly: user.readonly ?? false,
      credit_limit: user.credit_limit == null ? '' : String(user.credit_limit),
    });
    setProjectSearch('');
    setError('');
    setShowEditor(true);
  }

  function cancelForm() {
    setShowEditor(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setProjectSearch('');
    setError('');
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const creditLimit = parseCreditLimit(form.credit_limit);
      if (editingUser) {
        await adminUserApi.update(editingUser.id, {
          display_name: form.display_name || undefined,
          password: form.password || undefined,
          assigned_project_ids: form.assigned_project_ids,
          readonly: form.readonly,
          credit_limit: creditLimit,
        });
      } else {
        if (!form.username.trim() || !form.password.trim()) {
          setError('用户名和密码不能为空');
          return;
        }
        await adminUserApi.create({
          username: form.username.trim(),
          password: form.password,
          display_name: form.display_name,
          assigned_project_ids: form.assigned_project_ids,
          readonly: form.readonly,
          credit_limit: creditLimit,
        });
      }
      setShowEditor(false);
      setEditingUser(null);
      setForm(EMPTY_FORM);
      setProjectSearch('');
      await loadUsers();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '操作失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(user: User) {
    if (!confirm(`确定要删除子账号「${user.username}」吗？`)) return;
    try {
      await adminUserApi.delete(user.id);
      await loadUsers();
    } catch (e: any) {
      alert(e?.response?.data?.detail || '删除失败');
    }
  }

  function toggleProject(pid: string) {
    setForm((f) => ({
      ...f,
      assigned_project_ids: f.assigned_project_ids.includes(pid)
        ? f.assigned_project_ids.filter((id) => id !== pid)
        : [...f.assigned_project_ids, pid],
    }));
  }

  function selectFilteredProjects() {
    const ids = filteredProjects.map((project) => project.project_id);
    setForm((f) => ({
      ...f,
      assigned_project_ids: Array.from(new Set([...f.assigned_project_ids, ...ids])),
    }));
  }

  function clearFilteredProjects() {
    const ids = new Set(filteredProjects.map((project) => project.project_id));
    setForm((f) => ({
      ...f,
      assigned_project_ids: f.assigned_project_ids.filter((id) => !ids.has(id)),
    }));
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('zh-CN');
  }

  function formatCreditLimit(limit: number | null | undefined) {
    return limit == null ? '不限制' : `${limit} 积分`;
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-[1344px] max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">用户管理</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 用户列表 */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm text-gray-400">共 {users.length} 个账号</span>
              <button
                onClick={openCreate}
                className="flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded transition"
              >
                <Plus size={14} />
                新建子账号
              </button>
            </div>

            {error && !showEditor && <p className="text-red-400 text-xs mb-3">{error}</p>}

            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800 text-gray-400">
                  <tr>
                    <th className="text-left px-4 py-2.5">用户名</th>
                    <th className="text-left px-4 py-2.5">显示名</th>
                    <th className="text-left px-4 py-2.5">角色</th>
                    <th className="text-left px-4 py-2.5">积分上限</th>
                    <th className="text-left px-4 py-2.5">上次登录</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {users.map((user) => (
                    <tr key={user.id} className="text-gray-300 hover:bg-gray-800/50">
                      <td className="px-4 py-2.5 font-mono">{user.username}</td>
                      <td className="px-4 py-2.5">{user.display_name || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${user.role === 'admin' ? 'bg-purple-900/50 text-purple-300' : 'bg-gray-700 text-gray-400'}`}>
                          {user.role === 'admin' ? '管理员' : user.readonly ? '只读子账号' : '子账号'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">{formatCreditLimit(user.credit_limit)}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{formatDate(user.last_login_at)}</td>
                      <td className="px-4 py-2.5">
                        {user.role !== 'admin' && (
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => openEdit(user)}
                              className="text-gray-400 hover:text-white transition"
                              title="编辑"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(user)}
                              className="text-red-400 hover:text-red-300 transition"
                              title="删除"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showEditor && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <h3 className="text-base font-semibold text-white">
                {editingUser ? `编辑账号：${editingUser.username}` : '新建子账号'}
              </h3>
              <button onClick={cancelForm} className="text-gray-400 hover:text-white transition">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">用户名</label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    readOnly={!!editingUser}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-blue-500 read-only:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">显示名称</label>
                  <input
                    type="text"
                    value={form.display_name}
                    onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    密码{editingUser ? '（留空不修改）' : ''}
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">积分使用上限</label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    placeholder="留空 = 不限制"
                    value={form.credit_limit}
                    onChange={(e) => setForm((f) => ({ ...f, credit_limit: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">现有用户没有该字段时默认不限制；生成消耗不会写入用户文件。</p>
                </div>
              </div>

              {projects.length > 0 && (
                <div className="border border-gray-700 rounded-lg p-3 bg-gray-800/40">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3">
                    <div>
                      <label className="block text-sm text-gray-300">可访问项目</label>
                      <p className="text-xs text-gray-500">已选 {form.assigned_project_ids.length} / {projects.length}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={selectFilteredProjects}
                        className="px-2.5 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition"
                      >
                        全选当前结果
                      </button>
                      <button
                        type="button"
                        onClick={clearFilteredProjects}
                        className="px-2.5 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition"
                      >
                        取消当前结果
                      </button>
                    </div>
                  </div>

                  <div className="relative mb-3">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      placeholder="搜索项目名称或 ID"
                      className="w-full bg-gray-700 text-white rounded-lg pl-9 pr-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500"
                    />
                  </div>

                  <div className="max-h-72 overflow-y-auto pr-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                    {filteredProjects.map((project) => (
                      <label key={project.project_id} className="flex items-start gap-2 cursor-pointer text-sm text-gray-300 hover:text-white bg-gray-900/50 border border-gray-700 rounded-lg px-3 py-2">
                        <input
                          type="checkbox"
                          checked={form.assigned_project_ids.includes(project.project_id)}
                          onChange={() => toggleProject(project.project_id)}
                          className="accent-blue-500 mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block truncate">{getProjectName(project)}</span>
                          <span className="block truncate text-xs text-gray-500">{project.project_id}</span>
                        </span>
                      </label>
                    ))}
                    {filteredProjects.length === 0 && (
                      <div className="col-span-full text-center text-sm text-gray-500 py-8">没有匹配的项目</div>
                    )}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={form.readonly}
                  onChange={(e) => setForm((f) => ({ ...f, readonly: e.target.checked }))}
                  className="accent-blue-500"
                />
                只读账号（只能查看，不能编辑或生成）
              </label>

              {error && <p className="text-red-400 text-xs">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-700">
              <button
                onClick={cancelForm}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
