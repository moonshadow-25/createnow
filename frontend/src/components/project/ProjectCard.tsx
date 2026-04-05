import { FolderOpen, Trash2, Pencil, Lock } from 'lucide-react';
import { Project } from '@/types';

interface ProjectStats {
  episode_count: number;
  total_storyboards: number;
  storyboards_with_image: number;
  storyboards_with_video: number;
  total_images: number;
  total_video_seconds: number;
  storyboard_video_seconds: number;
}

interface Props {
  project: Project;
  stats: ProjectStats | null | undefined;
  isAdmin: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onEdit: () => void;
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

  // Progress
  const yellowPct = total_episodes > 0 ? Math.min(episode_count / total_episodes, 1) : 0;
  const storyboards_with_image_only = storyboards_with_image - storyboards_with_video;
  const greenPct =
    total_storyboards > 0
      ? Math.min(
          (storyboards_with_image_only * 0.5 + storyboards_with_video * 1.0) / total_storyboards,
          1
        )
      : 0;

  // Cost — completed_episodes 基于"已创建集数×完工率"，而非总集数
  const image_cost = 0.4 * total_images;
  const video_cost = 1 * total_video_seconds;
  const completed_episodes = greenPct * episode_count;
  // 绿条宽度相对于 total_episodes，确保 greenBar ≤ yellowBar
  const greenBarPct = total_episodes > 0 ? completed_episodes / total_episodes : 0;
  // cost_per_minute 只统计分镜正片视频，排除广场实验性生成
  let cost_per_minute: number | null = null;
  if (completed_episodes > 0 && minutes_per_episode > 0) {
    const storyboard_video_cost = 1 * storyboard_video_seconds;
    cost_per_minute = (image_cost + storyboard_video_cost) / (completed_episodes * minutes_per_episode);
  }

  let costColor = 'text-gray-400';
  if (cost_per_minute !== null && compute_budget_per_minute > 0) {
    const ratio = cost_per_minute / compute_budget_per_minute;
    if (ratio < 0.95) costColor = 'text-green-400';
    else if (ratio <= 1.05) costColor = 'text-yellow-400';
    else costColor = 'text-red-400';
  }

  // Health
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

  // actual_ep 与 completed_episodes 保持一致，都基于 episode_count
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

export function ProjectCard({ project, stats, isAdmin, onOpen, onDelete, onEdit }: Props) {
  const configured = (project.total_episodes ?? 0) > 0;

  return (
    <div className="bg-gray-800 rounded-lg p-6 flex flex-col gap-3">
      {/* Header */}
      <div className="flex justify-between items-start">
        <h3 className="text-xl font-semibold flex-1 mr-2 truncate">{project.name}</h3>
        <div className="flex items-center gap-1 flex-shrink-0">
          {project.budget_total != null && stats &&
            (0.4 * stats.total_images + 1.0 * stats.total_video_seconds) >= project.budget_total && (
            <span title="预算已超出，API已锁定" className="text-red-400">
              <Lock size={14} />
            </span>
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

      {/* Stats section */}
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

      {/* Footer */}
      <div className="flex justify-between items-center mt-auto pt-2 border-t border-gray-700">
        <span className="text-xs text-gray-500">
          {new Date(project.created_at).toLocaleDateString()}
        </span>
        <button
          onClick={onOpen}
          className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm"
        >
          <FolderOpen size={16} />
          打开项目
        </button>
      </div>
    </div>
  );
}

function CostOnlySection({ project, stats }: { project: Project; stats: ProjectStats }) {
  const image_cost = 0.4 * stats.total_images;
  const video_cost = 1 * stats.total_video_seconds;
  const total_cost = image_cost + video_cost;
  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between text-gray-500">
        <span>图片 {stats.total_images}张: {Math.round(image_cost)}元</span>
        <span>视频 {Math.round(stats.total_video_seconds)}秒: {Math.round(video_cost)}元</span>
        <span className="font-mono">共 {total_cost.toFixed(2)}元</span>
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
                {spent.toFixed(2)} / {total.toFixed(2)}
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
      {/* Progress */}
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

      {/* Cost */}
      <div className="flex justify-between text-gray-500">
        <span>图片 {m.total_images}张: {Math.round(m.image_cost)}元</span>
        <span>视频 {Math.round(m.total_video_seconds)}秒: {Math.round(m.video_cost)}元</span>
        <span className={`font-mono ${m.costColor}`}>
          {m.cost_per_minute !== null ? `${Math.round(m.cost_per_minute)}元/分钟` : '—'}
        </span>
      </div>

      {/* Budget */}
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
                {spent.toFixed(2)} / {total.toFixed(2)}
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

      {/* Health */}
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
