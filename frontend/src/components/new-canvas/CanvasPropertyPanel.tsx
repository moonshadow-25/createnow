import { Trash2 } from 'lucide-react';
import { useCreatenowModelConfigStore } from '@/store/createnowModelConfigStore';
import { CreatenowModelSelector, GenerationOptionSelector } from '@/components/common/GenerationSelectors';
import {
  getDefinition,
} from './nodeDefinitions';
import { DirectorStageEditor } from './DirectorStageEditor';
import { isVideoNode } from './canvasUtils';
import type { AssetAuditState, CanvasEdge, CanvasNode, NodeOutput, RefMedia } from './types';

type CanvasPropertyPanelProps = {
  projectId: string;
  selectedNode: CanvasNode | null;
  nodes: CanvasNode[];
  nodeError?: string;
  imageApiType: string;
  videoApiType: string;
  getIncomingEdges: (nodeId: string, targetPort?: string) => CanvasEdge[];
  moveInputEdge: (edgeId: string, direction: -1 | 1) => void;
  removeNode: (nodeId: string) => void;
  updateNodeLabel: (nodeId: string, label: string) => void;
  updateNodeConfig: (nodeId: string, config: Partial<CanvasNode['config']>) => void;
  renderNodePreview: (node: CanvasNode, compact?: boolean) => React.ReactNode;
  getInputAuditState: (nodeId: string) => Record<string, AssetAuditState>;
  getCanvasAuditState: () => Record<string, AssetAuditState>;
  onOpenAssetPicker: () => void;
  onOpenMaterialPicker: () => void;
  onOpenUpload: (target: 'image' | 'video' | 'audio') => void;
  toast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

type InputOrderItem = {
  edge: CanvasEdge;
  source?: CanvasNode;
  label: string;
  type: string;
  media?: RefMedia;
  text?: string;
};

function getNodeDisplayName(node?: CanvasNode) {
  if (!node) return '';
  return node.config.asset_name || node.config.file_name || node.label;
}

export function CanvasPropertyPanel({
  projectId,
  selectedNode,
  nodes,
  nodeError,
  imageApiType,
  videoApiType,
  getIncomingEdges,
  moveInputEdge,
  removeNode,
  updateNodeLabel,
  updateNodeConfig,
  renderNodePreview,
  getInputAuditState,
  getCanvasAuditState,
  onOpenAssetPicker,
  onOpenMaterialPicker,
  onOpenUpload,
  toast,
}: CanvasPropertyPanelProps) {
  const createnowModelConfig = useCreatenowModelConfigStore(state => state.config);

  const getSourceOutput = (source?: CanvasNode): NodeOutput | undefined => {
    if (!source) return undefined;
    if (source.config.last_result) return source.config.last_result;
    if (source.type === 'static.image') return {
      image_id: source.config.image_id,
      image_url: source.config.image_url,
      media: source.config.image_id ? [{
        type: 'image',
        id: source.config.image_id,
        url: source.config.image_url || '',
        name: getNodeDisplayName(source) || source.label,
        audit: source.config.existing_asset_audit_id ? {
          refType: 'image',
          refKey: source.config.image_id,
          assetId: source.config.existing_asset_audit_id,
          status: source.config.existing_asset_audit_status || 'Active',
        } : undefined,
      }] : [],
    };
    if (source.type === 'static.video') return { video_url: source.config.media_url };
    if (source.type === 'static.audio') return { audio_url: source.config.media_url };
    if (source.type === 'material.library' && source.config.material_snapshot) {
      return source.config.last_result as NodeOutput | undefined;
    }
    return undefined;
  };

  const projectOutputForPort = (output: NodeOutput | undefined, sourcePort?: string): NodeOutput | undefined => {
    if (!output) return undefined;
    if (sourcePort === 'image') return { image_id: output.image_id, image_url: output.image_url, media: (output.media || []).filter((item) => item.type === 'image') };
    if (sourcePort === 'text') return output.text ? { text: output.text } : {};
    if (sourcePort === 'video') return { video_id: output.video_id, video_url: output.video_url, media: (output.media || []).filter((item) => item.type === 'video') };
    if (sourcePort === 'audio') return { audio_url: output.audio_url, media: (output.media || []).filter((item) => item.type === 'audio') };
    return output;
  };

  const renderInputOrderPanel = (node: CanvasNode) => {
    const incoming = getIncomingEdges(node.node_id);
    if (!incoming.length) return null;
    const auditState = getInputAuditState(node.node_id);
    const canvasAuditState = getCanvasAuditState();
    const items: InputOrderItem[] = incoming.flatMap((edge) => {
      const source = nodes.find((item) => item.node_id === edge.source_node_id);
      const output = projectOutputForPort(getSourceOutput(source), edge.source_port);
      const media = (output?.media || []).filter((item) => item.type === edge.target_port && (item.id || item.url));
      const sourceLabel = getNodeDisplayName(source) || edge.source_node_id;
      if (media.length) return media.map((item, mediaIndex) => ({ edge, source, media: item, label: item.name || `${sourceLabel} #${mediaIndex + 1}`, type: item.type }));
      if (edge.target_port === 'text' && output?.text) return [{ edge, source, text: output.text, label: sourceLabel, type: 'text' }];
      return [{ edge, source, label: sourceLabel, type: edge.target_port }];
    });
    const markerByEdgeId = new Map((node.config.director_markers || []).map((marker) => [marker.edgeId, marker]));
    const markerBySource = new Map((node.config.director_markers || []).map((marker) => [`${marker.sourceNodeId}:${marker.sourcePort}`, marker]));
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
        <div className="mb-2 text-xs font-medium text-gray-300">输入顺序</div>
        <div className="space-y-2">
          {items.map((item, index) => {
            const imageKey = item.media?.type === 'image' && item.media.id ? `image:${item.media.id}` : '';
            const videoKey = item.media?.type === 'video' ? `video:${item.media.url}` : '';
            const audit = item.media?.audit
              || (imageKey ? item.source?.config.audit_state?.[imageKey] || auditState[imageKey] || canvasAuditState[imageKey] : undefined)
              || (videoKey ? item.source?.config.audit_state?.[videoKey] || auditState[videoKey] || canvasAuditState[videoKey] : undefined);
            const hasAuditableInput = Boolean(imageKey || videoKey);
            const status = audit?.status || (audit?.assetId ? 'Processing' : hasAuditableInput ? 'Pending' : undefined);
            const marker = markerByEdgeId.get(item.edge.edge_id) || markerBySource.get(`${item.edge.source_node_id}:${item.edge.source_port}`);
            return (
              <div key={`${item.edge.edge_id}-${index}`} className="flex items-center gap-2 rounded bg-gray-900 p-2 text-xs">
                {marker ? (
                  <div className="flex flex-shrink-0 items-center gap-1 rounded-full bg-gray-950 px-2 py-1 ring-1 ring-gray-700">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: marker.color }} />
                    <span className="text-[10px] font-medium text-gray-100">{marker.label}</span>
                  </div>
                ) : (
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-700 text-[10px] text-white">{index + 1}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-gray-200">{item.label}</div>
                  <div className="text-[10px] text-gray-500">{item.type} · {item.edge.target_port} ← {item.edge.source_port}</div>
                  {marker && <div className="mt-1 text-[10px] text-gray-400">{marker.colorName}火柴人 · {marker.sourceLabel}</div>}
                  {status && (
                    <div className={status === 'Active' ? 'mt-1 text-[10px] text-green-300' : status === 'Failed' ? 'mt-1 text-[10px] text-red-300' : 'mt-1 text-[10px] text-yellow-300'}>
                      {status === 'Active' ? '审核通过' : status === 'Failed' ? '审核失败' : status === 'Pending' ? '待提交审核' : '审核中'}
                    </div>
                  )}
                </div>
                <button onClick={() => moveInputEdge(item.edge.edge_id, -1)} disabled={index === 0} className="rounded bg-gray-800 px-2 py-1 text-[10px] disabled:opacity-30">上</button>
                <button onClick={() => moveInputEdge(item.edge.edge_id, 1)} disabled={index === items.length - 1} className="rounded bg-gray-800 px-2 py-1 text-[10px] disabled:opacity-30">下</button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (!selectedNode) {
    return <div className="p-4 text-sm text-gray-400">选择一个节点后编辑参数。</div>;
  }
  const definition = getDefinition(selectedNode.type);
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm text-gray-400">节点设置</div>
          <input
            value={selectedNode.label}
            onChange={(event) => updateNodeLabel(selectedNode.node_id, event.target.value)}
            className="mt-1 w-full rounded bg-gray-900 px-3 py-2 text-sm text-white outline-none ring-1 ring-gray-700 focus:ring-blue-500"
          />
        </div>
        <button onClick={() => removeNode(selectedNode.node_id)} className="rounded-lg bg-red-600/20 p-2 text-red-300 hover:bg-red-600/30" title="删除节点">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="rounded-lg bg-gray-900 p-3 text-xs text-gray-400">{definition.description}</div>

      {renderInputOrderPanel(selectedNode)}

      {selectedNode.type === 'director.stage' && (
        <DirectorStageEditor
          projectId={projectId}
          node={selectedNode}
          nodes={nodes}
          incomingEdges={getIncomingEdges(selectedNode.node_id, 'image')}
          updateNodeConfig={updateNodeConfig}
          onOpenAssetPicker={onOpenAssetPicker}
          onOpenUpload={onOpenUpload}
          toast={toast}
        />
      )}

      {(selectedNode.type === 'static.image' || selectedNode.type === 'static.video' || selectedNode.type === 'static.audio') && (
        <div className="space-y-2">
          {selectedNode.type === 'static.image' && (
            <>
              <button onClick={onOpenAssetPicker} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm hover:bg-blue-500">选择项目资产</button>
              <button onClick={() => onOpenUpload('image')} className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600">上传本地图片</button>
            </>
          )}
          {selectedNode.type === 'static.video' && <button onClick={() => onOpenUpload('video')} className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600">上传本地视频</button>}
          {selectedNode.type === 'static.audio' && <button onClick={() => onOpenUpload('audio')} className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600">上传本地音频</button>}
          <div className="text-xs text-gray-500">{selectedNode.config.asset_name || selectedNode.config.file_name || '未选择资源'}</div>
          {selectedNode.config.existing_asset_audit_id && (
            <div className="rounded bg-gray-950 p-2 text-xs text-green-300">
              已有审核资产：{selectedNode.config.existing_asset_audit_status || 'Active'}
              <div className="mt-1 truncate text-[10px] text-gray-500">{selectedNode.config.existing_asset_audit_id}</div>
            </div>
          )}
        </div>
      )}

      {selectedNode.type === 'material.library' && (
        <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-950 p-3">
          <div className="space-y-2">
            <button onClick={onOpenMaterialPicker} className="w-full rounded-lg bg-purple-600 px-3 py-2 text-sm hover:bg-purple-500">选择lora</button>
            <label className="block">
              <span className="text-xs text-gray-400">补充提示词</span>
              <textarea
                value={selectedNode.config.prompt || ''}
                onChange={(event) => updateNodeConfig(selectedNode.node_id, { prompt: event.target.value })}
                rows={4}
                className="mt-1 w-full rounded bg-gray-900 px-3 py-2 text-sm text-white outline-none ring-1 ring-gray-700 focus:ring-blue-500"
                placeholder="可额外补充提示词"
              />
            </label>
          </div>
          <div className="text-xs text-gray-400">素材名称：{selectedNode.config.material_name || '未选择'}</div>
        </div>
      )}

      {(selectedNode.type === 'gen.llm' || selectedNode.type.startsWith('gen.')) && (
        <label className="block">
          <span className="text-xs text-gray-400">提示词</span>
          <textarea
            value={selectedNode.config.prompt || ''}
            onChange={(event) => updateNodeConfig(selectedNode.node_id, { prompt: event.target.value })}
            rows={15}
            placeholder="可使用 {{input}} 引用上游文本"
            className="mt-1 w-full rounded bg-gray-900 px-3 py-2 text-sm text-white outline-none ring-1 ring-gray-700 focus:ring-blue-500"
          />
        </label>
      )}

      {(selectedNode.type === 'gen.image' || selectedNode.type === 'gen.image_edit') && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs text-gray-400">图片比例</span>
            <div className="mt-1">
              <GenerationOptionSelector
                kind="imageSize"
                value={selectedNode.config.size || '16x9'}
                onChange={(value) => updateNodeConfig(selectedNode.node_id, { size: value })}
              />
            </div>
          </label>
          {imageApiType === 'createnow' && (
            <label className="block">
              <span className="text-xs text-gray-400">模型</span>
              <div className="mt-1">
                <CreatenowModelSelector
                  type="image"
                  value={selectedNode.config.model || createnowModelConfig.default_models.image || ''}
                  suggestions={createnowModelConfig.suggestions.image || []}
                  onChange={(value) => updateNodeConfig(selectedNode.node_id, { model: value })}
                  className="w-full"
                />
              </div>
            </label>
          )}
        </div>
      )}

      {isVideoNode(selectedNode.type) && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-xs text-gray-400">时长</span>
              <input
                type="number"
                min={1}
                max={30}
                value={selectedNode.config.duration || 6}
                onChange={(event) => updateNodeConfig(selectedNode.node_id, { duration: Number(event.target.value) || 6 })}
                className="mt-1 w-full rounded bg-gray-900 px-2 py-2 text-sm outline-none ring-1 ring-gray-700"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">清晰度</span>
              <div className="mt-1">
                <GenerationOptionSelector
                  kind="videoResolution"
                  value={selectedNode.config.resolution || '720p'}
                  onChange={(value) => updateNodeConfig(selectedNode.node_id, { resolution: value })}
                />
              </div>
            </label>
            <label className="block">
              <span className="text-xs text-gray-400">比例</span>
              <div className="mt-1">
                <GenerationOptionSelector
                  kind="videoRatio"
                  value={selectedNode.config.ratio || '16:9'}
                  onChange={(value) => updateNodeConfig(selectedNode.node_id, { ratio: value })}
                />
              </div>
            </label>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            {videoApiType === 'createnow' ? (
              <label className="block">
                <span className="text-xs text-gray-400">模型</span>
                <div className="mt-1">
                  <CreatenowModelSelector
                    type="video"
                    value={selectedNode.config.model || createnowModelConfig.default_models.video || ''}
                    suggestions={createnowModelConfig.suggestions.video || []}
                    onChange={(value) => updateNodeConfig(selectedNode.node_id, { model: value })}
                    className="w-full"
                  />
                </div>
              </label>
            ) : <div />}
            <label className="flex h-9 items-center gap-2 rounded bg-gray-900 px-2 text-xs text-gray-300 ring-1 ring-gray-700">
              <input
                type="checkbox"
                checked={selectedNode.config.generate_audio !== false}
                onChange={(event) => updateNodeConfig(selectedNode.node_id, { generate_audio: event.target.checked })}
              />
              音频
            </label>
          </div>
        </div>
      )}

      {selectedNode.type !== 'director.stage' && (
        <div>
          <div className="mb-2 text-xs text-gray-400">最近结果</div>
          {renderNodePreview(selectedNode, true)}
          {nodeError && <div className="mt-2 text-xs text-red-300">{nodeError}</div>}
        </div>
      )}
    </div>
  );
}
