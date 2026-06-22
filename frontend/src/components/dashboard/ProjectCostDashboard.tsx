import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ProjectDailyCost, ProjectStats, ProjectUserCost } from '@/types';
import { projectApi } from '@/services/api';
import { DEFAULT_IMAGE_COST, DEFAULT_VIDEO_COST_PER_SEC } from '@/constants/pricing';

interface ProjectCostDashboardProps {
  projectId: string;
  stats?: ProjectStats | null;
  userCosts?: Record<string, ProjectUserCost>;
  unknownCosts?: ProjectUserCost;
  onClose: () => void;
}

interface CostSummary {
  image_cost: number;
  video_cost: number;
  other_cost: number;
  total_cost: number;
}

const fmt = (n: number) => (n / 10000).toFixed(2) + '万积分';
const fmty = (n: number) => (n / 200).toFixed(2) + '元';

function calcCost(stats?: ProjectStats | null): CostSummary {
  if (!stats) {
    return { image_cost: 0, video_cost: 0, other_cost: 0, total_cost: 0 };
  }

  const video_cost = stats.total_video_compute_units ?? (DEFAULT_VIDEO_COST_PER_SEC * (stats.total_video_seconds || 0));
  const other_cost = stats.other_cost ?? 0;
  const total_cost = stats.total_compute_spent ?? ((stats.total_image_cost ?? DEFAULT_IMAGE_COST * (stats.total_images || 0)) + video_cost + other_cost);
  const image_cost = stats.total_image_cost ?? Math.max(total_cost - video_cost - other_cost, 0);

  return { image_cost, video_cost, other_cost, total_cost };
}

