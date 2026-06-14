import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RotateCcw, Save, Upload } from 'lucide-react';
import { generationApi } from '@/services/api';
import { getImageUrlFromRecord } from './canvasUtils';
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

type DragState = {
  markerId: string;
  rect: DOMRect;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [saving, setSaving] = useState(false);
  const sceneUrl = node.config.image_url || '';
  const markers = useMemo(() => node.config.director_markers || [], [node.config.director_markers]);

  useEffect(() => {
    const synced = syncDirectorStageMarkers({ incomingEdges, nodes, currentMarkers: markers });
    const changed = JSON.stringify(synced) !== JSON.stringify(markers);
    if (changed) updateNodeConfig(node.node_id, { director_markers: synced });
  }, [incomingEdges, markers, node.node_id, nodes, updateNodeConfig]);

  useEffect(() => {
    if (!dragState) return;
    const handlePointerMove = (event: PointerEvent) => {
      const x = clamp((event.clientX - dragState.rect.left) / dragState.rect.width, 0, 1);
      const y = clamp((event.clientY - dragState.rect.top) / dragState.rect.height, 0, 1);
      updateMarker(dragState.markerId, { x, y });
    };
    const handlePointerUp = () => setDragState(null);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragState]);

  const updateMarker = (markerId: string, patch: Partial<DirectorStageMarker>) => {
    updateNodeConfig(node.node_id, {
      director_markers: markers.map((marker) => marker.id === markerId ? { ...marker, ...patch } : marker),
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
            <div className="text-[10px] text-gray-500">上传或选择一张场景图，分辨率会作为合成图尺寸</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onOpenAssetPicker} className="rounded bg-blue-600 px-2 py-1 text-xs hover:bg-blue-500">选择资产</button>
            <button type="button" onClick={() => onOpenUpload('image')} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600"><Upload size={12} /></button>
          </div>
        </div>
        <div ref={stageRef} className="relative aspect-video overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
          {sceneUrl ? (
            <img src={sceneUrl} alt="导演台场景图" draggable={false} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-gray-500">未选择场景图</div>
          )}
          {sceneUrl && markers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = stageRef.current?.getBoundingClientRect();
                if (rect) setDragState({ markerId: marker.id, rect });
              }}
              className="absolute flex h-20 w-16 -translate-x-1/2 -translate-y-1/2 cursor-grab flex-col items-center justify-center border-2 border-white/60 bg-black/20 text-[10px] font-bold text-white shadow-xl active:cursor-grabbing"
              style={{
                left: `${marker.x * 100}%`,
                top: `${marker.y * 100}%`,
                transform: `translate(-50%, -50%) rotate(${marker.rotation}deg) scale(${marker.scale})`,
                borderRadius: '999px 999px 18px 18px',
                background: `linear-gradient(145deg, ${marker.color}, #111827)`,
              }}
              title={`${marker.label} · ${marker.colorName}`}
            >
              <span className="mb-1 h-5 w-5 rounded-full bg-white/90" />
              <span>{marker.label}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500">
          <span>{markers.length ? `${markers.length} 个输入标记` : '连接图片后会自动创建小人标记'}</span>
          {node.config.director_composite_image_url && <span className="text-green-300">已保存位置</span>}
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
        <div className="mb-2 text-xs font-medium text-gray-300">小人标记</div>
        <div className="space-y-3">
          {markers.map((marker) => (
            <div key={marker.id} className="rounded bg-gray-900 p-2">
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: marker.color }} />
                <span className="font-medium text-gray-200">{marker.label}</span>
                <span className="min-w-0 flex-1 truncate text-gray-500">{marker.sourceLabel}</span>
                <span className="text-[10px] text-gray-400">{marker.colorName}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-400">
                <label>
                  缩放
                  <input type="range" min="0.45" max="1.65" step="0.05" value={marker.scale} onChange={(event) => updateMarker(marker.id, { scale: Number(event.target.value) })} className="w-full" />
                </label>
                <label>
                  旋转
                  <input type="range" min="-180" max="180" step="1" value={marker.rotation} onChange={(event) => updateMarker(marker.id, { rotation: Number(event.target.value) })} className="w-full" />
                </label>
              </div>
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
