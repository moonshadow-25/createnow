import { useEffect, useState } from 'react';
import { X, Plus, Pencil, Trash2 } from 'lucide-react';
import { adminUserApi, projectApi } from '@/services/api';

interface User {
  id: string;
  username: string;
  role: string;
  display_name: string;
  last_login_at: string | null;
  assigned_project_ids: string[];
  readonly?: boolean;
}

interface Project {
  project_id: string;
  name: string;
}

interface FormState {
  username: string;
  display_name: string;
  password: string;
  assigned_project_ids: string[];
  readonly: boolean;
}

const EMPTY_FORM: FormState = {
  username: '',
  display_name: '',
  password: '',
  assigned_project_ids: [],
  readonly: false,
};

interface Props {
  onClose: () => void;
}

export function AdminUserPanel({ onClose }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadUsers();
    projectApi.list().then((r) => setProjects(r.data)).catch(() => {});
  }, []);

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
    setError('');
    setShowForm(true);
  }

  function openEdit(user: User) {
    setEditingUser(user);
    setForm({
      username: user.username,
      display_name: user.display_name || '',
      password: '',
      assigned_project_ids: user.assigned_project_ids || [],
      readonly: user.readonly ?? false,
    });
    setError('');
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setError('');
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      if (editingUser) {
        await adminUserApi.update(editingUser.id, {
          display_name: form.display_name || undefined,
          password: form.password || undefined,
          assigned_project_ids: form.assigned_project_ids,
          readonly: form.readonly,
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
        });
      }
      setShowForm(false);
      setEditingUser(null);
      setForm(EMPTY_FORM);
      await loadUsers();
    } catch (e: any) {
      setError(e?.response?.data?.detail || '操作失败');
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

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('zh-CN');
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
          {/* 新建/编辑表单 */}
          {showForm && (
            <div className="bg-gray-800 border border-gray-600 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-gray-300">
                {editingUser ? `编辑账号：${editingUser.username}` : '新建子账号'}
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">用户名</label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    readOnly={!!editingUser}
                    className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600 focus:outline-none focus:border-blue-500 read-only:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">显示名称</label>
                  <input
                    type="text"
                    value={form.display_name}
                    onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                    className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  密码{editingUser ? '（留空不修改）' : ''}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              {projects.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-400 mb-2">可访问项目</label>
                  <div className="max-h-36 overflow-y-auto space-y-1">
                    {projects.map((p) => (
                      <label key={p.project_id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white">
                        <input
                          type="checkbox"
                          checked={form.assigned_project_ids.includes(p.project_id)}
                          onChange={() => toggleProject(p.project_id)}
                          className="accent-blue-500"
                        />
                        {p.name}
                      </label>
                    ))}
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

              <div className="flex justify-end gap-2">
                <button
                  onClick={cancelForm}
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* 用户列表 */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm text-gray-400">共 {users.length} 个账号</span>
              {!showForm && (
                <button
                  onClick={openCreate}
                  className="flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded transition"
                >
                  <Plus size={14} />
                  新建子账号
                </button>
              )}
            </div>

            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-800 text-gray-400">
                  <tr>
                    <th className="text-left px-4 py-2.5">用户名</th>
                    <th className="text-left px-4 py-2.5">显示名</th>
                    <th className="text-left px-4 py-2.5">角色</th>
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
    </div>
  );
}
