import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Save, Upload } from 'lucide-react';
import { generationApi } from '@/services/api';
import { getImageUrlFromRecord } from './canvasUtils';
import { StickFigureOverlay } from './StickFigureOverlay';
import {
  buildDirectorStagePrompt,
  renderDirectorStageComposite,
  syncDirectorStageMarkers,
  type DirectorStageMarker,
} from './directorStageUtils';
import type { CanvasEdge, CanvasNode } from './types';

type DirectorStageEditorProps = {
  projectId: string;
  node: CanvasNode;
  nodes: CanvasNode[];
  incomingEdges: CanvasEdge[];
  imageApiType: string;
  updateNodeConfig: (nodeId: string, config: Partial<CanvasNode['config']>) => void;
  onOpenAssetPicker: () => void;
  onOpenUpload: (target: 'image' | 'video' | 'audio') => void;
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

export function DirectorStageEditor({
  projectId,
  node,
  nodes,
  incomingEdges,
  imageApiType,
  updateNodeConfig,
  onOpenAssetPicker,
  onOpenUpload,
  toast,
}: DirectorStageEditorProps) {
  const [saving, setSaving] = useState(false);
  const sceneUrl = node.config.image_url || '';
  const markers = useMemo(() => node.config.director_markers || [], [node.config.director_markers]);

  useEffect(() => {
    const synced = syncDirectorStageMarkers({ incomingEdges, nodes, currentMarkers: markers });
    const changed = JSON.stringify(synced) !== JSON.stringify(markers);
    if (changed) updateNodeConfig(node.node_id, { director_markers: synced });
  }, [incomingEdges, markers, node.node_id, nodes, updateNodeConfig]);

  const updateMarkers = (nextMarkers: DirectorStageMarker[]) => {
    updateNodeConfig(node.node_id, {
      director_markers: nextMarkers,
      director_composite_image_id: undefined,
      director_composite_image_url: undefined,
    });
  };

  const handlePromptChange = (prompt: string) => {
    updateNodeConfig(node.node_id, { prompt, director_prompt_edited: true });
  };

  const regeneratePrompt = () => {
    updateNodeConfig(node.node_id, {
      prompt: buildDirectorStagePrompt(markers),
      director_prompt_edited: false,
    });
  };

  const savePosition = async () => {
    if (!sceneUrl) {
      toast('请先选择或上传场景图', 'error');
      return;
    }
    if (!markers.length) {
      toast('请先连接至少一张输入图片', 'error');
      return;
    }
    setSaving(true);
    try {
      const blob = await renderDirectorStageComposite(sceneUrl, markers);
      const file = new File([blob], `director-stage-${node.node_id}.png`, { type: 'image/png' });
      const response = await generationApi.uploadImage(projectId, {
        asset_id: 'canvas-generate',
        asset_type: 'generate',
        file,
        prompt: '导演台合成位置图',
      });
      const record = response.data;
      const compositeUrl = getImageUrlFromRecord(projectId, record);
      const nextPrompt = node.config.director_prompt_edited && node.config.prompt
        ? node.config.prompt
        : buildDirectorStagePrompt(markers);
      updateNodeConfig(node.node_id, {
        director_composite_image_id: record.image_id,
        director_composite_image_url: compositeUrl,
        prompt: nextPrompt,
        director_prompt_edited: Boolean(node.config.director_prompt_edited && node.config.prompt),
      });
      toast('导演台位置已保存', 'success');
    } catch (error: any) {
      toast(error?.message || '保存位置失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium text-gray-300">场景图</div>
            <div className="text-[10px] text-gray-500">拖拽头部或身体移动整体，拖拽手脚调整姿势</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onOpenAssetPicker} className="rounded bg-blue-600 px-2 py-1 text-xs hover:bg-blue-500">选择资产</button>
            <button type="button" onClick={() => onOpenUpload('image')} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600"><Upload size={12} /></button>
          </div>
        </div>
        <div className="relative aspect-video overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
          {sceneUrl ? (
            <img src={sceneUrl} alt="导演台场景图" draggable={false} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-gray-500">未选择场景图</div>
          )}
          {sceneUrl && <StickFigureOverlay markers={markers} editable onMarkersChange={updateMarkers} />}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500">
          <span>{markers.length ? `${markers.length} 个火柴人标记` : '连接图片后会自动创建火柴人标记'}</span>
          {node.config.director_composite_image_url && <span className="text-green-300">已保存位置</span>}
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
        <div className="mb-2 text-xs font-medium text-gray-300">输入绑定</div>
        <div className="space-y-2">
          {markers.map((marker) => (
            <div key={marker.id} className="flex items-center gap-2 rounded bg-gray-900 p-2 text-xs">
              <span className="h-4 w-4 rounded-full" style={{ backgroundColor: marker.color }} />
              <span className="font-medium text-gray-200">{marker.label}</span>
              <span className="min-w-0 flex-1 truncate text-gray-500">{marker.sourceLabel}</span>
              <span className="text-[10px] text-gray-400">{marker.colorName}</span>
            </div>
          ))}
          {!markers.length && <div className="rounded bg-gray-900 p-3 text-xs text-gray-500">暂无输入图片，请从其他图片节点连线到导演台。</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={savePosition} disabled={saving} className="flex items-center justify-center gap-2 rounded-lg bg-green-700 px-3 py-2 text-sm hover:bg-green-600 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}保存位置
        </button>
        <button type="button" onClick={regeneratePrompt} className="flex items-center justify-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600">
          <RotateCcw size={14} />重生成提示词
        </button>
      </div>

      <label className="block">
        <span className="text-xs text-gray-400">导演台提示词</span>
        <textarea
          value={node.config.prompt || ''}
          onChange={(event) => handlePromptChange(event.target.value)}
          rows={8}
          placeholder="点击保存位置后自动生成，可手动编辑"
          className="mt-1 w-full rounded bg-gray-900 px-3 py-2 text-sm text-white outline-none ring-1 ring-gray-700 focus:ring-blue-500"
        />
      </label>

      {imageApiType === 'createnow' && (
        <label className="block">
          <span className="text-xs text-gray-400">模型</span>
          <input
            value={node.config.model || ''}
            onChange={(event) => updateNodeConfig(node.node_id, { model: event.target.value })}
            className="mt-1 w-full rounded bg-gray-900 px-2 py-2 text-sm outline-none ring-1 ring-gray-700"
            placeholder="默认配置"
          />
        </label>
      )}
    </div>
  );
}
