import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Episode, Storyboard } from '@/types';
import { generationApi } from '@/services/api';
import { DEFAULT_IMAGE_COST, DEFAULT_VIDEO_COST_PER_SEC } from '@/constants/pricing';

interface AssetLike {
  asset_id: string;
  name?: string;
}

interface ImageRecord {
  image_id: string;
  asset_id: string;
  asset_type?: string;
  generation_scope?: string;
  model?: string;
  actual_cost?: number;
  credits_consumed?: number;
  created_by?: string;
}

interface VideoRecord {
  video_id: string;
  storyboard_id?: string;
  episode_id?: string;
  duration?: number;
  actual_cost?: number;
  credits_consumed?: number;
  estimated_cost?: number;
  created_by?: string;
  status?: string;
}

interface CostRow {
  key: string;
  label: string;
  sort: number;
  image_cost: number;
  video_cost: number;
  total_cost: number;
  count: number;
  users: Set<string>;
  byUser: Map<string, { image_cost: number; video_cost: number; total_cost: number; count: number }>;
}

interface ProjectCostDashboardProps {
  projectId: string;
  episodes: Episode[];
  storyboards: Storyboard[];
  characters: AssetLike[];
  scenes: AssetLike[];
  props: AssetLike[];
  onClose: () => void;
}

const fmt = (n: number) => (n / 10000).toFixed(2) + '万积分';
const userKey = (value?: string) => (value || '').trim() || '__unknown__';
const userLabel = (value: string) => value === '__unknown__' ? '未知用户' : value;
const isZeroCostImageModel = (model?: string) => ['manual_upload', 'split'].includes(model || '');
const imageCost = (record: ImageRecord) => {
  if (isZeroCostImageModel(record.model)) return 0;
  return Number(record.actual_cost ?? record.credits_consumed ?? DEFAULT_IMAGE_COST) || 0;
};
const videoCost = (record: VideoRecord) => Number(
  record.actual_cost ?? record.credits_consumed ?? record.estimated_cost ?? ((record.duration || 0) * DEFAULT_VIDEO_COST_PER_SEC)
) || 0;