export function ProjectCostDashboard({ projectId, stats, userCosts = {}, unknownCosts, onClose }: ProjectCostDashboardProps) {
  const [dailyCosts, setDailyCosts] = useState<ProjectDailyCost[]>([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState('');
  const costs = calcCost(stats);
  const participants = Object.entries(userCosts)
    .map(([username, cost]) => ({ username, other_cost: 0, ...cost }))
    .filter(user => (user.total_cost || 0) > 0)
    .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));
  const unknownImageCost = unknownCosts?.image_cost || 0;
  const unknownVideoCost = unknownCosts?.video_cost || 0;
  const unknownTotalCost = unknownCosts?.total_cost || 0;
  const projectCostTotal = unknownTotalCost + costs.other_cost;
  const participantRows = projectCostTotal > 0
    ? [...participants, { username: '项目消耗', image_cost: unknownImageCost, video_cost: unknownVideoCost, other_cost: costs.other_cost, total_cost: projectCostTotal }]
    : participants;
  const hasCost = costs.total_cost > 0 || participantRows.length > 0;
  const maxDailyCost = Math.max(...dailyCosts.map(item => item.total_cost), 0);

  useEffect(() => {
    let cancelled = false;
    setDailyLoading(true);
    setDailyError('');
    projectApi.getDailyCost(projectId)
      .then(res => {
        if (!cancelled) setDailyCosts(res.data || []);
      })
      .catch(err => {
        console.error('加载项目日期消耗失败', err);
        if (!cancelled) setDailyError('按日期消耗加载失败');
      })
      .finally(() => {
        if (!cancelled) setDailyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-[960px] max-h-[88vh] overflow-hidden flex flex-col text-white">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-semibold">项目消耗看板</h2>
            <div className="text-xs text-gray-400 mt-1">复用项目统计缓存，显示当前项目总计和参与用户</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition" title="关闭">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-auto space-y-6">
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: '总消耗', value: fmt(costs.total_cost), color: 'text-white' },
              { label: '图片费用', value: fmt(costs.image_cost), color: 'text-blue-400' },
              { label: '视频费用', value: fmt(costs.video_cost), color: 'text-green-400' },
              { label: '其他', value: fmt(costs.other_cost), color: 'text-purple-400' },
              { label: '预估费用', value: fmty(costs.total_cost), color: 'text-yellow-400' },
            ].map(card => (
              <div key={card.label} className="bg-gray-700 rounded-lg p-4 text-center min-w-0">
                <div className={`text-xl font-bold ${card.color} whitespace-nowrap`}>{card.value}</div>
                <div className="text-xs text-gray-400 mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-300">按日期消耗</h3>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400" />图片</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-400" />视频</span>
              </div>
            </div>
            <div className="bg-gray-700/40 rounded-lg p-4 min-h-[220px]">
              {dailyLoading ? (
                <div className="h-[180px] flex items-center justify-center text-gray-400">加载按日期消耗中...</div>
              ) : dailyError ? (
                <div className="h-[180px] flex items-center justify-center text-red-300">{dailyError}</div>
              ) : dailyCosts.length === 0 ? (
                <div className="h-[180px] flex items-center justify-center text-gray-400">暂无按日期消耗数据</div>
              ) : (
                <div className="overflow-x-auto pb-1">
                  <div className="flex items-end gap-3 min-w-max h-[180px] px-1">
                    {dailyCosts.map(item => {
                      const height = maxDailyCost > 0 ? Math.max((item.total_cost / maxDailyCost) * 132, 8) : 8;
                      const imageHeight = item.total_cost > 0 ? (item.image_cost / item.total_cost) * height : 0;
                      const videoHeight = Math.max(height - imageHeight, 0);
                      return (
                        <div key={item.date} className="w-16 flex flex-col items-center justify-end gap-2 group">
                          <div className="text-[10px] text-gray-300 opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
                            {fmt(item.total_cost)}
                          </div>
                          <div className="w-8 rounded-t bg-gray-600 overflow-hidden flex flex-col-reverse" style={{ height }} title={`${item.date}：${fmt(item.total_cost)}，图片 ${fmt(item.image_cost)}，视频 ${fmt(item.video_cost)}`}>
                            {item.image_cost > 0 && <div className="bg-blue-400" style={{ height: imageHeight }} />}
                            {item.video_cost > 0 && <div className="bg-green-400" style={{ height: videoHeight }} />}
                          </div>
                          <div className="text-[10px] text-gray-400 whitespace-nowrap">{item.date.slice(5)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">按日期消耗仅统计有消耗记录的图片和视频；其他消耗保留在顶部总计中。</p>
          </div>

          {!hasCost ? (
            <div className="text-center text-gray-400 py-16">暂无消耗数据</div>
          ) : (
            <div>
              <h3 className="text-sm font-medium text-gray-300 mb-3">参与用户</h3>
              {participantRows.length === 0 ? (
                <div className="text-center text-gray-400 py-12 bg-gray-700/40 rounded-lg">暂无用户归属数据</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-700">
                        <th className="text-left py-2 pr-4">用户名</th>
                        <th className="text-right py-2 pr-4">图片费用</th>
                        <th className="text-right py-2 pr-4">视频费用</th>
                        <th className="text-right py-2 pr-4">其他</th>
                        <th className="text-right py-2 pr-4">预估费用</th>
                        <th className="text-right py-2">实际消耗</th>
                      </tr>
                    </thead>
                    <tbody>
                      {participantRows.map(user => (
                        <tr key={user.username} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                          <td className="py-2 pr-4">{user.username}</td>
                          <td className="text-right py-2 pr-4 text-blue-400">{fmt(user.image_cost || 0)}</td>
                          <td className="text-right py-2 pr-4 text-green-400">{fmt(user.video_cost || 0)}</td>
                          <td className="text-right py-2 pr-4 text-purple-400">{fmt(user.other_cost || 0)}</td>
                          <td className="text-right py-2 pr-4 text-yellow-400">{fmty(user.total_cost || 0)}</td>
                          <td className="text-right py-2 font-medium">{fmt(user.total_cost || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="text-gray-300 font-semibold">
                        <td className="py-2 pr-4">合计</td>
                        <td className="text-right py-2 pr-4 text-blue-400">{fmt(participantRows.reduce((s, u) => s + (u.image_cost || 0), 0))}</td>
                        <td className="text-right py-2 pr-4 text-green-400">{fmt(participantRows.reduce((s, u) => s + (u.video_cost || 0), 0))}</td>
                        <td className="text-right py-2 pr-4 text-purple-400">{fmt(participantRows.reduce((s, u) => s + (u.other_cost || 0), 0))}</td>
                        <td className="text-right py-2 pr-4 text-yellow-400">{fmty(participantRows.reduce((s, u) => s + (u.total_cost || 0), 0))}</td>
                        <td className="text-right py-2">{fmt(participantRows.reduce((s, u) => s + (u.total_cost || 0), 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <p className="text-xs text-gray-500 mt-3">项目消耗包含早期统计中未被计入用户消耗的积分，其他为龙虾对话消耗的积分</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
