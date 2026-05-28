import { FolderOpen, Trash2, Pencil, Lock, Star, Users } from 'lucide-react';
import { Project } from '@/types';
import { useThemeStore } from '@/store/themeStore';
import { DEFAULT_IMAGE_COST, DEFAULT_VIDEO_COST_PER_SEC } from '@/constants/pricing';

interface ProjectStats {
  episode_count: number;
  total_storyboards: number;
  storyboards_with_image: number;
  storyboards_with_video: number;
  total_images: number;
  total_video_seconds: number;
  storyboard_video_seconds: number;
  total_video_compute_units?: number;
  storyboard_video_compute_units?: number;
  total_compute_spent?: number;
}

interface Props {
  project: Project;
  stats: ProjectStats | null | undefined;
  isAdmin: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onViewRating?: () => void;
  onViewParticipants?: () => void;
}

function computeMetrics(project: Project, stats: ProjectStats) {
  const {
    total_episodes = 0,
    minutes_per_episode = 0,
    compute_budget_per_minute = 0,
    project_duration_days = 0,
    created_at,
  } = project;
  const {
    episode_count,
    total_storyboards,
    storyboards_with_image,
    storyboards_with_video,
    total_images,
    total_video_seconds,
    storyboard_video_seconds,
  } = stats;

  const yellowPct = total_episodes > 0 ? Math.min(episode_count / total_episodes, 1) : 0;
  const storyboards_with_image_only = storyboards_with_image - storyboards_with_video;
  const greenPct =
    total_storyboards > 0
      ? Math.min(
          (storyboards_with_image_only * DEFAULT_IMAGE_COST + storyboards_with_video * DEFAULT_VIDEO_COST_PER_SEC) / total_storyboards,
          1
        )
      : 0;

  const video_cost = (stats.total_video_compute_units ?? (DEFAULT_VIDEO_COST_PER_SEC * total_video_seconds));
  const total_cost = stats.total_compute_spent ?? (DEFAULT_IMAGE_COST * total_images + video_cost);
  const image_cost = stats.total_compute_spent != null
    ? total_cost - video_cost
    : DEFAULT_IMAGE_COST * total_images;
  const completed_episodes = greenPct * episode_count;
  const greenBarPct = total_episodes > 0 ? completed_episodes / total_episodes : 0;
  let cost_per_minute: number | null = null;
  if (completed_episodes > 0 && minutes_per_episode > 0) {
    const storyboard_video_cost = (stats.storyboard_video_compute_units ?? (DEFAULT_VIDEO_COST_PER_SEC * storyboard_video_seconds));
    cost_per_minute = (image_cost + storyboard_video_cost) / (completed_episodes * minutes_per_episode);
  }

  let costColor = 'text-gray-400';
  if (cost_per_minute !== null && compute_budget_per_minute > 0) {
    const ratio = cost_per_minute / compute_budget_per_minute;
    if (ratio < 0.95) costColor = 'text-green-400';
    else if (ratio <= 1.05) costColor = 'text-yellow-400';
    else costColor = 'text-red-400';
  }

  const days_elapsed = (Date.now() - new Date(created_at).getTime()) / 86400000;
  const expected_ratio =
    project_duration_days > 0 ? Math.min(days_elapsed / project_duration_days, 1.0) : 0;
  const diff = greenPct - expected_ratio;
  let healthLabel = '符合预期';
  let healthColor = 'text-yellow-400';
  if (diff > 0.05) {
    healthLabel = '提前';
    healthColor = 'text-green-400';
  } else if (diff < -0.05) {
    healthLabel = '延期';
    healthColor = 'text-red-400';
  }

  const actual_ep = completed_episodes.toFixed(1);
  const expected_ep = (expected_ratio * total_episodes).toFixed(1);
  const completed_minutes = completed_episodes * minutes_per_episode;

  return {
    yellowPct,
    greenPct,
    greenBarPct,
    cost_per_minute,
    costColor,
    healthLabel,
    healthColor,
    actual_ep,
    expected_ep,
    episode_count,
    total_episodes,
    image_cost,
    video_cost,
    completed_minutes,
    total_images,
    total_video_seconds,
  };
}

