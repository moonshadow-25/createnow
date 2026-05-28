import { X } from 'lucide-react';
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
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN');
}

export function ProjectParticipantsModal({ project, participants, loading, error, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl w-full max-w-2xl mx-4 p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-lg font-semibold">项目参与者</h2>
            <p className="text-sm text-gray-400 mt-1">{project.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm text-gray-400">
            <span>参与人数</span>
            <span>{loading ? '加载中...' : `${participants.length} 人`}</span>
          </div>

          {loading ? (
            <div className="space-y-2">
              <div className="h-12 bg-gray-700 rounded-lg animate-pulse" />
              <div className="h-12 bg-gray-700 rounded-lg animate-pulse" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : participants.length === 0 ? (
            <div className="bg-gray-700/50 rounded-lg p-4 text-sm text-gray-400">
              当前项目暂无参与者
            </div>
          ) : (
            <div className="border border-gray-700 rounded-lg overflow-hidden divide-y divide-gray-700">
              {participants.map((user) => (
                <div key={user.id} className="px-4 py-3 flex items-center justify-between gap-4 bg-gray-800/50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium truncate">{user.display_name || user.username}</span>
                      {user.readonly && (
                        <span className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300">只读</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 font-mono mt-1">@{user.username}</div>
                  </div>
                  <div className="text-xs text-gray-500 text-right shrink-0">
                    <div>上次登录</div>
                    <div className="mt-1">{formatDate(user.last_login_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end mt-6">
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
