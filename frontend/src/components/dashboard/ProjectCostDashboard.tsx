import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ProjectCostBreakdown, ProjectStats, ProjectUserCost } from '@/types';
import { projectApi } from '@/services/api';
import { DEFAULT_IMAGE_COST, DEFAULT_VIDEO_COST_PER_SEC } from '@/constants/pricing';
import { useAdminAuthStore } from '@/store/adminAuthStore';

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
  failed_video_cost: number;
  other_cost: number;
  total_cost: number;
}

const fmt = (n: number) => (n / 10000).toFixed(2) + '万积分';
const fmty = (n: number) => (n / 200).toFixed(2) + '元';

function calcCost(stats?: ProjectStats | null): CostSummary {
  if (!stats) {
    return { image_cost: 0, video_cost: 0, failed_video_cost: 0, other_cost: 0, total_cost: 0 };
  }

  const video_cost = stats.total_video_compute_units ?? (DEFAULT_VIDEO_COST_PER_SEC * (stats.total_video_seconds || 0));
  const failed_video_cost = stats.failed_video_compute_units ?? 0;
  const success_video_cost = Math.max(video_cost - failed_video_cost, 0);
  const other_cost = stats.other_cost ?? 0;
  const total_cost = stats.total_compute_spent ?? ((stats.total_image_cost ?? DEFAULT_IMAGE_COST * (stats.total_images || 0)) + video_cost + other_cost);
  const image_cost = stats.total_image_cost ?? Math.max(total_cost - video_cost - other_cost, 0);

  return { image_cost, video_cost: success_video_cost, failed_video_cost, other_cost, total_cost };
}

type CostViewMode = 'daily' | 'episode';

interface ChartItem {
  key: string;
  label: string;
  title: string;
  image_cost: number;
  video_cost: number;
  failed_video_cost: number;
  total_cost: number;
}