export function ProjectCard({ project, stats, isAdmin, onOpen, onDelete, onEdit, onViewRating, onViewParticipants }: Props) {
  const configured = (project.total_episodes ?? 0) > 0;
  const appearanceMode = useThemeStore(s => s.appearanceMode);
  const isVipMode = appearanceMode === 'vip';

  if (isVipMode) {
    const totalCost = stats
      ? (stats.total_compute_spent ?? (DEFAULT_IMAGE_COST * stats.total_images + (stats.total_video_compute_units ?? (DEFAULT_VIDEO_COST_PER_SEC * stats.total_video_seconds))))
      : 0;
    const isLocked = !!(project.budget_total != null && stats && totalCost >= project.budget_total);
    const videoMinutes = stats ? stats.total_video_seconds / 60 : 0;
    const budgetText = project.budget_total != null
      ? `${Math.round(totalCost)}积分/${Math.round(project.budget_total)}积分`
      : `${Math.round(totalCost)}积分`;

    return (
      <div className="min-h-[236px] rounded-2xl px-4 py-4 flex flex-col relative overflow-hidden border border-[#786135]/45 shadow-[0_18px_40px_rgba(0,0,0,0.55)] bg-[linear-gradient(155deg,#14171d_0%,#11141a_48%,#1a1710_100%)]">
        <div className="absolute -top-16 left-1/2 h-40 w-56 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.18),rgba(255,255,255,0.03)_55%,transparent_75%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_16%,rgba(243,211,130,0.22),rgba(243,211,130,0.02)_42%,transparent_64%)] pointer-events-none" />

        <div className="relative z-10 flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-[#f5e7bf] leading-5 line-clamp-2">{project.name}</h3>
          <div className="flex items-center gap-1 flex-shrink-0">
            {isLocked && (
              <span title="预算已超出，API已锁定" className="text-red-400">
                <Lock size={13} />
              </span>
            )}
            {onViewRating && (
              <button onClick={e => { e.stopPropagation(); onViewRating(); }} className="text-yellow-400 hover:text-yellow-200 p-1" title="查看评分">
                <Star size={13} />
              </button>
            )}
            {isAdmin && onViewParticipants && (
              <button onClick={e => { e.stopPropagation(); onViewParticipants(); }} className="text-gray-400 hover:text-cyan-300 p-1" title="查看参与者">
                <Users size={13} />
              </button>
            )}
            {isAdmin && (
              <button onClick={e => { e.stopPropagation(); onEdit(); }} className="text-gray-400 hover:text-yellow-200 p-1" title="编辑项目">
                <Pencil size={13} />
              </button>
            )}
            {isAdmin && (
              <button onClick={e => { e.stopPropagation(); onDelete(); }} className="text-red-400 hover:text-red-300 p-1" title="删除项目">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="relative z-10 mt-6">
          {stats ? (
            <>
              <div className="text-[10px] tracking-[0.18em] text-gray-400">VIDEO MINUTES</div>
              <div className="mt-1 flex items-end gap-1.5">
                <span className="text-[34px] leading-none font-semibold text-[#f3d589]">{videoMinutes.toFixed(1)}</span>
                <span className="text-sm text-[#d4bc85] mb-1">分钟</span>
              </div>
              <div className="mt-2 text-xs text-gray-300">{stats.episode_count}/{project.total_episodes || 0} 集 · {stats.total_images} 图</div>
            </>
          ) : (
            <div className="text-sm text-gray-400">等待数据</div>
          )}
        </div>

        <div className="relative z-10 mt-auto flex items-end justify-between gap-3 pt-4">
          <div className="space-y-1">
            <div className="text-[11px] text-gray-400">{new Date(project.created_at).toLocaleDateString()}</div>
            {stats && (
              <div className={`text-xs font-mono ${isLocked ? 'text-red-300' : 'text-[#e8cc87]'}`}>{budgetText}</div>
            )}
          </div>
          <button
            onClick={onOpen}
            className="h-8 px-4 rounded-lg bg-gradient-to-r from-[#efd488] to-[#cfab5f] text-[#241b0d] text-xs font-semibold shadow-[0_6px_18px_rgba(216,179,96,0.38)] hover:brightness-105"
          >
            <span className="flex items-center gap-1">
              <FolderOpen size={13} />
              进入
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 p-6 flex flex-col gap-3 rounded-lg">
      <div className="flex justify-between items-start">
        <h3 className="text-xl font-semibold flex-1 mr-2 truncate">{project.name}</h3>
        <div className="flex items-center gap-1 flex-shrink-0">
          {project.budget_total != null && stats &&
            ((stats.total_compute_spent ?? (DEFAULT_IMAGE_COST * stats.total_images + (stats.total_video_compute_units ?? (DEFAULT_VIDEO_COST_PER_SEC * stats.total_video_seconds)))) >= project.budget_total) && (
            <span title="预算已超出，API已锁定" className="text-red-400">
              <Lock size={14} />
            </span>
          )}
          {onViewRating && (
            <button
              onClick={e => { e.stopPropagation(); onViewRating(); }}
              className="text-yellow-400 hover:text-yellow-200 p-1"
              title="查看评分"
            >
              <Star size={15} />
            </button>
          )}
          {isAdmin && onViewParticipants && (
            <button
              onClick={e => { e.stopPropagation(); onViewParticipants(); }}
              className="text-gray-400 hover:text-cyan-300 p-1"
              title="查看参与者"
            >
              <Users size={15} />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={e => { e.stopPropagation(); onEdit(); }}
              className="text-gray-400 hover:text-blue-300 p-1"
              title="编辑项目"
            >
              <Pencil size={15} />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="text-red-400 hover:text-red-300 p-1"
              title="删除项目"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {configured ? (
        stats === undefined ? (
          <div className="space-y-2">
            <div className="h-2 bg-gray-700 rounded-full animate-pulse" />
            <div className="h-3 bg-gray-700 rounded animate-pulse w-1/2" />
          </div>
        ) : stats === null ? (
          <p className="text-xs text-red-400">统计加载失败</p>
        ) : (
          <StatsSection project={project} stats={stats} />
        )
      ) : (
        <>
          {stats === undefined ? (
            <div className="h-3 bg-gray-700 rounded animate-pulse w-1/2" />
          ) : stats ? (
            <CostOnlySection project={project} stats={stats} />
          ) : null}
          <span className="text-xs text-gray-500 italic">未配置项目参数</span>
        </>
      )}

      <div className="flex justify-between items-center mt-auto pt-2 border-t border-gray-700">
        <span className="text-xs text-gray-500">{new Date(project.created_at).toLocaleDateString()}</span>
        <button onClick={onOpen} className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm">
          <FolderOpen size={16} />
          打开项目
        </button>
      </div>
    </div>
  );
}

function CostOnlySection({ project, stats }: { project: Project; stats: ProjectStats }) {
  const video_cost = stats.total_video_compute_units ?? (DEFAULT_VIDEO_COST_PER_SEC * stats.total_video_seconds);
  const total_cost = stats.total_compute_spent ?? (DEFAULT_IMAGE_COST * stats.total_images + video_cost);
  const image_cost = stats.total_compute_spent != null
    ? total_cost - video_cost
    : DEFAULT_IMAGE_COST * stats.total_images;
  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between text-gray-500">
        <span>图片 {stats.total_images}张: {Math.round(image_cost)}积分</span>
        <span>视频 {Math.round(stats.total_video_seconds)}秒: {Math.round(video_cost)}积分</span>
        <span className="font-mono">共 {Math.round(total_cost)}积分</span>
      </div>
      {project.budget_total != null && (() => {
        const spent = total_cost;
        const total = project.budget_total;
        const pct = Math.min(spent / total, 1);
        const isLocked = spent >= total;
        return (
          <div className="space-y-1">
            <div className="flex justify-between text-gray-400">
              <span>预算</span>
              <span className={isLocked ? 'text-red-400 font-semibold' : ''}>
                {Math.round(spent)} / {Math.round(total)}
                {isLocked && ' · 已锁定'}
              </span>
            </div>
            <div className="bg-gray-600 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${isLocked ? 'bg-red-500' : pct > 0.8 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                style={{ width: `${pct * 100}%` }}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
function StatsSection({ project, stats }: { project: Project; stats: ProjectStats }) {
  const m = computeMetrics(project, stats);

  return (
    <div className="space-y-2 text-xs">
      <div className="space-y-1">
        <div className="flex justify-between text-gray-400">
          <span>制作进度</span>
          <span>
            {m.episode_count}/{m.total_episodes}集 &nbsp;|&nbsp;
            完工 {(m.greenPct * 100).toFixed(1)}% &nbsp;|&nbsp;
            {m.completed_minutes.toFixed(1)}分钟
          </span>
        </div>
        <div className="bg-gray-600 rounded-full h-2 relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-yellow-500 rounded-full"
            style={{ width: `${m.yellowPct * 100}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 bg-green-500 rounded-full"
            style={{ width: `${m.greenBarPct * 100}%` }}
          />
        </div>
        <div className="flex gap-3 text-gray-500">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" />完工</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-yellow-500" />创建集</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-gray-600" />总</span>
        </div>
      </div>

      <div className="flex justify-between text-gray-500">
        <span>图片 {m.total_images}张: {Math.round(m.image_cost)}积分</span>
        <span>视频 {Math.round(m.total_video_seconds)}秒: {Math.round(m.video_cost)}积分</span>
        <span className={`font-mono ${m.costColor}`}>
          {m.cost_per_minute !== null ? `${Math.round(m.cost_per_minute)}积分/分钟` : '—'}
        </span>
      </div>

      {project.budget_total != null && (() => {
        const spent = m.image_cost + m.video_cost;
        const total = project.budget_total;
        const pct = Math.min(spent / total, 1);
        const isLocked = spent >= total;
        return (
          <div className="space-y-1">
            <div className="flex justify-between text-gray-400">
              <span>预算</span>
              <span className={isLocked ? 'text-red-400 font-semibold' : ''}>
                {Math.round(spent)} / {Math.round(total)}
                {isLocked && ' · 已锁定'}
              </span>
            </div>
            <div className="bg-gray-600 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${isLocked ? 'bg-red-500' : pct > 0.8 ? 'bg-yellow-500' : 'bg-blue-500'}`}
                style={{ width: `${pct * 100}%` }}
              />
            </div>
          </div>
        );
      })()}

      {(project.project_duration_days ?? 0) > 0 && (
        <div className="flex justify-between items-center text-gray-400">
          <span>项目健康</span>
          <span className={m.healthColor}>
            {m.healthLabel}（实际 {m.actual_ep}集 / 预期 {m.expected_ep}集）
          </span>
        </div>
      )}
    </div>
  );
}
