import { useState, useMemo } from 'react';
import { X, Search, Plus, Trash2 } from 'lucide-react';
import { adminUserApi } from '@/services/api';
import { Project } from '@/types';

interface ParticipantUser {
  id: string;
  username: string;
  display_name: string;
  last_login_at: string | null;
  assigned_project_ids: string[];
  readonly?: boolean;
}

interface Props {
  project: Project;
  participants: ParticipantUser[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onUpdated: () => void;
  allUsers: ParticipantUser[];
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN');
}

export function ProjectParticipantsModal({ project, participants, loading, error, onClose, onUpdated, allUsers }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  // 当前已参与用户的 ID 集合
  const participantIds = useMemo(() => new Set(participants.map(u => u.id)), [participants]);

  // 搜索过滤：匹配用户名/显示名，且不在当前参与者中
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allUsers
      .filter(u => !participantIds.has(u.id))
      .filter(u => u.username.toLowerCase().includes(q) || (u.display_name || '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [searchQuery, allUsers, participantIds]);

  async function handleAddUser(user: ParticipantUser) {
    setUpdatingUserId(user.id);
    try {
      const newIds = [...(user.assigned_project_ids || []), project.project_id];
      await adminUserApi.update(user.id, { assigned_project_ids: newIds });
      onUpdated();
      setSearchQuery('');
    } catch {
      // 静默失败，由 onUpdated 重载列表
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function handleRemoveUser(user: ParticipantUser) {
    if (!confirm(`确定要将「${user.display_name || user.username}」移出此项目吗？`)) return;
    setUpdatingUserId(user.id);
    try {
      const newIds = (user.assigned_project_ids || []).filter(id => id !== project.project_id);
      await adminUserApi.update(user.id, { assigned_project_ids: newIds });
      onUpdated();
    } catch {
      // 静默失败
    } finally {
      setUpdatingUserId(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex justify-between items-center gap-4 px-6 py-5 border-b border-gray-700 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">项目参与者</h2>
            <p className="text-sm text-gray-400 mt-1 truncate">{project.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition shrink-0" aria-label="关闭参与者窗口">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 搜索添加区 */}
          <div>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索已有账号以添加..."
                className="w-full bg-gray-700 text-white rounded-lg pl-9 pr-3 py-2 text-sm border border-gray-600 focus:outline-none focus:border-blue-500 placeholder-gray-500"
              />
            </div>

            {/* 搜索结果下拉 */}
            {searchQuery.trim() && (
              <div className="mt-2 border border-gray-700 rounded-lg bg-gray-900/60 divide-y divide-gray-700/50 max-h-48 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500 text-center">没有匹配的账号</div>
                ) : (
                  searchResults.map(user => (
                    <div key={user.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="min-w-0">
                        <span className="text-sm text-white truncate block">{user.display_name || user.username}</span>
                        <span className="text-xs text-gray-500 font-mono">@{user.username}</span>
                      </div>
                      <button
                        onClick={() => handleAddUser(user)}
                        disabled={updatingUserId === user.id}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition disabled:opacity-50 shrink-0"
                      >
                        <Plus size={12} />
                        {updatingUserId === user.id ? '...' : '添加'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 已授权用户列表 */}
          <div>
            <div className="flex items-center justify-between text-sm text-gray-400 mb-2">
              <span>已授权用户</span>
              <span>{loading ? '加载中...' : `${participants.length} 人`}</span>
            </div>

            {loading ? (
              <div className="space-y-2">
                <div className="h-12 bg-gray-700 rounded-lg animate-pulse" />
                <div className="h-12 bg-gray-700 rounded-lg animate-pulse" />
              </div>
            ) : error ? (
              <p className="text-sm text-red-400 py-2">{error}</p>
            ) : participants.length === 0 ? (
              <div className="bg-gray-700/50 rounded-lg p-4 text-sm text-gray-400">
                当前项目暂无参与者，请在上方搜索并添加
              </div>
            ) : (
              <div className="space-y-2">
                {participants.map(user => (
                  <div key={user.id} className="flex items-center justify-between px-4 py-3 bg-gray-700/30 border border-gray-700 rounded-lg">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium truncate">{user.display_name || user.username}</span>
                        {user.readonly && (
                          <span className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300 shrink-0">只读</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        @{user.username} · 上次登录 {formatDate(user.last_login_at)}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveUser(user)}
                      disabled={updatingUserId === user.id}
                      className="text-gray-500 hover:text-red-400 transition shrink-0 disabled:opacity-30"
                      title="移出项目"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-gray-700 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
