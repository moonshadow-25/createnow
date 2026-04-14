import { useEffect, useState } from 'react';
import { X, BarChart2 } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { adminUserApi } from '@/services/api';
import { Project } from '@/types';

interface ProjectStats {
  total_images: number;
  total_video_seconds: number;
}

interface CostDashboardProps {
  projects: Project[];
  projectStats: Record<string, ProjectStats | null>;
  isAdmin: boolean;
  onClose: () => void;
}

interface ProjectCost {
  project_id: string;
  name: string;
  image_cost: number;
  video_cost: number;
  total_cost: number;
}

interface UserCost {
  username: string;
  display_name?: string;
  estimated_cost: number;
  project_count: number;
}

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
  '#14b8a6', '#eab308', '#f43f5e', '#a855f7', '#0ea5e9',
];

function calcCost(stats: ProjectStats | null): { image_cost: number; video_cost: number; total_cost: number } {
  if (!stats) return { image_cost: 0, video_cost: 0, total_cost: 0 };
  const image_cost = 0.4 * (stats.total_images || 0);
  const video_cost = 1.0 * (stats.total_video_seconds || 0);
  return { image_cost, video_cost, total_cost: image_cost + video_cost };
}

const fmt = (n: number) => n.toFixed(2);

export function CostDashboard({ projects, projectStats, isAdmin, onClose }: CostDashboardProps) {
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    if (isAdmin) {
      adminUserApi.list().then(r => setUsers(r.data || [])).catch(() => {});
    }
  }, [isAdmin]);

  // 计算每个项目费用
  const projectCosts: ProjectCost[] = projects
    .map(p => ({
      project_id: p.project_id,
      name: p.name,
      ...calcCost(projectStats[p.project_id] ?? null),
    }))
    .filter(p => p.total_cost > 0)
    .sort((a, b) => b.total_cost - a.total_cost);

  const totalCost = projectCosts.reduce((s, p) => s + p.total_cost, 0);
  const totalImageCost = projectCosts.reduce((s, p) => s + p.image_cost, 0);
  const totalVideoCost = projectCosts.reduce((s, p) => s + p.video_cost, 0);

  // 饼图数据（最多显示前12个，其余合并为"其他"）
  const TOP_N = 12;
  let pieData = projectCosts.slice(0, TOP_N).map(p => ({
    name: p.name.length > 10 ? p.name.slice(0, 10) + '…' : p.name,
    value: parseFloat(p.total_cost.toFixed(2)),
  }));
  if (projectCosts.length > TOP_N) {
    const otherCost = projectCosts.slice(TOP_N).reduce((s, p) => s + p.total_cost, 0);
    pieData.push({ name: '其他', value: parseFloat(otherCost.toFixed(2)) });
  }

  // 按用户汇总：每个项目费用 ÷ 该项目的参与用户数，取平均分摊
  const projectUserCount: Record<string, number> = {};
  users.forEach(u => {
    (u.assigned_project_ids || []).forEach((id: string) => {
      projectUserCount[id] = (projectUserCount[id] || 0) + 1;
    });
  });

  const userCosts: UserCost[] = users
    .filter(u => u.assigned_project_ids?.length)
    .map(u => {
      const ids: string[] = u.assigned_project_ids || [];
      const estimated_cost = ids.reduce((s, id) => {
        const { total_cost } = calcCost(projectStats[id] ?? null);
        const participants = projectUserCount[id] || 1;
        return s + total_cost / participants;
      }, 0);
      return {
        username: u.username,
        display_name: u.display_name,
        estimated_cost,
        project_count: ids.length,
      };
    })
    .sort((a, b) => b.estimated_cost - a.estimated_cost);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <BarChart2 size={20} className="text-blue-400" />
            <h2 className="text-lg font-semibold">消耗看板</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* 汇总卡片 */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: '总消耗', value: `¥${fmt(totalCost)}`, color: 'text-white' },
              { label: '图片费用', value: `¥${fmt(totalImageCost)}`, color: 'text-blue-400' },
              { label: '视频费用', value: `¥${fmt(totalVideoCost)}`, color: 'text-green-400' },
            ].map(c => (
              <div key={c.label} className="bg-gray-700 rounded-lg p-4 text-center">
                <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                <div className="text-xs text-gray-400 mt-1">{c.label}</div>
              </div>
            ))}
          </div>

          {projectCosts.length === 0 ? (
            <div className="text-center text-gray-400 py-12">暂无消耗数据</div>
          ) : (
            <>
              {/* 饼图 */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-3">各项目消耗占比</h3>
                <ResponsiveContainer width="100%" height={360}>
                  <PieChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      dataKey="value"
                      label={({ name, percent, x, y, textAnchor }) => (
                        (percent ?? 0) > 0.03 ? (
                          <text x={x} y={y} textAnchor={textAnchor} fill="#d1d5db" fontSize={11}>
                            {name} {((percent ?? 0) * 100).toFixed(1)}%
                          </text>
                        ) : null
                      )}
                      labelLine={{ stroke: '#6b7280', strokeWidth: 1 }}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => [`¥${fmt(Number(v))}`, '消耗']} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* 项目明细表 */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-3">项目明细</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-700">
                        <th className="text-left py-2 pr-4">项目名称</th>
                        <th className="text-right py-2 pr-4">图片费用</th>
                        <th className="text-right py-2 pr-4">视频费用</th>
                        <th className="text-right py-2">总计</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectCosts.map((p, i) => (
                        <tr key={p.project_id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                          <td className="py-2 pr-4">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full mr-2"
                              style={{ background: COLORS[i % COLORS.length] }}
                            />
                            {p.name}
                          </td>
                          <td className="text-right py-2 pr-4 text-blue-400">¥{fmt(p.image_cost)}</td>
                          <td className="text-right py-2 pr-4 text-green-400">¥{fmt(p.video_cost)}</td>
                          <td className="text-right py-2 font-medium">¥{fmt(p.total_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="text-gray-300 font-semibold">
                        <td className="py-2 pr-4">合计</td>
                        <td className="text-right py-2 pr-4 text-blue-400">¥{fmt(totalImageCost)}</td>
                        <td className="text-right py-2 pr-4 text-green-400">¥{fmt(totalVideoCost)}</td>
                        <td className="text-right py-2">¥{fmt(totalCost)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* 用户汇总（仅管理员） */}
              {isAdmin && userCosts.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-300 mb-3">按用户汇总（基于平均值估计）</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-400 border-b border-gray-700">
                          <th className="text-left py-2 pr-4">用户名</th>
                          <th className="text-right py-2 pr-4">项目数</th>
                          <th className="text-right py-2">估算消耗</th>
                        </tr>
                      </thead>
                      <tbody>
                        {userCosts.map(u => (
                          <tr key={u.username} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                            <td className="py-2 pr-4">
                              {u.display_name ? `${u.display_name} (${u.username})` : u.username}
                            </td>
                            <td className="text-right py-2 pr-4 text-gray-400">{u.project_count}</td>
                            <td className="text-right py-2 font-medium">¥{fmt(u.estimated_cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">* 多人共享项目按参与人数平均分摊，仅供参考</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
