import { Trash2, Loader2, Sparkles, Play, ShieldCheck, XCircle, RefreshCcw, Plus, Link2, Unlink } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useCanvasStore } from '@/store/canvasStore';
import { useAssetStore } from '@/store/assetStore';
import { useToast } from '@/components/common/Toast';
import { CanvasFusionPanel } from './CanvasFusionPanel';
import { canvasApi } from '@/services/api';
import type { WorkflowNode, WorkflowRunStatus } from '@/types/canvas';

type CanvasViewMode = 'asset' | 'workflow';

interface CanvasPropertyPanelProps {
  projectId: string;
  mode?: CanvasViewMode;
}

const NODE_TYPE_OPTIONS = [
  { value: 'trigger.manual', label: '手动触发' },
  { value: 'input.asset', label: '输入资产' },
  { value: 'prompt.compose', label: '提示词组装' },
  { value: 'gen.llm', label: 'LLM 文本生成' },
  { value: 'analysis.vlm', label: 'VLM 图片分析' },
  { value: 'gen.image', label: '文生图' },
  { value: 'gen.fusion_image', label: '融合生图' },
  { value: 'gen.video', label: '视频生成' },
  { value: 'output.save_asset', label: '输出保存' },
];

const RUN_STATUS_LABEL: Record<WorkflowRunStatus, string> = {
  created: '已创建',
  validating: '校验中',
  running: '运行中',
  canceling: '取消中',
  succeeded: '成功',
  failed: '失败',
  canceled: '已取消',
  partial_failed: '部分失败',
};

// ---- 图片选择器（节点内联） ----
interface NodeImagePickerProps {
  value: string;
  onChange: (imageId: string) => void;
  characters: any[];
  scenes: any[];
  props: any[];
  storyboards: any[];
}

