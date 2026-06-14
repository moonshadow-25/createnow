import { getDefinition, NODE_HEIGHT, NODE_WIDTH } from './nodeDefinitions';
import type { CanvasEdge, CanvasNode, NodeKind, NodeOutput } from './types';

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function getBackendMediaUrl(path: string): string {
  if (!path || path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
  return `${import.meta.env.DEV ? 'http://localhost:8501' : ''}${path}`;
}

export function getImageUrlFromRecord(projectId: string, record: any): string {
  if (record?.local_path) return getBackendMediaUrl(`/api/projects/${projectId}/images/files/${record.local_path}`);
  return getBackendMediaUrl(record?.image_path || record?.image_url || '');
}

export function getVideoUrlFromRecord(projectId: string, record: any): string {
  if (record?.local_path) return getBackendMediaUrl(`/api/projects/${projectId}/videos/files/${record.local_path}`);
  return getBackendMediaUrl(record?.video_path || record?.video_url || '');
}

export function buildVideoNodeOutput(projectId: string, record: any, fallbackName: string): NodeOutput {
  const videoUrl = getVideoUrlFromRecord(projectId, record);
  return {
    video_id: record.video_id,
    video_url: videoUrl,
    media: videoUrl ? [{ type: 'video', id: record.video_id, url: videoUrl, name: record.prompt || fallbackName }] : [],
    raw: record,
  };
}

export function isPendingVideoStatus(status?: string): boolean {
  return !status || ['pending', 'processing', 'running', 'in_progress', 'created'].includes(status);
}

export function isVideoNode(type: NodeKind): boolean {
  return type === 'gen.video.text' || type === 'gen.video.image' || type === 'gen.video.multi';
}

export function textFromOutput(output?: NodeOutput): string {
  if (!output) return '';
  if (output.text) return output.text;
  if (output.image_id) return output.image_id;
  if (output.video_url) return output.video_url;
  return '';
}

export function isDynamicNode(type: NodeKind): boolean {
  return type.startsWith('gen.') || type === 'director.stage';
}

export function getOutputStatus(output?: NodeOutput): string {
  const raw = output?.raw;
  if (!raw || typeof raw !== 'object' || !('status' in raw)) return '';
  return String((raw as { status?: unknown }).status || '').toLowerCase();
}

export function canReuseNodeOutput(node: CanvasNode, output?: NodeOutput): boolean {
  if (!output) return false;
  const status = getOutputStatus(output);
  if (['pending', 'processing', 'running', 'in_progress', 'created', 'failed', 'error'].includes(status)) return false;

  if (node.type === 'gen.llm') return Boolean(output.text?.trim());
  if (node.type === 'gen.image' || node.type === 'gen.image_edit' || node.type === 'director.stage') return Boolean(output.image_url?.trim());
  if (isVideoNode(node.type)) return Boolean(output.video_url?.trim());
  return true;
}

export function pickRenderableOutput(runtimeOutput?: NodeOutput, persistedOutput?: NodeOutput): NodeOutput | undefined {
  if (!runtimeOutput) return persistedOutput;
  if (!persistedOutput) return runtimeOutput;
  if (runtimeOutput.video_id && runtimeOutput.video_id === persistedOutput.video_id && !runtimeOutput.video_url && persistedOutput.video_url) return persistedOutput;
  return runtimeOutput;
}

export function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const objectValue = value as Record<string, unknown>;
  return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`).join(',')}}`;
}

export function buildInputHash(node: CanvasNode, inputOutputs: NodeOutput[]): string {
  const { last_result: _lastResult, audit_state: _auditState, input_hash: _inputHash, ...config } = node.config;
  return stableStringify({ type: node.type, config, inputs: inputOutputs });
}

export function mergePrompt(prompt: string | undefined, inputText: string): string {
  const base = (prompt || '').trim();
  const input = inputText.trim();
  if (!base) return input;
  if (base.includes('{{input}}')) return base.split('{{input}}').join(input);
  return base;
}

export function normalizeNodes(nodes: any[] | undefined): CanvasNode[] {
  return (nodes || []).map((node) => ({
    node_id: String(node.node_id || node.id || newId('node')),
    type: (node.type || 'static.image') as NodeKind,
    label: String(node.label || getDefinition((node.type || 'static.image') as NodeKind).label),
    x: Number(node.x || 0),
    y: Number(node.y || 0),
    width: Number(node.width || NODE_WIDTH),
    height: Number(node.height || NODE_HEIGHT),
    config: node.config || {},
  }));
}

export function normalizeEdges(edges: any[] | undefined): CanvasEdge[] {
  return (edges || []).map((edge, index) => ({
    edge_id: String(edge.edge_id || edge.id || newId('edge')),
    source_node_id: String(edge.source_node_id || edge.source || ''),
    source_port: String(edge.source_port || edge.sourceHandle || 'out'),
    source_port_type: edge.source_port_type,
    target_node_id: String(edge.target_node_id || edge.target || ''),
    target_port: String(edge.target_port || edge.targetHandle || 'in'),
    target_port_type: edge.target_port_type,
    order: Number.isFinite(Number(edge.order)) ? Number(edge.order) : index + 1,
  })).filter((edge) => edge.source_node_id && edge.target_node_id);
}

export function buildCanvasPayload(
  canvasName: string,
  zoom: number,
  pan: { x: number; y: number },
  nodes: CanvasNode[],
  edges: CanvasEdge[],
) {
  return {
    name: canvasName || '新画布',
    zoom,
    pan_x: pan.x,
    pan_y: pan.y,
    schema_version: 3,
    nodes,
    edges,
    variables: { ui: 'new-canvas' },
  };
}

export function serializeCanvasPayload(payload: ReturnType<typeof buildCanvasPayload>): string {
  return stableStringify(payload);
}

export function buildTopologicalOrder(nodes: CanvasNode[], edges: CanvasEdge[]): string[] {
  const ids = new Set(nodes.map((node) => node.node_id));
  const indegree = new Map<string, number>();
  const graph = new Map<string, string[]>();
  nodes.forEach((node) => {
    indegree.set(node.node_id, 0);
    graph.set(node.node_id, []);
  });
  edges.forEach((edge) => {
    if (!ids.has(edge.source_node_id) || !ids.has(edge.target_node_id)) return;
    graph.get(edge.source_node_id)?.push(edge.target_node_id);
    indegree.set(edge.target_node_id, (indegree.get(edge.target_node_id) || 0) + 1);
  });
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);
    (graph.get(current) || []).forEach((next) => {
      const degree = (indegree.get(next) || 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    });
  }
  return order.length === nodes.length ? order : [];
}

export function collectDownstreamNodeIds(startNodeId: string, edges: CanvasEdge[]): Set<string> {
  const result = new Set<string>([startNodeId]);
  const queue = [startNodeId];
  while (queue.length) {
    const current = queue.shift()!;
    edges.filter((edge) => edge.source_node_id === current).forEach((edge) => {
      if (result.has(edge.target_node_id)) return;
      result.add(edge.target_node_id);
      queue.push(edge.target_node_id);
    });
  }
  return result;
}

export async function readChatStream(projectId: string, message: string): Promise<string> {
  const token = localStorage.getItem('saas_token') || localStorage.getItem('admin_token');
  const response = await fetch(`/api/projects/${projectId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new Error('LLM 调用失败');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('LLM 响应为空');

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach((line) => {
      if (!line.startsWith('data: ')) return;
      try {
        const chunk = JSON.parse(line.slice(6));
        if (chunk.type === 'content') content += chunk.content || '';
      } catch {
        // ignore malformed stream chunks
      }
    });
  }
  return content.trim();
}