export function ProjectCostDashboard({ projectId, episodes, storyboards, characters, scenes, props, onClose }: ProjectCostDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<CostRow[]>([]);
  const [selectedUser, setSelectedUser] = useState('__all__');

  const episodeById = useMemo(() => new Map(episodes.map((episode: any) => [episode.episode_id || episode.asset_id, episode])), [episodes]);
  const storyboardById = useMemo(() => new Map(storyboards.map((storyboard) => [storyboard.asset_id, storyboard])), [storyboards]);

  useEffect(() => {
    let cancelled = false;

    const emptyRow = (key: string, label: string, sort: number): CostRow => ({
      key,
      label,
      sort,
      image_cost: 0,
      video_cost: 0,
      total_cost: 0,
      count: 0,
      users: new Set<string>(),
      byUser: new Map(),
    });

    const add = (map: Map<string, CostRow>, key: string, label: string, sort: number, kind: 'image' | 'video', cost: number, user: string) => {
      const row = map.get(key) || emptyRow(key, label, sort);
      if (kind === 'image') row.image_cost += cost;
      else row.video_cost += cost;
      row.total_cost += cost;
      row.count += 1;
      row.users.add(user);
      const userCosts = row.byUser.get(user) || { image_cost: 0, video_cost: 0, total_cost: 0, count: 0 };
      if (kind === 'image') userCosts.image_cost += cost;
      else userCosts.video_cost += cost;
      userCosts.total_cost += cost;
      userCosts.count += 1;
      row.byUser.set(user, userCosts);
      map.set(key, row);
    };

    const classifyImage = (record: ImageRecord) => {
      if (record.generation_scope === 'square_generate' || record.asset_type === 'generate' || record.asset_id === 'square-generate') {
        return { key: 'square', label: '广场生成', sort: 9000 };
      }
      if (['character', 'scene', 'prop'].includes(record.asset_type || '')) {
        const label = record.asset_type === 'character' ? '资产生成 · 角色'
          : record.asset_type === 'scene' ? '资产生成 · 场景'
          : '资产生成 · 道具';
        return { key: `asset:${record.asset_type}`, label, sort: 9100 };
      }
      const storyboard = storyboardById.get(record.asset_id);
      if (storyboard) {
        const episode = episodeById.get(storyboard.episode_id) as any;
        const num = episode?.episode_number ?? episode?.name ?? '';
        return { key: `episode:${storyboard.episode_id}`, label: num ? `第${num}集` : '未命名剧集', sort: Number(episode?.episode_number || 0) || 0 };
      }
      return { key: 'other', label: '其他生成', sort: 9900 };
    };

    const classifyVideo = (record: VideoRecord) => {
      const storyboard = record.storyboard_id ? storyboardById.get(record.storyboard_id) : null;
      const episodeId = record.episode_id || storyboard?.episode_id;
      if (episodeId) {
        const episode = episodeById.get(episodeId) as any;
        if (episode) {
          const num = episode.episode_number ?? episode.name ?? '';
          return { key: `episode:${episodeId}`, label: num ? `第${num}集` : '未命名剧集', sort: Number(episode.episode_number || 0) || 0 };
        }
        return { key: 'deleted-episode', label: '已删除集/失联分镜', sort: 9800 };
      }
      if (record.storyboard_id) {
        return { key: 'deleted-episode', label: '已删除集/失联分镜', sort: 9800 };
      }
      return { key: 'square', label: '广场生成', sort: 9000 };
    };

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const rowMap = new Map<string, CostRow>();
        const assetIds = [
          ...storyboards.map(s => s.asset_id),
          ...characters.map(a => a.asset_id),
          ...scenes.map(a => a.asset_id),
          ...props.map(a => a.asset_id),
        ].filter(Boolean);

        const [libraryImagesRes, allVideosRes, assetImagesRes] = await Promise.all([
          generationApi.listLibraryImages(projectId),
          generationApi.listVideos(projectId),
          generationApi.listImagesBatch(projectId, assetIds),
        ]);

        const images: ImageRecord[] = [
          ...(libraryImagesRes.data || []),
          ...(assetImagesRes.data?.images || []),
        ];
        const seenImages = new Set<string>();
        images.forEach((record) => {
          if (!record?.image_id || seenImages.has(record.image_id)) return;
          seenImages.add(record.image_id);
          const cost = imageCost(record);
          if (cost <= 0) return;
          const cls = classifyImage(record);
          add(rowMap, cls.key, cls.label, cls.sort, 'image', cost, userKey(record.created_by));
        });

        const videos: VideoRecord[] = allVideosRes.data || [];
        const seenVideos = new Set<string>();
        videos.forEach((record) => {
          if (!record?.video_id || seenVideos.has(record.video_id)) return;
          seenVideos.add(record.video_id);
          const cost = videoCost(record);
          if (cost <= 0) return;
          const cls = classifyVideo(record);
          add(rowMap, cls.key, cls.label, cls.sort, 'video', cost, userKey(record.created_by));
        });

        // 没有生成记录的剧集不强制显示，避免看板噪音；有消耗的剧集按 episode_number 排序。
        if (!cancelled) setRows(Array.from(rowMap.values()).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, 'zh')));
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.detail || err?.message || '加载消耗数据失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [projectId, storyboards, characters, scenes, props, episodeById, storyboardById]);

  const userOptions = useMemo(() => {
    const users = new Set<string>();
    rows.forEach(row => row.users.forEach(user => users.add(user)));
    return Array.from(users).sort((a, b) => {
      if (a === '__unknown__') return 1;
      if (b === '__unknown__') return -1;
      return a.localeCompare(b, 'zh');
    });
  }, [rows]);

  const filteredRows = selectedUser === '__all__'
    ? rows
    : rows
      .map(row => {
        const costs = row.byUser.get(selectedUser);
        if (!costs) return null;
        return {
          ...row,
          image_cost: costs.image_cost,
          video_cost: costs.video_cost,
          total_cost: costs.total_cost,
          count: costs.count,
          users: new Set([selectedUser]),
        };
      })
      .filter((row): row is CostRow => !!row);
  const totals = filteredRows.reduce((acc, row) => ({
    image_cost: acc.image_cost + row.image_cost,
    video_cost: acc.video_cost + row.video_cost,
    total_cost: acc.total_cost + row.total_cost,
  }), { image_cost: 0, video_cost: 0, total_cost: 0 });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-[1080px] max-h-[88vh] overflow-hidden flex flex-col text-white">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div>
            <h2 className="text-lg font-semibold">项目消耗看板</h2>
            <div className="text-xs text-gray-400 mt-1">按实际生成记录汇总，不包含项目均摊</div>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedUser}
              onChange={e => setSelectedUser(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="__all__">全部用户</option>
              {userOptions.map(user => <option key={user} value={user}>{userLabel(user)}</option>)}
            </select>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition" title="关闭">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-auto space-y-5">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-700 rounded-lg p-4 text-center"><div className="text-xl font-bold">{filteredRows.length}</div><div className="text-xs text-gray-400 mt-1">分类</div></div>
            <div className="bg-gray-700 rounded-lg p-4 text-center"><div className="text-xl font-bold text-blue-400">{fmt(totals.image_cost)}</div><div className="text-xs text-gray-400 mt-1">图片费用</div></div>
            <div className="bg-gray-700 rounded-lg p-4 text-center"><div className="text-xl font-bold text-green-400">{fmt(totals.video_cost)}</div><div className="text-xs text-gray-400 mt-1">视频费用</div></div>
            <div className="bg-gray-700 rounded-lg p-4 text-center"><div className="text-xl font-bold text-white">{fmt(totals.total_cost)}</div><div className="text-xs text-gray-400 mt-1">合计</div></div>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 py-16 flex items-center justify-center gap-2"><Loader2 className="animate-spin" />加载消耗数据...</div>
          ) : error ? (
            <div className="text-center text-red-400 py-16">{error}</div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center text-gray-400 py-16">暂无消耗数据</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 pr-4">分类</th>
                  <th className="text-right py-2 pr-4">图片费用</th>
                  <th className="text-right py-2 pr-4">视频费用</th>
                  <th className="text-right py-2 pr-4">记录数</th>
                  <th className="text-left py-2 pr-4">参与用户</th>
                  <th className="text-right py-2">合计</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <tr key={row.key} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2 pr-4">{row.label}</td>
                    <td className="text-right py-2 pr-4 text-blue-400">{fmt(row.image_cost)}</td>
                    <td className="text-right py-2 pr-4 text-green-400">{fmt(row.video_cost)}</td>
                    <td className="text-right py-2 pr-4 text-gray-300">{row.count}</td>
                    <td className="py-2 pr-4 text-gray-300">{Array.from(row.users).map(userLabel).join('、')}</td>
                    <td className="text-right py-2 font-medium">{fmt(row.total_cost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-gray-300 font-semibold">
                  <td className="py-2 pr-4">合计</td>
                  <td className="text-right py-2 pr-4 text-blue-400">{fmt(totals.image_cost)}</td>
                  <td className="text-right py-2 pr-4 text-green-400">{fmt(totals.video_cost)}</td>
                  <td />
                  <td />
                  <td className="text-right py-2">{fmt(totals.total_cost)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
