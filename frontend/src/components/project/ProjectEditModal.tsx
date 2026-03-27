import { useState } from 'react';
import { X } from 'lucide-react';
import { projectApi } from '@/services/api';
import { Project } from '@/types';
import { useAdminAuthStore } from '@/store/adminAuthStore';

interface ProjectStats {
  total_images: number;
  total_video_seconds: number;
}

interface Props {
  project: Project;
  stats?: ProjectStats | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ProjectEditModal({ project, stats, onClose, onSaved }: Props) {
  const { role } = useAdminAuthStore();
  const isAdmin = role === 'admin';
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [totalEpisodes, setTotalEpisodes] = useState(project.total_episodes ?? 0);
  const [minutesPerEpisode, setMinutesPerEpisode] = useState(project.minutes_per_episode ?? 0);
  const [computeBudget, setComputeBudget] = useState(project.compute_budget_per_minute ?? 0);
  const [durationDays, setDurationDays] = useState(project.project_duration_days ?? 0);
  const [budgetTotal, setBudgetTotal] = useState<string>(
    project.budget_total != null ? String(project.budget_total) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const actualSpent = stats != null
    ? 0.4 * stats.total_images + 1.0 * stats.total_video_seconds
    : null;

  const handleSave = async () => {
    if (!name.trim()) {
      setError('项目名称不能为空');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await projectApi.update(project.project_id, {
        name: name.trim(),
        description,
        total_episodes: totalEpisodes,
        minutes_per_episode: minutesPerEpisode,
        compute_budget_per_minute: computeBudget,
        project_duration_days: durationDays,
      });
      if (isAdmin) {
        const parsedBudget = budgetTotal.trim() === '' ? null : Number(budgetTotal);
        await projectApi.setBudget(project.project_id, parsedBudget);
      }
      onSaved();
    } catch (e: any) {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl w-full max-w-lg mx-4 p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold">编辑项目</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">项目名称</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">项目描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">总集数</label>
              <input
                type="number"
                min={0}
                value={totalEpisodes}
                onChange={e => setTotalEpisodes(Number(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">每集分钟数</label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={minutesPerEpisode}
                onChange={e => setMinutesPerEpisode(Number(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">算力预算 / 分钟</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={computeBudget}
                onChange={e => setComputeBudget(Number(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">工期（天）</label>
              <input
                type="number"
                min={0}
                value={durationDays}
                onChange={e => setDurationDays(Number(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {isAdmin && (
            <>
              <div className="border-t border-gray-700 pt-3">
                <p className="text-xs text-gray-500 mb-3">管理员 · 项目预算</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">总预算上限</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      placeholder="留空 = 不限制"
                      value={budgetTotal}
                      onChange={e => setBudgetTotal(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 placeholder-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">已消耗</label>
                    <div className={`w-full bg-gray-700 border rounded-lg px-3 py-2 text-sm ${
                      project.budget_total != null && actualSpent != null && actualSpent >= project.budget_total
                        ? 'border-red-500 text-red-400'
                        : 'border-gray-600 text-gray-300'
                    }`}>
                      {actualSpent != null ? actualSpent.toFixed(2) : '—'}
                      {project.budget_total != null && actualSpent != null && actualSpent >= project.budget_total && (
                        <span className="ml-2 text-xs text-red-400">已锁定</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm transition"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