export function ProjectCostDashboard({ projectId, stats, userCosts = {}, unknownCosts, onClose }: ProjectCostDashboardProps) {
  const username = useAdminAuthStore((state) => state.username);
  const isSuperAdmin = username === 'admin';
  const [costBreakdown, setCostBreakdown] = useState<ProjectCostBreakdown>({ daily_costs: [], episode_costs: [] });
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState('');
  const [viewMode, setViewMode] = useState<CostViewMode>('daily');
  const costs = calcCost(stats);
  const participants = Object.entries(userCosts)
    .map(([username, cost]) => ({ username, other_cost: 0, ...cost }))
    .filter(user => (user.total_cost || 0) > 0)
    .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));
  const unknownImageCost = unknownCosts?.image_cost || 0;
  const unknownVideoCost = unknownCosts?.video_cost || 0;
  const unknownFailedVideoCost = unknownCosts?.failed_video_cost || 0;
  const unknownTotalCost = unknownCosts?.total_cost || 0;
  const projectCostTotal = unknownTotalCost + costs.other_cost;
  const participantRows = projectCostTotal > 0
    ? [...participants, { username: '项目消耗', image_cost: unknownImageCost, video_cost: unknownVideoCost, failed_video_cost: unknownFailedVideoCost, other_cost: costs.other_cost, total_cost: projectCostTotal }]
    : participants;
  const hasCost = costs.total_cost > 0 || participantRows.length > 0;
  const chartItems: ChartItem[] = viewMode === 'daily'
    ? costBreakdown.daily_costs.map(item => ({
      key: item.date,
      label: item.date.slice(5),
      title: item.date,
      image_cost: item.image_cost,
      video_cost: item.video_cost,
      failed_video_cost: item.failed_video_cost || 0,
      total_cost: item.total_cost,
    }))
    : [...costBreakdown.episode_costs]
      .sort((a, b) => (a.episode_number || 0) - (b.episode_number || 0))
      .map(item => {
        const episodeNumber = item.episode_number && item.episode_number < 999999 ? item.episode_number : null;
        return {
          key: item.episode_id,
          label: episodeNumber ? String(episodeNumber) : '未知',
          title: episodeNumber ? `第${episodeNumber}集` : '未知',
          image_cost: item.image_cost,
          video_cost: item.video_cost,
          failed_video_cost: item.failed_video_cost || 0,
          total_cost: item.total_cost,
        };
      });
  const maxChartCost = Math.max(...chartItems.map(item => item.total_cost), 0);
  const yTicks = maxChartCost > 0 ? [maxChartCost, maxChartCost / 2, 0] : [0];
  const labelStep = chartItems.length > 18 ? Math.ceil(chartItems.length / 12) : 1;

  useEffect(() => {
    let cancelled = false;
    setCostLoading(true);
    setCostError('');
    projectApi.getCostBreakdown(projectId)
      .then(res => {
        if (!cancelled) setCostBreakdown({ daily_costs: res.data?.daily_costs || [], episode_costs: res.data?.episode_costs || [] });
      })
      .catch(err => {
        console.error('加载项目消耗明细失败', err);
        if (!cancelled) setCostError('消耗明细加载失败');
      })
      .finally(() => {
        if (!cancelled) setCostLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-[80vw] max-w-[80vw] max-h-[88vh] overflow-hidden flex flex-col text-white">
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
          <div className={`grid ${isSuperAdmin ? 'grid-cols-6' : 'grid-cols-5'} gap-4`}>
            {[
              { label: '总消耗', value: fmt(costs.total_cost), color: 'text-white' },
              { label: '图片费用', value: fmt(costs.image_cost), color: 'text-blue-400' },
              { label: isSuperAdmin ? '成功视频费用' : '视频费用', value: fmt(isSuperAdmin ? costs.video_cost : costs.video_cost + costs.failed_video_cost), color: 'text-green-400' },
              ...(isSuperAdmin ? [{ label: '失败/异常消耗', value: fmt(costs.failed_video_cost), color: 'text-red-400' }] : []),
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
              <div className="flex items-center gap-2">
                {[
                  { key: 'daily' as CostViewMode, label: '按日期消耗' },
                  { key: 'episode' as CostViewMode, label: '按集消耗' },
                ].map(item => (
                  <button
                    key={item.key}
                    onClick={() => setViewMode(item.key)}
                    className={`px-3 py-1.5 rounded-lg text-sm transition ${viewMode === item.key ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400" />图片</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-400" />视频</span>
                {isSuperAdmin && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400" />失败/异常</span>}
              </div>
            </div>
            <div className="bg-gray-700/40 rounded-lg p-4 min-h-[260px]">
              {costLoading ? (
                <div className="h-[220px] flex items-center justify-center text-gray-400">加载消耗明细中...</div>
              ) : costError ? (
                <div className="h-[220px] flex items-center justify-center text-red-300">{costError}</div>
              ) : chartItems.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-gray-400">暂无{viewMode === 'daily' ? '按日期' : '按集'}消耗数据</div>
              ) : (
                <div className="grid grid-cols-[72px_1fr] gap-3 h-[220px]">
                  <div className="relative h-[180px] text-[10px] text-gray-400">
                    {yTicks.map((tick, index) => (
                      <div
                        key={`${tick}-${index}`}
                        className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
                        style={{ top: `${maxChartCost > 0 ? 100 - (tick / maxChartCost) * 100 : 100}%` }}
                      >
                        {fmt(tick)}
                      </div>
                    ))}
                  </div>
                  <div className="min-w-0">
                    <div className="relative h-[180px] border-l border-b border-gray-600/80">
                      {[0, 50, 100].map(top => (
                        <div key={top} className="absolute left-0 right-0 border-t border-gray-600/40" style={{ top: `${top}%` }} />
                      ))}
                      <div className="absolute inset-x-1 bottom-0 top-0 flex items-end gap-[2px]">
                        {chartItems.map(item => {
                          const height = maxChartCost > 0 ? Math.max((item.total_cost / maxChartCost) * 100, 2) : 2;
                          const imageHeight = item.total_cost > 0 ? (item.image_cost / item.total_cost) * 100 : 0;
                          const displayedVideoCost = isSuperAdmin ? item.video_cost : item.video_cost + item.failed_video_cost;
                          const videoHeight = item.total_cost > 0 ? (displayedVideoCost / item.total_cost) * 100 : 0;
                          const failedVideoHeight = isSuperAdmin && item.total_cost > 0 ? (item.failed_video_cost / item.total_cost) * 100 : 0;
                          return (
                            <div key={item.key} className="flex-1 min-w-0 h-full flex flex-col justify-end group">
                              <div
                                className="w-full max-w-[14px] mx-auto rounded-t overflow-hidden flex flex-col-reverse"
                                style={{ height: `${height}%` }}
                                title={isSuperAdmin
                                  ? `${item.title}：${fmt(item.total_cost)}，图片 ${fmt(item.image_cost)}，视频 ${fmt(item.video_cost)}，失败/异常 ${fmt(item.failed_video_cost)}`
                                  : `${item.title}：${fmt(item.total_cost)}，图片 ${fmt(item.image_cost)}，视频 ${fmt(displayedVideoCost)}`}
                              >
                                {item.image_cost > 0 && <div className="bg-blue-400" style={{ height: `${imageHeight}%` }} />}
                                {displayedVideoCost > 0 && <div className="bg-green-400" style={{ height: `${videoHeight}%` }} />}
                                {isSuperAdmin && item.failed_video_cost > 0 && <div className="bg-red-400" style={{ height: `${failedVideoHeight}%` }} />}
                              </div>
                              <div className="absolute -top-5 hidden group-hover:block text-[10px] text-gray-200 whitespace-nowrap bg-gray-900/90 px-1.5 py-0.5 rounded">
                                {item.title} {fmt(item.total_cost)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="relative h-8 mt-2 flex gap-[2px] text-[10px] text-gray-400">
                      {chartItems.map((item, index) => {
                        const showLabel = index === 0 || index === chartItems.length - 1 || index % labelStep === 0;
                        return (
                          <div key={item.key} className="flex-1 min-w-0 text-center">
                            {showLabel && (
                              <span className={viewMode === 'daily'
                                ? 'inline-block -rotate-45 origin-top whitespace-nowrap max-w-24 truncate'
                                : 'inline-block whitespace-nowrap font-medium text-gray-300'}>
                                {item.label}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
                        <th className="text-right py-2 pr-4">{isSuperAdmin ? '成功视频费用' : '视频费用'}</th>
                        {isSuperAdmin && <th className="text-right py-2 pr-4">失败/异常消耗</th>}
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
                          <td className="text-right py-2 pr-4 text-green-400">{fmt(isSuperAdmin ? (user.video_cost || 0) : (user.video_cost || 0) + (user.failed_video_cost || 0))}</td>
                          {isSuperAdmin && <td className="text-right py-2 pr-4 text-red-400">{fmt(user.failed_video_cost || 0)}</td>}
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
                        <td className="text-right py-2 pr-4 text-green-400">{fmt(participantRows.reduce((s, u) => s + (u.video_cost || 0) + (isSuperAdmin ? 0 : (u.failed_video_cost || 0)), 0))}</td>
                        {isSuperAdmin && <td className="text-right py-2 pr-4 text-red-400">{fmt(participantRows.reduce((s, u) => s + (u.failed_video_cost || 0), 0))}</td>}
                        <td className="text-right py-2 pr-4 text-purple-400">{fmt(participantRows.reduce((s, u) => s + (u.other_cost || 0), 0))}</td>
                        <td className="text-right py-2 pr-4 text-yellow-400">{fmty(participantRows.reduce((s, u) => s + (u.total_cost || 0), 0))}</td>
                        <td className="text-right py-2">{fmt(participantRows.reduce((s, u) => s + (u.total_cost || 0), 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <p className="text-xs text-gray-500 mt-3">项目消耗包含早期统计中未被计入用户消耗的积分，其他为龙虾对话消耗的积分</p>
              {isSuperAdmin && <p className="text-xs text-gray-500 mt-2">失败/异常消耗统计状态为 failed / poll_failed 且当前仍被本地消耗统计计入的视频记录；已退款记录不计入。</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