function NodeImagePicker({ value, onChange, characters, scenes, props, storyboards }: NodeImagePickerProps) {
  const allAssets = useMemo(() => {
    const list: { id: string; imageId: string; name: string; url: string }[] = [];
    for (const a of characters) {
      if (a.image_id && a.primary_image_url) list.push({ id: a.asset_id, imageId: a.image_id, name: a.name, url: a.primary_image_url });
    }
    for (const a of scenes) {
      if (a.image_id && a.primary_image_url) list.push({ id: a.asset_id, imageId: a.image_id, name: a.name, url: a.primary_image_url });
    }
    for (const a of props) {
      if (a.image_id && a.primary_image_url) list.push({ id: a.asset_id, imageId: a.image_id, name: a.name, url: a.primary_image_url });
    }
    for (const a of storyboards) {
      if (a.image_id && a.primary_image_url) list.push({ id: a.asset_id, imageId: a.image_id, name: a.description || `分镜${a.sequence}`, url: a.primary_image_url });
    }
    return list;
  }, [characters, scenes, props, storyboards]);

  if (allAssets.length === 0) {
    return <div className="text-xs text-gray-500">暂无可用图片资产</div>;
  }

  return (
    <div className="max-h-36 overflow-y-auto grid grid-cols-4 gap-1">
      {allAssets.map(asset => (
        <button
          key={asset.imageId}
          type="button"
          onClick={() => onChange(value === asset.imageId ? '' : asset.imageId)}
          title={asset.name}
          className={`relative aspect-square rounded overflow-hidden border-2 ${value === asset.imageId ? 'border-blue-400' : 'border-transparent'} hover:border-blue-300 transition`}
        >
          <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  );
}

// ---- 节点运行输出展示 ----
function NodeRunOutput({ output }: { output: any }) {
  if (!output) return null;
  return (
    <div className="mt-3 border-t border-gray-700 pt-3">
      <div className="text-xs text-gray-400 mb-1">本次运行输出</div>
      {output.text && (
        <div className="bg-gray-900 rounded p-2 text-xs text-gray-200 max-h-32 overflow-y-auto whitespace-pre-wrap mb-1">
          {output.text}
        </div>
      )}
      {output.image_url && (
        <div className="mb-1">
          <img src={output.image_url} alt="output" className="w-full rounded" />
        </div>
      )}
      {output.video_url && (
        <div className="mb-1">
          <video src={output.video_url} controls className="w-full rounded" />
        </div>
      )}
      {output.task_id && !output.video_url && (
        <div className="text-xs text-gray-400">视频任务 ID: {output.task_id}</div>
      )}
      {output.error && (
        <div className="text-xs text-red-400 mt-1">{output.error}</div>
      )}
    </div>
  );
}

export function CanvasPropertyPanel({ projectId, mode = 'asset' }: CanvasPropertyPanelProps) {
  const {
    selectedIds,
    selectedNodeId,
    canvasElements,
    deleteCanvasElement,
    clearSelection,
    createCanvasElement,
    fetchCanvasElements,
    canvasList,
    activeCanvasId,
    activeRun,
    setSelectedNode,
    upsertNode,
    removeNode,
    upsertEdge,
    removeEdge,
    validateWorkflow,
    runWorkflow,
    cancelWorkflowRun,
    fetchWorkflowRuns,
  } = useCanvasStore();
  const { characters, scenes, props, storyboards } = useAssetStore();
  const { toast } = useToast();

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // workflow 表单状态
  const [newNodeType, setNewNodeType] = useState('trigger.manual');
  const [newNodeLabel, setNewNodeLabel] = useState('');
  const [newNodeX, setNewNodeX] = useState('160');
  const [newNodeY, setNewNodeY] = useState('160');
  const [configText, setConfigText] = useState('{}');

  const parsedConfig = useMemo(() => {
    try { return JSON.parse(configText || '{}'); } catch { return {}; }
  }, [configText]);

  const updateConfigField = useCallback((key: string, value: any) => {
    setConfigText(prev => {
      try {
        const obj = JSON.parse(prev || '{}');
        if (value === undefined || value === null || value === '') {
          delete obj[key];
        } else {
          obj[key] = value;
        }
        return JSON.stringify(obj, null, 2);
      } catch {
        return JSON.stringify({ [key]: value }, null, 2);
      }
    });
  }, []);

  const [edgeSourceNodeId, setEdgeSourceNodeId] = useState('');
  const [edgeTargetNodeId, setEdgeTargetNodeId] = useState('');
  const [edgeSourcePort, setEdgeSourcePort] = useState('out');
  const [edgeTargetPort, setEdgeTargetPort] = useState('in');
  const [edgeSourceType, setEdgeSourceType] = useState('json');
  const [edgeTargetType, setEdgeTargetType] = useState('json');

  const activeCanvas = useMemo(
    () => canvasList.find(c => c.canvas_id === activeCanvasId),
    [canvasList, activeCanvasId],
  );

  const selectedNode = useMemo(
    () => activeCanvas?.nodes?.find(n => n.node_id === selectedNodeId) || null,
    [activeCanvas, selectedNodeId],
  );

  const selectedNodeIncomingEdges = useMemo(() => {
    if (!activeCanvas || !selectedNodeId) return [];
    return (activeCanvas.edges || []).filter(e => e.target_node_id === selectedNodeId);
  }, [activeCanvas, selectedNodeId]);

  const selectedNodeOutgoingEdges = useMemo(() => {
    if (!activeCanvas || !selectedNodeId) return [];
    return (activeCanvas.edges || []).filter(e => e.source_node_id === selectedNodeId);
  }, [activeCanvas, selectedNodeId]);

  // 资产模式选中元素
  const getSelectedElements = () => {
    return selectedIds
      .map(id => {
        if (canvasElements[id]) {
          return canvasElements[id];
        }

        const char = characters.find(c => c.asset_id === id);
        if (char) {
          return {
            id: char.asset_id,
            type: 'character' as const,
            name: char.name,
            imageUrl: char.primary_image_url || '',
            data: char,
          };
        }

        const scene = scenes.find(s => s.asset_id === id);
        if (scene) {
          return {
            id: scene.asset_id,
            type: 'scene' as const,
            name: scene.name,
            imageUrl: scene.primary_image_url || '',
            data: scene,
          };
        }

        const prop = props.find(p => p.asset_id === id);
        if (prop) {
          return {
            id: prop.asset_id,
            type: 'prop' as const,
            name: prop.name,
            imageUrl: prop.primary_image_url || '',
            data: prop,
          };
        }

        const storyboard = storyboards.find(s => s.asset_id === id);
        if (storyboard) {
          return {
            id: storyboard.asset_id,
            type: 'storyboard' as const,
            name: storyboard.description || `分镜 ${storyboard.sequence}`,
            imageUrl: storyboard.primary_image_url || '',
            data: storyboard,
          };
        }

        return null;
      })
      .filter(Boolean);
  };

  const selectedElements = getSelectedElements();

  const handleDeleteElement = async (elementId: string) => {
    if (!window.confirm('确定要删除这个画布元素吗？')) return;
    try {
      await deleteCanvasElement(projectId, elementId);
      clearSelection();
      toast('画布元素已删除', 'success');
    } catch (error: any) {
      toast(`删除失败: ${error.message}`, 'error');
    }
  };

  const handleGenerateSingleFusion = async (element: any) => {
    if (!prompt.trim()) {
      toast('请输入提示词', 'error');
      return;
    }

    const imageId = element.data?.image_id;
    if (!imageId) {
      toast('该元素没有图片', 'error');
      return;
    }

    setIsGenerating(true);
    try {
      const elementPosition = activeCanvas?.elements.find(e => e.id === element.id);
      const newPosition = elementPosition ? { x: elementPosition.x + 30, y: elementPosition.y + 30 } : undefined;

      const elementId = await createCanvasElement(
        projectId,
        {
          name: `${element.name}_融合`,
          description: prompt,
          source_asset_ids: [element.id],
          source_types: [element.type],
          fusion_prompt: prompt,
        },
        newPosition,
      );

      await canvasApi.generateFusionImage(projectId, {
        asset_ids: [element.id],
        asset_types: [element.type],
        prompt,
        image_ids: [imageId],
        canvas_element_id: elementId,
      });

      await fetchCanvasElements(projectId);
      toast('图片生成成功', 'success');
      setPrompt('');
    } catch (error: any) {
      toast(`生成失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateNode = async () => {
    if (!activeCanvasId || !activeCanvas) {
      toast('请先选择画布', 'error');
      return;
    }

    try {
      const nodeType = newNodeType;
      const nodeLabel = (newNodeLabel || NODE_TYPE_OPTIONS.find(o => o.value === nodeType)?.label || '新节点').trim();
      const nodeConfig = JSON.parse(configText || '{}');
      const nodeId = `node_${Date.now()}`;

      const node: WorkflowNode = {
        node_id: nodeId,
        type: nodeType,
        label: nodeLabel,
        x: Number(newNodeX) || 160,
        y: Number(newNodeY) || 160,
        config: nodeConfig,
      };

      await upsertNode(projectId, activeCanvasId, node);
      setSelectedNode(nodeId);
      toast('节点创建成功', 'success');
    } catch (error: any) {
      toast(`创建节点失败: ${error.message || '请检查配置JSON'}`, 'error');
    }
  };

  const handleUpdateSelectedNode = async () => {
    if (!activeCanvasId || !selectedNode) return;

    try {
      const nextConfig = JSON.parse(configText || '{}');
      await upsertNode(projectId, activeCanvasId, {
        ...selectedNode,
        config: nextConfig,
      });
      toast('节点已更新', 'success');
    } catch (error: any) {
      toast(`更新失败: ${error.message || '请检查配置JSON'}`, 'error');
    }
  };

  const handleDeleteSelectedNode = async () => {
    if (!activeCanvasId || !selectedNode) return;
    if (!window.confirm(`确定删除节点 ${selectedNode.label} ?`)) return;

    await removeNode(projectId, activeCanvasId, selectedNode.node_id);
    setSelectedNode(null);
    toast('节点已删除', 'success');
  };

  const handleCreateEdge = async () => {
    if (!activeCanvasId) return;
    if (!edgeSourceNodeId || !edgeTargetNodeId) {
      toast('请先选择源节点和目标节点', 'error');
      return;
    }

    const edgeId = `edge_${Date.now()}`;
    await upsertEdge(projectId, activeCanvasId, {
      edge_id: edgeId,
      source_node_id: edgeSourceNodeId,
      source_port: edgeSourcePort || 'out',
      source_port_type: edgeSourceType as any,
      target_node_id: edgeTargetNodeId,
      target_port: edgeTargetPort || 'in',
      target_port_type: edgeTargetType as any,
    });

    toast('连线已创建', 'success');
  };

  const handleValidateWorkflow = async () => {
    if (!activeCanvasId) return;

    const result = await validateWorkflow(projectId, activeCanvasId);
    if (!result) {
      toast('校验失败', 'error');
      return;
    }

    if (result.valid) {
      toast(`校验通过：${result.node_count}节点/${result.edge_count}连线`, 'success');
      return;
    }

    const firstErr = result.errors[0] || '未知错误';
    toast(`校验失败：${firstErr}`, 'error');
  };

  const handleRunWorkflow = async () => {
    if (!activeCanvasId) return;
    const run = await runWorkflow(projectId, activeCanvasId);
    if (run) {
      toast('工作流已启动', 'success');
      await fetchWorkflowRuns(projectId, activeCanvasId, 20);
    } else {
      toast('工作流启动失败', 'error');
    }
  };

  const handleCancelRun = async () => {
    if (!activeCanvasId || !activeRun) return;
    await cancelWorkflowRun(projectId, activeCanvasId, activeRun.run_id);
    toast('已请求取消运行', 'success');
  };

  const handleRemoveEdge = async (edgeId: string) => {
    if (!activeCanvasId) return;
    await removeEdge(projectId, activeCanvasId, edgeId);
    toast('连线已删除', 'success');
  };

  if (mode === 'workflow') {
    if (!activeCanvas) {
      return (
        <div className="w-96 bg-gray-800 border-l border-gray-700 p-4 text-sm text-gray-400">未找到当前画布</div>
      );
    }

    const nodes = activeCanvas.nodes || [];

    return (
      <div className="w-96 bg-gray-800 border-l border-gray-700 p-4 overflow-y-auto space-y-4">
        <div>
          <div className="text-sm font-medium text-white mb-2">工作流运行</div>
          <div className="flex gap-2">
            <button
              onClick={handleValidateWorkflow}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 rounded text-white text-sm"
            >
              <ShieldCheck size={14} /> 校验
            </button>
            <button
              onClick={handleRunWorkflow}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white text-sm"
            >
              <Play size={14} /> 运行
            </button>
            {activeRun && ['created', 'validating', 'running', 'canceling'].includes(activeRun.status) && (
              <button
                onClick={handleCancelRun}
                className="flex items-center justify-center px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-white text-sm"
                title="取消运行"
              >
                <XCircle size={14} />
              </button>
            )}
          </div>
          {activeRun && (
            <div className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-300">
              <div>Run ID: {activeRun.run_id.slice(0, 8)}...</div>
              <div>状态: {RUN_STATUS_LABEL[activeRun.status as WorkflowRunStatus] || activeRun.status}</div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-700 pt-4">
          <div className="text-sm font-medium text-white mb-2">新增节点</div>
          <div className="space-y-2">
            <select
              value={newNodeType}
              onChange={e => setNewNodeType(e.target.value)}
              className="w-full bg-gray-900 text-white px-2 py-2 rounded text-sm"
            >
              {NODE_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <input
              value={newNodeLabel}
              onChange={e => setNewNodeLabel(e.target.value)}
              placeholder="节点显示名（可空）"
              className="w-full bg-gray-900 text-white px-2 py-2 rounded text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={newNodeX}
                onChange={e => setNewNodeX(e.target.value)}
                placeholder="X"
                className="bg-gray-900 text-white px-2 py-2 rounded text-sm"
              />
              <input
                value={newNodeY}
                onChange={e => setNewNodeY(e.target.value)}
                placeholder="Y"
                className="bg-gray-900 text-white px-2 py-2 rounded text-sm"
              />
            </div>
            <textarea
              value={configText}
              onChange={e => setConfigText(e.target.value)}
              rows={5}
              className="w-full bg-gray-900 text-white px-2 py-2 rounded text-sm font-mono"
              placeholder='节点配置 JSON，如 {"template":"{{vars.topic}}"}'
            />
            <button
              onClick={handleCreateNode}
              className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-700 rounded text-white text-sm"
            >
              <Plus size={14} /> 创建节点
            </button>
          </div>
        </div>

        <div className="border-t border-gray-700 pt-4">
          <div className="text-sm font-medium text-white mb-2">新增连线</div>
          <div className="space-y-2">
            <select
              value={edgeSourceNodeId}
              onChange={e => setEdgeSourceNodeId(e.target.value)}
              className="w-full bg-gray-900 text-white px-2 py-2 rounded text-sm"
            >
              <option value="">选择源节点</option>
              {nodes.map(n => (
                <option key={n.node_id} value={n.node_id}>
                  {n.label} ({n.node_id})
                </option>
              ))}
            </select>
            <select
              value={edgeTargetNodeId}
              onChange={e => setEdgeTargetNodeId(e.target.value)}
              className="w-full bg-gray-900 text-white px-2 py-2 rounded text-sm"
            >
              <option value="">选择目标节点</option>
              {nodes.map(n => (
                <option key={n.node_id} value={n.node_id}>
                  {n.label} ({n.node_id})
                </option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-2">
              <input
                value={edgeSourcePort}
                onChange={e => setEdgeSourcePort(e.target.value)}
                placeholder="源端口"
                className="bg-gray-900 text-white px-2 py-2 rounded text-sm"
              />
              <input
                value={edgeTargetPort}
                onChange={e => setEdgeTargetPort(e.target.value)}
                placeholder="目标端口"
                className="bg-gray-900 text-white px-2 py-2 rounded text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={edgeSourceType}
                onChange={e => setEdgeSourceType(e.target.value)}
                className="bg-gray-900 text-white px-2 py-2 rounded text-sm"
              >
                <option value="json">json</option>
                <option value="text">text</option>
                <option value="image">image</option>
                <option value="image_list">image_list</option>
                <option value="video">video</option>
              </select>
              <select
                value={edgeTargetType}
                onChange={e => setEdgeTargetType(e.target.value)}
                className="bg-gray-900 text-white px-2 py-2 rounded text-sm"
              >
                <option value="json">json</option>
                <option value="text">text</option>
                <option value="image">image</option>
                <option value="image_list">image_list</option>
                <option value="video">video</option>
              </select>
            </div>
            <button
              onClick={handleCreateEdge}
              className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 rounded text-white text-sm"
            >
              <Link2 size={14} /> 创建连线
            </button>
          </div>
        </div>

        <div className="border-t border-gray-700 pt-4">
          <div className="text-sm font-medium text-white mb-2">节点列表（点击节点卡片可选中）</div>
          <div className="max-h-60 overflow-auto space-y-2">
            {nodes.length === 0 && <div className="text-xs text-gray-500">暂无节点</div>}
            {nodes.map(n => (
              <button
                key={n.node_id}
                onClick={() => {
                  setSelectedNode(n.node_id);
                  setConfigText(JSON.stringify(n.config || {}, null, 2));
                }}
                className={`w-full text-left px-2 py-2 rounded text-xs border ${
                  selectedNodeId === n.node_id ? 'bg-blue-600/20 border-blue-500 text-white' : 'bg-gray-900 border-gray-700 text-gray-300'
                }`}
              >
                <div className="font-medium">{n.label}</div>
                <div className="text-[11px] opacity-80">{n.type}</div>
                <div className="text-[11px] opacity-70">{n.node_id}</div>
              </button>
            ))}
          </div>
        </div>

        {selectedNode && (
          <div className="border-t border-gray-700 pt-4">
            <div className="text-sm font-medium text-white mb-2">选中节点：{selectedNode.label}</div>

            {/* 结构化配置字段 */}
            {(selectedNode.type === 'gen.llm') && (
              <div className="space-y-2 mb-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">系统提示（可选）</label>
                  <textarea
                    value={parsedConfig.system_prompt || ''}
                    onChange={e => updateConfigField('system_prompt', e.target.value)}
                    rows={2}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    placeholder="You are a helpful assistant."
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">提示词 *</label>
                  <textarea
                    value={parsedConfig.prompt || ''}
                    onChange={e => updateConfigField('prompt', e.target.value)}
                    rows={4}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    placeholder="请写一段关于..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">温度</label>
                    <input
                      type="number" step="0.1" min="0" max="2"
                      value={parsedConfig.temperature ?? 0.7}
                      onChange={e => updateConfigField('temperature', parseFloat(e.target.value))}
                      className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">最大 Token</label>
                    <input
                      type="number" step="1000" min="100"
                      value={parsedConfig.max_tokens ?? 32000}
                      onChange={e => updateConfigField('max_tokens', parseInt(e.target.value))}
                      className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {(selectedNode.type === 'analysis.vlm') && (
              <div className="space-y-2 mb-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">系统提示</label>
                  <textarea
                    value={parsedConfig.system_prompt || ''}
                    onChange={e => updateConfigField('system_prompt', e.target.value)}
                    rows={2}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    placeholder="请分析这张图片。"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">用户指令</label>
                  <input
                    value={parsedConfig.user_text || ''}
                    onChange={e => updateConfigField('user_text', e.target.value)}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    placeholder="请分析这些图片："
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">选择图片 *（写入 image_id）</label>
                  <NodeImagePicker
                    value={parsedConfig.image_id || ''}
                    onChange={imgId => updateConfigField('image_id', imgId)}
                    characters={characters} scenes={scenes} props={props} storyboards={storyboards}
                  />
                </div>
              </div>
            )}

            {(selectedNode.type === 'gen.image') && (
              <div className="space-y-2 mb-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">提示词 *</label>
                  <textarea
                    value={parsedConfig.prompt || ''}
                    onChange={e => updateConfigField('prompt', e.target.value)}
                    rows={4}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    placeholder="A cinematic scene..."
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">反向提示词</label>
                  <input
                    value={parsedConfig.negative_prompt || ''}
                    onChange={e => updateConfigField('negative_prompt', e.target.value)}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    placeholder="blurry, low quality..."
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">尺寸</label>
                  <select
                    value={parsedConfig.size || '1x1'}
                    onChange={e => updateConfigField('size', e.target.value)}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                  >
                    <option value="1x1">1:1 方形</option>
                    <option value="16x9">16:9 横屏</option>
                    <option value="9x16">9:16 竖屏</option>
                    <option value="4x3">4:3</option>
                    <option value="3x4">3:4</option>
                  </select>
                </div>
              </div>
            )}

            {(selectedNode.type === 'gen.fusion_image') && (
              <div className="space-y-2 mb-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">提示词 *</label>
                  <textarea
                    value={parsedConfig.prompt || ''}
                    onChange={e => updateConfigField('prompt', e.target.value)}
                    rows={4}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">选择参考图片 *（写入 image_id）</label>
                  <NodeImagePicker
                    value={parsedConfig.image_id || ''}
                    onChange={imgId => updateConfigField('image_id', imgId)}
                    characters={characters} scenes={scenes} props={props} storyboards={storyboards}
                  />
                </div>
              </div>
            )}

            {(selectedNode.type === 'gen.video') && (
              <div className="space-y-2 mb-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">提示词 *</label>
                  <textarea
                    value={parsedConfig.prompt || ''}
                    onChange={e => updateConfigField('prompt', e.target.value)}
                    rows={3}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">选择首帧图片（写入 image_id）</label>
                  <NodeImagePicker
                    value={parsedConfig.image_id || ''}
                    onChange={imgId => updateConfigField('image_id', imgId)}
                    characters={characters} scenes={scenes} props={props} storyboards={storyboards}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">时长（秒）</label>
                    <input
                      type="number" min="1" max="60"
                      value={parsedConfig.duration ?? 6}
                      onChange={e => updateConfigField('duration', parseInt(e.target.value))}
                      className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">分辨率</label>
                    <select
                      value={parsedConfig.resolution || '1920x1080'}
                      onChange={e => updateConfigField('resolution', e.target.value)}
                      className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    >
                      <option value="1920x1080">1920×1080</option>
                      <option value="1280x720">1280×720</option>
                      <option value="1080x1920">1080×1920</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {(selectedNode.type === 'prompt.compose') && (
              <div className="space-y-2 mb-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">提示词模板 *</label>
                  <textarea
                    value={parsedConfig.template || parsedConfig.prompt || ''}
                    onChange={e => updateConfigField('template', e.target.value)}
                    rows={5}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                    placeholder="支持 {{vars.xxx}} 或 {{node_outputs.nodeId.field}}"
                  />
                </div>
              </div>
            )}

            {(selectedNode.type === 'input.asset') && (
              <div className="space-y-2 mb-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">资产类型</label>
                  <select
                    value={parsedConfig.asset_type || 'character'}
                    onChange={e => updateConfigField('asset_type', e.target.value)}
                    className="w-full bg-gray-900 text-white px-2 py-1.5 rounded text-xs"
                  >
                    <option value="character">角色</option>
                    <option value="scene">场景</option>
                    <option value="prop">道具</option>
                    <option value="storyboard">分镜</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">选择资产</label>
                  <NodeImagePicker
                    value={parsedConfig.asset_id || ''}
                    onChange={assetId => updateConfigField('asset_id', assetId)}
                    characters={characters} scenes={scenes} props={props} storyboards={storyboards}
                  />
                </div>
              </div>
            )}

            {/* JSON 高级编辑（兜底） */}
            <details className="mb-2">
              <summary className="text-xs text-gray-400 cursor-pointer select-none">高级：编辑原始 JSON</summary>
              <textarea
                value={configText}
                onChange={e => setConfigText(e.target.value)}
                rows={6}
                className="w-full bg-gray-900 text-white px-2 py-2 rounded text-sm font-mono mt-1"
              />
            </details>

            <div className="mt-2 flex gap-2">
              <button
                onClick={handleUpdateSelectedNode}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 rounded text-white text-sm"
              >
                <RefreshCcw size={14} /> 更新节点
              </button>
              <button
                onClick={handleDeleteSelectedNode}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-white text-sm"
              >
                <Trash2 size={14} /> 删除节点
              </button>
            </div>

            <div className="mt-3 text-xs text-gray-400">入边（{selectedNodeIncomingEdges.length}）</div>
            <div className="space-y-1 mt-1">
              {selectedNodeIncomingEdges.map(edge => (
                <div key={edge.edge_id} className="flex items-center justify-between bg-gray-900 px-2 py-1 rounded text-xs text-gray-300">
                  <span>{edge.source_node_id}:{edge.source_port} {'->'} {edge.target_port}</span>
                  <button
                    onClick={() => handleRemoveEdge(edge.edge_id)}
                    className="text-red-400 hover:text-red-300"
                    title="删除连线"
                  >
                    <Unlink size={12} />
                  </button>
                </div>
              ))}
              {selectedNodeIncomingEdges.length === 0 && <div className="text-xs text-gray-500">无</div>}
            </div>

            <div className="mt-3 text-xs text-gray-400">出边（{selectedNodeOutgoingEdges.length}）</div>
            <div className="space-y-1 mt-1">
              {selectedNodeOutgoingEdges.map(edge => (
                <div key={edge.edge_id} className="flex items-center justify-between bg-gray-900 px-2 py-1 rounded text-xs text-gray-300">
                  <span>{edge.source_port} {'->'} {edge.target_node_id}:{edge.target_port}</span>
                  <button
                    onClick={() => handleRemoveEdge(edge.edge_id)}
                    className="text-red-400 hover:text-red-300"
                    title="删除连线"
                  >
                    <Unlink size={12} />
                  </button>
                </div>
              ))}
              {selectedNodeOutgoingEdges.length === 0 && <div className="text-xs text-gray-500">无</div>}
            </div>

            {/* 节点运行输出 */}
            {activeRun?.outputs?.[selectedNode.node_id] && (
              <NodeRunOutput output={activeRun.outputs[selectedNode.node_id]} />
            )}
          </div>
        )}
      </div>
    );
  }

  // 资产模式
  if (selectedIds.length === 0) {
    return (
      <div className="w-80 bg-gray-800 border-l border-gray-700 p-4 flex items-center justify-center">
        <div className="text-center text-gray-400">
          <p className="text-sm">未选中任何元素</p>
          <p className="text-xs mt-2">点击元素查看属性</p>
          <p className="text-xs mt-1">按住Ctrl+点击可多选</p>
        </div>
      </div>
    );
  }

  if (selectedIds.length > 1) {
    return (
      <div className="w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto">
        <CanvasFusionPanel projectId={projectId} selectedElements={selectedElements as any} />
      </div>
    );
  }

  const element = selectedElements[0];
  if (!element) return null;

  return (
    <div className="w-80 bg-gray-800 border-l border-gray-700 p-4 overflow-y-auto">
      <div className="mb-4">
        <div className="aspect-square bg-gray-900 rounded overflow-hidden">
          {element.imageUrl ? (
            <img src={element.imageUrl} alt={element.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600">无图片</div>
          )}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-lg font-medium text-white">{element.name}</div>
      </div>

      <div className="mb-4">
        <label className="text-xs text-gray-400 mb-2 block">提示词</label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="输入提示词，生成新的融合元素..."
          className="w-full bg-gray-900 text-white px-3 py-2 rounded text-sm resize-none"
          rows={4}
        />
      </div>

      <button
        onClick={() => handleGenerateSingleFusion(element)}
        disabled={!prompt.trim() || isGenerating}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:bg-gray-600 disabled:cursor-not-allowed text-white transition-colors"
      >
        {isGenerating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            生成中...
          </>
        ) : (
          <>
            <Sparkles size={16} />
            生成图片
          </>
        )}
      </button>

      {element.type === 'canvas_element' && (
        <div className="mt-6 pt-4 border-t border-gray-700">
          <button
            onClick={() => handleDeleteElement(element.id)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white transition-colors"
          >
            <Trash2 size={16} />
            删除画布元素
          </button>
          <p className="text-xs text-gray-500 mt-2 text-center">资产和分镜元素不可删除</p>
        </div>
      )}
    </div>
  );
}
