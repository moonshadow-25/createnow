import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Loader2, Play, Plus, Save, Trash2, X, ZoomIn } from 'lucide-react';
import { canvasApi, generationApi } from '@/services/api';
import { useAssetStore } from '@/store/assetStore';
import { useToast } from '@/components/common/Toast';
import { ImagePreviewModal } from '@/components/common/ImagePreviewModal';
import { getAssetImageUrl } from '@/components/assets/AssetPickerPanel';
import { CanvasAssetPickerDialog } from './CanvasAssetPickerDialog';
import { CanvasHistoryPanel } from './CanvasHistoryPanel';
import { CanvasPropertyPanel } from './CanvasPropertyPanel';
import { EDGE_HIT_STROKE, MAX_ZOOM, MIN_ZOOM, NODE_DEFINITIONS, NODE_HEIGHT, NODE_WIDTH, PORT_SNAP_RADIUS, SIDEBAR_OPEN_DISTANCE, getDefinition } from './nodeDefinitions';
import { buildCanvasPayload, buildInputHash, buildTopologicalOrder, buildVideoNodeOutput, canReuseNodeOutput, collectDownstreamNodeIds, getBackendMediaUrl, getImageUrlFromRecord, getOutputStatus, getVideoUrlFromRecord, isDynamicNode, isPendingVideoStatus, isVideoNode, mergePrompt, newId, normalizeEdges, normalizeNodes, pickRenderableOutput, readChatStream, serializeCanvasPayload, textFromOutput } from './canvasUtils';
import type { AssetAuditState, CanvasAssetType, CanvasEdge, CanvasNode, CanvasRecord, HistoryImage, HistoryItem, HistoryVideo, NewCanvasTabProps, NodeKind, NodeOutput, PortType, RefMedia, RunMode, RunStatus } from './types';

export function NewCanvasTab({ projectId, showAssetSubmit = false, imageApiType = '', videoApiType = '' }: NewCanvasTabProps) {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingVideoIdsRef = useRef<Set<string>>(new Set());
  const nodeDragMovedRef = useRef(false);
  const uploadTargetRef = useRef<{ nodeId: string; target: 'image' | 'video' | 'audio' } | null>(null);
  const lastSavedSnapshotRef = useRef<string>('');
  const autoSaveReadyRef = useRef(false);
  const activeCanvasIdRef = useRef('');
  const [canvases, setCanvases] = useState<CanvasRecord[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string>('');
  const [canvasName, setCanvasName] = useState('新画布');
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ nodeId: string; port: string; type: PortType; pointer?: { x: number; y: number } } | null>(null);
  const [draggingNode, setDraggingNode] = useState<{ nodeId: string; dx: number; dy: number } | null>(null);
  const [resizingNode, setResizingNode] = useState<{ nodeId: string; startX: number; startY: number; width: number; height: number } | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [nodeStatus, setNodeStatus] = useState<Record<string, { status: RunStatus; error?: string }>>({});
  const [outputs, setOutputs] = useState<Record<string, NodeOutput>>({});
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string; imageId?: string } | null>(null);
  const [assetTab, setAssetTab] = useState<CanvasAssetType>('character');
  const [uploadTarget, setUploadTarget] = useState<'image' | 'video' | 'audio'>('image');
  const [rightPanelTab, setRightPanelTab] = useState<'node' | 'history'>('node');
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyImages, setHistoryImages] = useState<HistoryImage[]>([]);
  const [historyVideos, setHistoryVideos] = useState<HistoryVideo[]>([]);
  const [pollingVideoIds, setPollingVideoIds] = useState<Set<string>>(new Set());
  const { characters, scenes, props, storyboards } = useAssetStore();

  const selectedNode = useMemo(
    () => nodes.find((node) => node.node_id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );

  const textHistory = useMemo(() => nodes
    .map((node) => ({ node, output: outputs[node.node_id] || node.config.last_result }))
    .filter((item) => item.output?.text)
    .map((item) => ({ node_id: item.node.node_id, label: item.node.label, text: item.output?.text || '' })), [nodes, outputs]);

  const historyItems = useMemo<HistoryItem[]>(() => {
    const imageItems: HistoryItem[] = historyImages.map((image) => ({
      kind: 'image',
      id: image.image_id,
      title: image.prompt || '画布图片',
      createdAt: image.created_at || '',
      image,
    }));
    const videoItems: HistoryItem[] = historyVideos.map((video) => ({
      kind: 'video',
      id: video.video_id,
      title: video.prompt || '画布视频',
      createdAt: video.created_at || '',
      video,
    }));
    const textItems: HistoryItem[] = textHistory.map((item) => ({
      kind: 'text',
      id: item.node_id,
      nodeId: item.node_id,
      title: item.label,
      createdAt: '',
      text: item.text,
    }));
    return [...imageItems, ...videoItems, ...textItems]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [historyImages, historyVideos, textHistory]);

  const loadCanvases = useCallback(async () => {
    setLoading(true);
    try {
      const response = await canvasApi.list(projectId);
      let list = response.data as CanvasRecord[];
      if (!list.length) {
        const created = await canvasApi.create(projectId, { name: '默认画布', description: '新画布工作流' });
        list = [created.data];
      }
      setCanvases(list);
      const first = list[0];
      const nextNodes = normalizeNodes(first.nodes);
      const nextEdges = normalizeEdges(first.edges);
      const nextZoom = Number(first.zoom || 1);
      const nextPan = { x: Number(first.pan_x || 0), y: Number(first.pan_y || 0) };
      setActiveCanvasId(first.canvas_id);
      setCanvasName(first.name || '默认画布');
      setNodes(nextNodes);
      setEdges(nextEdges);
      setZoom(nextZoom);
      setPan(nextPan);
      setOutputs(Object.fromEntries(nextNodes.map((node) => [node.node_id, node.config.last_result]).filter(([, output]) => Boolean(output))) as Record<string, NodeOutput>);
      activeCanvasIdRef.current = first.canvas_id;
      lastSavedSnapshotRef.current = serializeCanvasPayload(buildCanvasPayload(first.name || '默认画布', nextZoom, nextPan, nextNodes, nextEdges));
      autoSaveReadyRef.current = true;
    } catch (error: any) {
      toast(error?.response?.data?.detail || '画布加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    loadCanvases();
  }, [loadCanvases]);

  const loadCanvasHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const [imageResponse, videoResponse] = await Promise.all([
        generationApi.listCanvasImages(projectId),
        generationApi.listCanvasVideos(projectId),
      ]);
      const images = (imageResponse.data || []) as HistoryImage[];
      const videos = (videoResponse.data || []) as HistoryVideo[];
      setHistoryImages(images);
      setHistoryVideos(videos);
      videos
        .filter((video) => video.status === 'completed' && Boolean(getVideoUrlFromRecord(projectId, video)))
        .forEach((video) => {
          void syncVideoOutputToCanvasNodes(video);
        });
    } catch (error: any) {
      toast(error?.response?.data?.detail || '画布历史加载失败', 'error');
    } finally {
      setHistoryLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    if (rightPanelTab === 'history') loadCanvasHistory();
  }, [rightPanelTab, loadCanvasHistory]);

  const saveCanvas = useCallback(async (silent = false, nextNodes = nodes, nextEdges = edges) => {
    if (!activeCanvasId) return;
    setSaving(true);
    try {
      const payload = buildCanvasPayload(canvasName, zoom, pan, nextNodes, nextEdges);
      const response = await canvasApi.update(projectId, activeCanvasId, payload);
      lastSavedSnapshotRef.current = serializeCanvasPayload(payload);
      activeCanvasIdRef.current = activeCanvasId;
      setCanvases((prev) => prev.map((item) => item.canvas_id === activeCanvasId ? response.data : item));
      if (!silent) toast('画布已保存', 'success');
    } catch (error: any) {
      toast(error?.response?.data?.detail || '画布保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }, [activeCanvasId, canvasName, edges, nodes, pan, projectId, toast, zoom]);

  useEffect(() => {
    if (!autoSaveReadyRef.current || !activeCanvasId || loading || running) return;
    const payload = buildCanvasPayload(canvasName, zoom, pan, nodes, edges);
    const snapshot = serializeCanvasPayload(payload);
    if (activeCanvasIdRef.current !== activeCanvasId) {
      activeCanvasIdRef.current = activeCanvasId;
      lastSavedSnapshotRef.current = snapshot;
      return;
    }
    if (snapshot === lastSavedSnapshotRef.current) return;

    const timer = window.setTimeout(async () => {
      setSaving(true);
      try {
        const response = await canvasApi.update(projectId, activeCanvasId, payload);
        lastSavedSnapshotRef.current = snapshot;
        setCanvases((prev) => prev.map((item) => item.canvas_id === activeCanvasId ? response.data : item));
      } catch (error: any) {
        toast(error?.response?.data?.detail || '画布自动保存失败', 'error');
      } finally {
        setSaving(false);
      }
    }, 800);

    return () => window.clearTimeout(timer);
  }, [activeCanvasId, canvasName, edges, loading, nodes, pan, projectId, running, toast, zoom]);

  const createCanvas = async () => {
    try {
      const response = await canvasApi.create(projectId, { name: `画布 ${canvases.length + 1}`, description: '新画布工作流' });
      const canvas = response.data as CanvasRecord;
      setCanvases((prev) => [...prev, canvas]);
      setActiveCanvasId(canvas.canvas_id);
      setCanvasName(canvas.name);
      setNodes([]);
      setEdges([]);
      setOutputs({});
      setNodeStatus({});
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      activeCanvasIdRef.current = canvas.canvas_id;
      lastSavedSnapshotRef.current = serializeCanvasPayload(buildCanvasPayload(canvas.name, 1, { x: 0, y: 0 }, [], []));
      autoSaveReadyRef.current = true;
    } catch (error: any) {
      toast(error?.response?.data?.detail || '创建画布失败', 'error');
    }
  };

  const switchCanvas = (canvasId: string) => {
    const canvas = canvases.find((item) => item.canvas_id === canvasId);
    if (!canvas) return;
    const nextNodes = normalizeNodes(canvas.nodes);
    const nextEdges = normalizeEdges(canvas.edges);
    const nextZoom = Number(canvas.zoom || 1);
    const nextPan = { x: Number(canvas.pan_x || 0), y: Number(canvas.pan_y || 0) };
    setActiveCanvasId(canvas.canvas_id);
    setCanvasName(canvas.name || '新画布');
    setNodes(nextNodes);
    setEdges(nextEdges);
    setZoom(nextZoom);
    setPan(nextPan);
    setOutputs(Object.fromEntries(nextNodes.map((node) => [node.node_id, node.config.last_result]).filter(([, output]) => Boolean(output))) as Record<string, NodeOutput>);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    activeCanvasIdRef.current = canvas.canvas_id;
    lastSavedSnapshotRef.current = serializeCanvasPayload(buildCanvasPayload(canvas.name || '新画布', nextZoom, nextPan, nextNodes, nextEdges));
    autoSaveReadyRef.current = true;
  };

  const deleteCanvas = async () => {
    if (!activeCanvasId || canvases.length <= 1) {
      toast('至少保留一个画布', 'error');
      return;
    }
    try {
      await canvasApi.delete(projectId, activeCanvasId);
      const next = canvases.filter((canvas) => canvas.canvas_id !== activeCanvasId);
      setCanvases(next);
      switchCanvas(next[0].canvas_id);
    } catch (error: any) {
      toast(error?.response?.data?.detail || '删除画布失败', 'error');
    }
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  };

  const addNode = (type: NodeKind) => {
    const definition = getDefinition(type);
    const center = canvasRef.current
      ? screenToWorld(canvasRef.current.getBoundingClientRect().left + canvasRef.current.clientWidth / 2, canvasRef.current.getBoundingClientRect().top + canvasRef.current.clientHeight / 2)
      : { x: 120, y: 120 };
    const node: CanvasNode = {
      node_id: newId('node'),
      type,
      label: definition.label,
      x: center.x - NODE_WIDTH / 2 + nodes.length * 20,
      y: center.y - NODE_HEIGHT / 2 + nodes.length * 20,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      config: { ...definition.defaults },
    };
    const next = [...nodes, node];
    setNodes(next);
    setSelectedNodeId(node.node_id);
    setSelectedEdgeId(null);
  };

  const removeNode = (nodeId: string) => {
    const nextNodes = nodes.filter((node) => node.node_id !== nodeId);
    const nextEdges = edges.filter((edge) => edge.source_node_id !== nodeId && edge.target_node_id !== nodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(null);
    setOutputs((prev) => {
      const copy = { ...prev };
      delete copy[nodeId];
      return copy;
    });
  };

  const updateNodeConfig = (nodeId: string, patch: CanvasNode['config']) => {
    setNodes((prev) => prev.map((node) => node.node_id === nodeId ? { ...node, config: { ...node.config, ...patch } } : node));
  };

  const buildStaticNodeUpdate = (currentNodes: CanvasNode[], nodeId: string, patch: CanvasNode['config'], output?: NodeOutput) => currentNodes.map((node) => {
    if (node.node_id !== nodeId) return node;
    const { last_result: _lastResult, input_hash: _inputHash, ...config } = node.config;
    return { ...node, config: { ...config, ...patch, ...(output ? { last_result: output } : {}) } };
  });

  const updateStaticNodeConfig = (nodeId: string, patch: CanvasNode['config'], output?: NodeOutput) => {
    setOutputs((prev) => {
      const copy = { ...prev };
      if (output) copy[nodeId] = output;
      else delete copy[nodeId];
      return copy;
    });
    const nextNodes = buildStaticNodeUpdate(nodes, nodeId, patch, output);
    setNodes(nextNodes);
    return nextNodes;
  };

  const updateNodeLabel = (nodeId: string, label: string) => {
    setNodes((prev) => prev.map((node) => node.node_id === nodeId ? { ...node, label } : node));
  };

  const getNodeOutputPort = (node: CanvasNode) => getDefinition(node.type).outputs[0];

  const findClosestCompatibleInput = (clientX: number, clientY: number, sourceNodeId: string, type: PortType) => {
    const point = screenToWorld(clientX, clientY);
    let best: { nodeId: string; port: string; type: PortType; distance: number } | null = null;

    for (const node of nodes) {
      if (node.node_id === sourceNodeId) continue;
      const inputs = getDefinition(node.type).inputs.filter((input) => input.type === type);
      if (!inputs.length) continue;

      const insideNode = point.x >= node.x
        && point.x <= node.x + (node.width || NODE_WIDTH)
        && point.y >= node.y
        && point.y <= node.y + (node.height || NODE_HEIGHT);
      if (insideNode) {
        const input = inputs[0];
        return { nodeId: node.node_id, port: input.key, type: input.type, distance: 0 };
      }

      for (const input of inputs) {
        const portPosition = getPortPosition(node.node_id, input.key, 'in');
        const distance = Math.hypot(point.x - portPosition.x, point.y - portPosition.y);
        if (distance <= PORT_SNAP_RADIUS && (!best || distance < best.distance)) {
          best = { nodeId: node.node_id, port: input.key, type: input.type, distance };
        }
      }
    }
    return best;
  };

  const addEdge = (sourceNodeId: string, sourcePort: string, sourceType: PortType, targetNodeId: string, targetPort: string, targetType: PortType) => {
    const nextOrder = Math.max(0, ...edges
      .filter((item) => item.target_node_id === targetNodeId && item.target_port === targetPort)
      .map((item) => item.order || 0)) + 1;
    const edge: CanvasEdge = {
      edge_id: newId('edge'),
      source_node_id: sourceNodeId,
      source_port: sourcePort,
      source_port_type: sourceType,
      target_node_id: targetNodeId,
      target_port: targetPort,
      target_port_type: targetType,
      order: nextOrder,
    };
    setEdges((prev) => [...prev.filter((item) => !(item.target_node_id === targetNodeId && item.target_port === targetPort && item.source_node_id === sourceNodeId)), edge]);
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.edge_id);
  };

  const handleCanvasWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const direction = event.deltaY > 0 ? -0.08 : 0.08;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((zoom + direction).toFixed(2))));
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - pan.x) / zoom;
    const worldY = (mouseY - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({ x: mouseX - worldX * nextZoom, y: mouseY - worldY * nextZoom });
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (resizingNode) {
      const dx = (event.clientX - resizingNode.startX) / zoom;
      const dy = (event.clientY - resizingNode.startY) / zoom;
      setNodes((prev) => prev.map((node) => node.node_id === resizingNode.nodeId ? {
        ...node,
        width: Math.max(220, resizingNode.width + dx),
        height: Math.max(150, resizingNode.height + dy),
      } : node));
      return;
    }
    if (draggingNode) {
      nodeDragMovedRef.current = true;
      const point = screenToWorld(event.clientX, event.clientY);
      setNodes((prev) => prev.map((node) => node.node_id === draggingNode.nodeId ? { ...node, x: point.x - draggingNode.dx, y: point.y - draggingNode.dy } : node));
      return;
    }
    if (connecting) {
      setConnecting({ ...connecting, pointer: screenToWorld(event.clientX, event.clientY) });
      return;
    }
    if (panning) {
      setPan({ x: event.clientX - panning.x, y: event.clientY - panning.y });
    }
  };

  const handleCanvasMouseMove = (event: React.MouseEvent) => {
    if (!leftPanelOpen && event.clientX <= SIDEBAR_OPEN_DISTANCE) {
      setLeftPanelOpen(true);
    }
    handleMouseMove(event);
  };

  const handleNodeHeaderMouseDown = (event: React.MouseEvent, node: CanvasNode) => {
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    nodeDragMovedRef.current = false;
    const point = screenToWorld(event.clientX, event.clientY);
    setDraggingNode({ nodeId: node.node_id, dx: point.x - node.x, dy: point.y - node.y });
  };

  const handleNodeContentMouseDown = (event: React.MouseEvent, node: CanvasNode) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-port]') || target.closest('button') || target.closest('input, textarea, select, video, audio')) return;
    const outputPort = getNodeOutputPort(node);
    if (!outputPort) return;
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    nodeDragMovedRef.current = false;
    setSelectedNodeId(node.node_id);
    setSelectedEdgeId(null);
    setConnecting({ nodeId: node.node_id, port: outputPort.key, type: outputPort.type, pointer: screenToWorld(event.clientX, event.clientY) });
  };

  const finishPointerAction = (event?: React.MouseEvent) => {
    if (connecting && event) {
      const target = findClosestCompatibleInput(event.clientX, event.clientY, connecting.nodeId, connecting.type);
      if (target) addEdge(connecting.nodeId, connecting.port, connecting.type, target.nodeId, target.port, target.type);
    }
    setConnecting(null);
    setDraggingNode(null);
    setResizingNode(null);
    setPanning(null);
  };

  const handleOutputPortClick = (nodeId: string, port: string, type: PortType) => {
    setConnecting({ nodeId, port, type, pointer: getPortPosition(nodeId, port, 'out') });
  };

  const handleInputPortClick = (nodeId: string, port: string, type: PortType) => {
    if (!connecting) return;
    if (connecting.nodeId === nodeId) {
      setConnecting(null);
      return;
    }
    if (connecting.type !== type) return;
    addEdge(connecting.nodeId, connecting.port, connecting.type, nodeId, port, type);
    setConnecting(null);
  };

  const removeEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((edge) => edge.edge_id !== edgeId));
    setSelectedEdgeId(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (selectedNodeId) {
        event.preventDefault();
        removeNode(selectedNodeId);
        return;
      }
      if (selectedEdgeId) {
        event.preventDefault();
        removeEdge(selectedEdgeId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEdgeId, selectedNodeId, nodes, edges]);

  const getPortPosition = (nodeId: string, port: string, side: 'in' | 'out') => {
    const node = nodes.find((item) => item.node_id === nodeId);
    if (!node) return { x: 0, y: 0 };
    const definition = getDefinition(node.type);
    const ports = side === 'in' ? definition.inputs : definition.outputs;
    const index = Math.max(0, ports.findIndex((item) => item.key === port));
    const gap = (node.height || NODE_HEIGHT) / (ports.length + 1 || 2);
    return {
      x: node.x + (side === 'out' ? (node.width || NODE_WIDTH) + 8 : -8),
      y: node.y + gap * (index + 1),
    };
  };

  const getIncomingEdges = (nodeId: string, targetPort?: string) => edges
    .filter((edge) => edge.target_node_id === nodeId && (!targetPort || edge.target_port === targetPort))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const getPortConnectionState = (nodeId: string, port: string, side: 'in' | 'out', type: PortType) => {
    const connected = edges.some((edge) => side === 'in'
      ? edge.target_node_id === nodeId && edge.target_port === port
      : edge.source_node_id === nodeId && edge.source_port === port);
    const connectingSource = side === 'out' && connecting?.nodeId === nodeId && connecting.port === port;
    const connectable = side === 'in' && Boolean(connecting) && connecting?.nodeId !== nodeId && connecting?.type === type;
    const incompatible = side === 'in' && Boolean(connecting) && !connectable;
    return { connected, connectingSource, connectable, incompatible };
  };

  const getPortClassName = (nodeId: string, port: string, side: 'in' | 'out', type: PortType) => {
    const state = getPortConnectionState(nodeId, port, side, type);
    const base = 'h-4 w-4 flex-shrink-0 rounded-full border-2 border-gray-950 shadow transition';
    if (state.connectingSource) return `${base} bg-yellow-300 ring-4 ring-yellow-300/30`;
    if (state.incompatible) return `${base} bg-gray-500 opacity-60`;
    if (state.connectable) return `${base} bg-blue-100 ring-4 ring-blue-400/35`;
    if (state.connected) return `${base} ${side === 'in' ? 'bg-blue-400' : 'bg-green-400'}`;
    return `${base} ${side === 'in' ? 'bg-blue-950 border-blue-400 hover:bg-blue-400' : 'bg-green-950 border-green-400 hover:bg-green-400'}`;
  };

  const moveInputEdge = (edgeId: string, direction: -1 | 1) => {
    const edge = edges.find((item) => item.edge_id === edgeId);
    if (!edge) return;
    const group = getIncomingEdges(edge.target_node_id, edge.target_port);
    const index = group.findIndex((item) => item.edge_id === edgeId);
    const swap = group[index + direction];
    if (!swap) return;
    setEdges((prev) => prev.map((item) => {
      if (item.edge_id === edge.edge_id) return { ...item, order: swap.order };
      if (item.edge_id === swap.edge_id) return { ...item, order: edge.order };
      return item;
    }));
  };

  const getNodePrimaryOutput = (node: CanvasNode): NodeOutput | undefined => {
    if (node.config.last_result) return node.config.last_result;
    if (node.type === 'static.image') return {
      image_id: node.config.image_id,
      image_url: node.config.image_url,
      media: node.config.image_id && node.config.existing_asset_audit_id ? [{
        type: 'image',
        id: node.config.image_id,
        url: node.config.image_url || '',
        name: node.config.asset_name || node.label,
        audit: {
          refType: 'image',
          refKey: node.config.image_id,
          assetId: node.config.existing_asset_audit_id,
          status: node.config.existing_asset_audit_status || 'Active',
        },
      }] : [],
    };
    if (node.type === 'static.video') return { video_url: node.config.media_url };
    if (node.type === 'static.audio') return { audio_url: node.config.media_url };
    return undefined;
  };

  const collectVisibleAuditStateForNode = (nodeId: string) => {
    const visible: Record<string, AssetAuditState> = {};
    const currentKeys = new Set<string>();
    getIncomingEdges(nodeId).forEach((edge) => {
      const source = nodes.find((item) => item.node_id === edge.source_node_id);
      if (!source) return;
      const output = getNodePrimaryOutput(source);
      const imageKey = output?.image_id ? `image:${output.image_id}` : '';
      const videoKey = output?.video_url ? `video:${output.video_url}` : '';
      if (imageKey) currentKeys.add(imageKey);
      if (videoKey) currentKeys.add(videoKey);
      Object.entries(source.config.audit_state || {}).forEach(([key, audit]) => {
        if (!currentKeys.has(key)) return;
        visible[key] = audit;
      });
      (output?.media || []).forEach((media) => {
        if (!media.audit) return;
        const key = media.type === 'image' && media.id ? `image:${media.id}` : media.type === 'video' ? `video:${media.url}` : '';
        if (key) visible[key] = media.audit;
      });
    });
    Object.entries(nodes.find((node) => node.node_id === nodeId)?.config.audit_state || {}).forEach(([key, audit]) => {
      if (currentKeys.has(key)) visible[key] = audit;
    });
    return visible;
  };

  const incomingOutputs = (nodeId: string, outputMap: Record<string, NodeOutput>) => {
    const inputs = edges
      .filter((edge) => edge.target_node_id === nodeId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    return inputs.map((edge) => outputMap[edge.source_node_id]).filter(Boolean);
  };

  const setStatus = (nodeId: string, status: RunStatus, error?: string) => {
    setNodeStatus((prev) => ({ ...prev, [nodeId]: { status, error } }));
  };

  const storeOutput = (nodeId: string, output: NodeOutput, inputHash?: string, auditState?: Record<string, AssetAuditState>) => {
    setOutputs((prev) => ({ ...prev, [nodeId]: output }));
    setNodes((prev) => prev.map((node) => node.node_id === nodeId ? {
      ...node,
      config: {
        ...node.config,
        last_result: output,
        ...(inputHash ? { input_hash: inputHash } : {}),
        ...(auditState ? { audit_state: auditState } : {}),
      },
    } : node));
  };

  const updateWorkingNodeConfig = (workingNodes: CanvasNode[], nodeId: string, patch: CanvasNode['config']) => {
    return workingNodes.map((node) => node.node_id === nodeId ? { ...node, config: { ...node.config, ...patch } } : node);
  };

  const executeNode = async (
    node: CanvasNode,
    inputOutputs: NodeOutput[],
    onPendingOutput?: (output: NodeOutput) => void,
  ): Promise<{ output: NodeOutput; auditState?: Record<string, AssetAuditState> }> => {
    if (node.type === 'static.image') {
      if (!node.config.image_id && !node.config.image_url) throw new Error('静态图片节点缺少图片');
      const audit = node.config.image_id && node.config.existing_asset_audit_id ? {
        refType: 'image' as const,
        refKey: node.config.image_id,
        assetId: node.config.existing_asset_audit_id,
        status: node.config.existing_asset_audit_status || 'Active',
        updatedAt: new Date().toISOString(),
      } : undefined;
      const media: RefMedia[] = [{
        type: 'image',
        id: node.config.image_id,
        url: node.config.image_url || '',
        name: node.config.asset_name || node.config.file_name || node.label,
        sourceAssetId: node.config.asset_id,
        sourceAssetType: node.config.asset_type,
        audit,
      }];
      return {
        output: { image_id: node.config.image_id, image_url: node.config.image_url, media },
        auditState: audit && node.config.image_id ? { [`image:${node.config.image_id}`]: audit } : undefined,
      };
    }

    if (node.type === 'static.video') {
      if (!node.config.media_url) throw new Error('静态视频节点缺少视频');
      const media: RefMedia[] = [{ type: 'video', id: node.config.media_id, url: node.config.media_url, name: node.config.file_name || node.label }];
      return { output: { video_url: node.config.media_url, media } };
    }

    if (node.type === 'static.audio') {
      if (!node.config.media_url) throw new Error('静态音频节点缺少音频');
      const media: RefMedia[] = [{ type: 'audio', id: node.config.media_id, url: node.config.media_url, name: node.config.file_name || node.label }];
      return { output: { audio_url: node.config.media_url, media } };
    }

    const inputText = inputOutputs.map(textFromOutput).filter(Boolean).join('\n');
    const prompt = mergePrompt(node.config.prompt, inputText);

    if (node.type === 'gen.llm') {
      if (!prompt) throw new Error('LLM 节点缺少提示词');
      const text = await readChatStream(projectId, prompt);
      return { output: { text, raw: { prompt } } };
    }

    if (node.type === 'gen.image') {
      if (!prompt) throw new Error('文生图节点缺少提示词');
      const response = await generationApi.generateCanvasImage(projectId, {
        prompt,
        negative_prompt: node.config.negative_prompt || '',
        size: node.config.size,
        model: imageApiType === 'createnow' ? node.config.model : undefined,
      });
      const record = response.data;
      const imageUrl = getImageUrlFromRecord(projectId, record);
      return { output: {
        image_id: record.image_id,
        image_url: imageUrl,
        media: [{ type: 'image', id: record.image_id, url: imageUrl, name: record.prompt || node.label }],
        raw: record,
      } };
    }

    if (node.type === 'gen.image_edit') {
      const referenceImageIds = inputOutputs.map((output) => output.image_id).filter(Boolean) as string[];
      const referenceImageUrls = inputOutputs.map((output) => output.image_url).filter(Boolean) as string[];
      if (!prompt) throw new Error('图生图节点缺少提示词');
      if (!referenceImageIds.length && !referenceImageUrls.length) throw new Error('图生图节点缺少参考图');
      const response = await generationApi.editCanvasImage(projectId, {
        prompt,
        size: node.config.size,
        referenceImageIds,
        referenceImageUrls,
        model: imageApiType === 'createnow' ? node.config.model : undefined,
      });
      const record = response.data;
      const imageUrl = getImageUrlFromRecord(projectId, record);
      return { output: {
        image_id: record.image_id,
        image_url: imageUrl,
        media: [{ type: 'image', id: record.image_id, url: imageUrl, name: record.prompt || node.label }],
        raw: record,
      } };
    }

    if (isVideoNode(node.type)) {
      if (!prompt) throw new Error('视频节点缺少提示词');
      const media = inputOutputs.flatMap((output) => output.media || []);
      const imageIds = inputOutputs.map((output) => output.image_id).filter(Boolean) as string[];
      const videoUrls = [
        ...inputOutputs.map((output) => output.video_url).filter(Boolean) as string[],
        ...media.filter((item) => item.type === 'video').map((item) => item.url),
      ];
      const audioUrls = [
        ...inputOutputs.map((output) => output.audio_url).filter(Boolean) as string[],
        ...media.filter((item) => item.type === 'audio').map((item) => item.url),
      ];
      const upstreamAuditState = media.reduce<Record<string, AssetAuditState>>((acc, item) => {
        if (item.audit && item.type === 'image' && item.id) acc[`image:${item.id}`] = item.audit;
        if (item.audit && item.type === 'video' && item.url) acc[`video:${item.url}`] = item.audit;
        return acc;
      }, {});
      const prepared = showAssetSubmit
        ? await prepareReferenceAssets(imageIds, videoUrls, { ...upstreamAuditState, ...(node.config.audit_state || {}) })
        : { imageIds, videoUrls, auditState: { ...upstreamAuditState, ...(node.config.audit_state || {}) } };
      const response = await generationApi.generateCanvasVideo(projectId, {
        storyboard_id: null,
        episode_id: null,
        image_ids: prepared.imageIds,
        video_urls: prepared.videoUrls.length ? prepared.videoUrls : undefined,
        audio_urls: audioUrls.length ? audioUrls : undefined,
        prompt,
        duration: node.config.duration || 6,
        resolution: node.config.resolution || '720p',
        ratio: node.config.ratio || '16:9',
        generate_audio: node.config.generate_audio,
        reference_media: media,
        model: videoApiType === 'createnow' ? node.config.model : undefined,
      });
      let video = response.data;
      if (video.video_id) {
        onPendingOutput?.(buildVideoNodeOutput(projectId, video, node.label));
        video = await pollVideoUntilDone(video.video_id);
      }
      return { output: buildVideoNodeOutput(projectId, video, node.label), auditState: prepared.auditState };
    }

    throw new Error(`不支持的节点类型：${node.type}`);
  };

  const pollVideoUntilDone = async (videoId: string) => {
    let current: any = null;
    for (let i = 0; i < 80; i += 1) {
      const response = await generationApi.pollVideo(projectId, videoId);
      current = response.data;
      if (!isPendingVideoStatus(current.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    if (current?.status === 'failed') throw new Error(current.error || '视频生成失败');
    return current;
  };

  const syncVideoOutputToCanvasNodes = async (videoRecord: any) => {
    if (!videoRecord?.video_id) return false;
    let nextNodes: CanvasNode[] | null = null;
    const output = buildVideoNodeOutput(projectId, videoRecord, '视频结果');
    setNodes((currentNodes) => {
      let didUpdate = false;
      const updatedNodes = currentNodes.map((node) => {
        if (node.config.last_result?.video_id !== videoRecord.video_id) return node;
        const currentOutput = node.config.last_result;
        if (currentOutput?.video_url === output.video_url && getOutputStatus(currentOutput) === getOutputStatus(output)) return node;
        didUpdate = true;
        return {
          ...node,
          config: {
            ...node.config,
            last_result: output,
          },
        };
      });
      if (didUpdate) nextNodes = updatedNodes;
      return didUpdate ? updatedNodes : currentNodes;
    });
    if (!nextNodes) return false;
    setOutputs((prev) => {
      const next = { ...prev };
      nextNodes!.forEach((node) => {
        if (node.config.last_result?.video_id === videoRecord.video_id) {
          next[node.node_id] = output;
        }
      });
      return next;
    });
    await saveCanvas(true, nextNodes, edges);
    return true;
  };

  const continuePollingHistoryVideo = async (videoId: string, silent = false, force = false) => {
    if (force) {
      pollingVideoIdsRef.current.delete(videoId);
      setPollingVideoIds(new Set(pollingVideoIdsRef.current));
    }
    if (pollingVideoIdsRef.current.has(videoId)) return;
    pollingVideoIdsRef.current.add(videoId);
    setPollingVideoIds(new Set(pollingVideoIdsRef.current));
    try {
      const updated = await pollVideoUntilDone(videoId);
      setHistoryVideos((prev) => prev.map((video) => video.video_id === videoId ? { ...video, ...updated } : video));
      await syncVideoOutputToCanvasNodes(updated);
      if (!silent) toast('视频轮询已更新', 'success');
    } catch (error: any) {
      if (!silent) toast(error?.response?.data?.detail || error?.message || '视频轮询失败', 'error');
    } finally {
      pollingVideoIdsRef.current.delete(videoId);
      setPollingVideoIds(new Set(pollingVideoIdsRef.current));
      await loadCanvasHistory();
    }
  };

  useEffect(() => {
    if (rightPanelTab !== 'history') return;
    const resumable = historyVideos.filter((video) => isPendingVideoStatus(video.status) && !pollingVideoIdsRef.current.has(video.video_id));
    resumable.slice(0, 3).forEach((video) => {
      continuePollingHistoryVideo(video.video_id, true);
    });
  }, [rightPanelTab, historyVideos]);

  const prepareReferenceAssets = async (
    imageIds: string[],
    videoUrls: string[],
    currentAuditState: Record<string, AssetAuditState>,
  ) => {
    const auditState: Record<string, AssetAuditState> = { ...currentAuditState };
    const imageKeys = imageIds.map((imageId) => `image:${imageId}`);
    const videoKeys = videoUrls.map((url) => `video:${url}`);
    const activeImageIds = imageIds.filter((imageId) => auditState[`image:${imageId}`]?.status === 'Active');
    const activeVideoUrls = videoUrls.filter((url) => auditState[`video:${url}`]?.status === 'Active' && auditState[`video:${url}`]?.assetId);
    const pendingImageIds = imageIds.filter((imageId) => !activeImageIds.includes(imageId));
    const pendingVideoUrls = videoUrls.filter((url) => !activeVideoUrls.includes(url));

    if (pendingImageIds.length || pendingVideoUrls.length) {
      const submit = await generationApi.submitAsset(projectId, {
        image_ids: pendingImageIds,
        video_urls: pendingVideoUrls,
        project_name: 'default',
      });
      const records: any[] = [
        ...(submit.data.submitted || []),
        ...(submit.data.skipped || []).filter((item: any) => typeof item === 'object'),
      ];
      records.forEach((record) => {
        const key = record.image_id ? `image:${record.image_id}` : record.video_url ? `video:${record.video_url}` : '';
        if (!key) return;
        auditState[key] = {
          refType: record.image_id ? 'image' : 'video',
          refKey: record.image_id || record.video_url,
          assetId: record.asset_id,
          status: record.status || auditState[key]?.status || 'Processing',
          updatedAt: new Date().toISOString(),
        };
      });
    }

    const keysToPoll = [...imageKeys, ...videoKeys].filter((key) => auditState[key]?.assetId && auditState[key]?.status !== 'Active');
    for (const key of keysToPoll) {
      const assetId = auditState[key].assetId!;
      let latestStatus = auditState[key].status || 'Processing';
      let latestError = auditState[key].error;
      for (let i = 0; i < 30; i += 1) {
        const response = await generationApi.getAssetStatus(projectId, assetId);
        latestStatus = response.data.status || latestStatus;
        latestError = response.data.error || response.data.message || latestError;
        auditState[key] = { ...auditState[key], status: latestStatus, error: latestError, updatedAt: new Date().toISOString() };
        if (latestStatus === 'Active' || latestStatus === 'Failed') break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    const failed = [...imageKeys, ...videoKeys].filter((key) => auditState[key]?.status !== 'Active');
    if (failed.length) {
      const detail = failed.map((key) => `${key}=${auditState[key]?.status || '未提交'}`).join('，');
      const error = new Error(`素材审核未通过：${detail}`) as Error & { auditState?: Record<string, AssetAuditState> };
      error.auditState = auditState;
      throw error;
    }

    return {
      imageIds,
      videoUrls: videoUrls.map((url) => {
        const audit = auditState[`video:${url}`];
        return audit?.assetId ? `asset://${audit.assetId}` : url;
      }),
      auditState,
    };
  };

  const runWorkflow = async (mode: RunMode = 'continue') => {
    if (running) return;
    const order = buildTopologicalOrder(nodes, edges);
    if (!nodes.length) {
      toast('请先添加节点', 'error');
      return;
    }
    if (!order.length) {
      toast('工作流存在环路，请检查连线', 'error');
      return;
    }
    if (mode === 'from-selected' && !selectedNodeId) {
      toast('请先选择要重跑的节点', 'error');
      return;
    }
    const forceRerunIds = mode === 'all'
      ? new Set(nodes.filter((node) => isDynamicNode(node.type)).map((node) => node.node_id))
      : mode === 'from-selected' && selectedNodeId
        ? collectDownstreamNodeIds(selectedNodeId, edges)
        : new Set<string>();
    setRunning(true);
    setNodeStatus(Object.fromEntries(nodes.map((node) => [node.node_id, { status: 'idle' as RunStatus }])));
    const outputMap: Record<string, NodeOutput> = {};
    try {
      await saveCanvas(true);
      await canvasApi.validateWorkflow(projectId, activeCanvasId);
      let workingNodes = nodes;
      for (const nodeId of order) {
        let node = workingNodes.find((item) => item.node_id === nodeId);
        if (!node) continue;
        const inputs = incomingOutputs(nodeId, outputMap);
        const inputHash = buildInputHash(node, inputs);
        if (
          !forceRerunIds.has(nodeId) &&
          isDynamicNode(node.type) &&
          node.config.input_hash === inputHash &&
          canReuseNodeOutput(node, node.config.last_result)
        ) {
          outputMap[nodeId] = node.config.last_result!;
          setStatus(nodeId, 'succeeded');
          continue;
        }
        setStatus(nodeId, 'running');
        try {
          const result = await executeNode(node, inputs, async (pendingOutput) => {
            outputMap[nodeId] = pendingOutput;
            workingNodes = updateWorkingNodeConfig(workingNodes, nodeId, {
              last_result: pendingOutput,
              input_hash: inputHash,
            });
            setNodes(workingNodes);
            setOutputs((prev) => ({ ...prev, [nodeId]: pendingOutput }));
            await saveCanvas(true, workingNodes, edges);
          });
          outputMap[nodeId] = result.output;
          workingNodes = updateWorkingNodeConfig(workingNodes, nodeId, {
            last_result: result.output,
            input_hash: inputHash,
            ...(result.auditState ? { audit_state: result.auditState } : {}),
          });
          storeOutput(nodeId, result.output, inputHash, result.auditState);
          setStatus(nodeId, 'succeeded');
        } catch (nodeError: any) {
          const auditState = nodeError?.auditState as Record<string, AssetAuditState> | undefined;
          if (auditState) {
            workingNodes = updateWorkingNodeConfig(workingNodes, nodeId, { audit_state: auditState });
            setNodes(workingNodes);
            await saveCanvas(true, workingNodes, edges);
          }
          throw { nodeId, message: nodeError?.message || '节点运行失败' };
        }
      }
      await saveCanvas(true, workingNodes, edges);
      await loadCanvasHistory();
      toast('工作流运行完成', 'success');
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || '工作流运行失败';
      toast(message, 'error');
      if (error?.nodeId) setStatus(error.nodeId, 'failed', message);
    } finally {
      setRunning(false);
    }
  };

  const openUpload = (target: 'image' | 'video' | 'audio') => {
    if (!selectedNode) return;
    uploadTargetRef.current = { nodeId: selectedNode.node_id, target };
    setUploadTarget(target);
    fileInputRef.current?.click();
  };

  const handleUpload = async (file: File) => {
    const targetInfo = uploadTargetRef.current;
    const targetNode = targetInfo ? nodes.find((node) => node.node_id === targetInfo.nodeId) : null;
    if (!targetInfo || !targetNode) return;
    try {
      if (targetInfo.target === 'image') {
        const response = await generationApi.uploadImage(projectId, {
          asset_id: crypto.randomUUID(),
          asset_type: 'storyboard',
          file,
          prompt: '画布上传',
        });
        const record = response.data;
        const imageUrl = getImageUrlFromRecord(projectId, record);
        const output: NodeOutput = {
          image_id: record.image_id,
          image_url: imageUrl,
          media: [{ type: 'image', id: record.image_id, url: imageUrl, name: file.name }],
          raw: record,
        };
        const nextNodes = updateStaticNodeConfig(targetInfo.nodeId, {
          image_id: record.image_id,
          image_url: imageUrl,
          file_name: file.name,
        }, output);
        await saveCanvas(true, nextNodes, edges);
      } else {
        const response = await generationApi.uploadMedia(projectId, file);
        const record = response.data;
        const mediaUrl = getBackendMediaUrl(record.url || '');
        const output: NodeOutput = targetInfo.target === 'video'
          ? { video_url: mediaUrl, media: [{ type: 'video', id: record.media_id, url: mediaUrl, name: file.name }], raw: record }
          : { audio_url: mediaUrl, media: [{ type: 'audio', id: record.media_id, url: mediaUrl, name: file.name }], raw: record };
        const nextNodes = updateStaticNodeConfig(targetInfo.nodeId, {
          media_id: record.media_id,
          media_url: mediaUrl,
          media_type: record.media_type,
          file_name: file.name,
        }, output);
        await saveCanvas(true, nextNodes, edges);
      }
      toast('上传成功', 'success');
    } catch (error: any) {
      toast(error?.response?.data?.detail || '上传失败', 'error');
    } finally {
      uploadTargetRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const selectAssetForNode = (asset: any, assetType: CanvasAssetType) => {
    if (!selectedNode) return;
    const imageUrl = getBackendMediaUrl(getAssetImageUrl(asset));
    if (!asset.image_id && !imageUrl) {
      toast('该资产暂无主图', 'error');
      return;
    }
    const existingAuditState = asset.image_id && asset.volcengine_asset_id ? {
      [`image:${asset.image_id}`]: {
        refType: 'image' as const,
        refKey: asset.image_id,
        assetId: asset.volcengine_asset_id,
        status: asset.volcengine_asset_status || 'Active',
        updatedAt: new Date().toISOString(),
      },
    } : undefined;
    const output: NodeOutput = {
      image_id: asset.image_id,
      image_url: imageUrl,
      media: [{
        type: 'image',
        id: asset.image_id,
        url: imageUrl,
        name: asset.name || selectedNode.label,
        audit: existingAuditState && asset.image_id ? existingAuditState[`image:${asset.image_id}`] : undefined,
      }],
    };
    const nextNodes = updateStaticNodeConfig(selectedNode.node_id, {
      image_id: asset.image_id,
      image_url: imageUrl,
      asset_id: asset.asset_id,
      asset_type: assetType,
      asset_name: asset.name,
      existing_asset_audit_id: asset.volcengine_asset_id,
      existing_asset_audit_status: asset.volcengine_asset_status,
      ...(existingAuditState ? { audit_state: existingAuditState } : {}),
    }, output);
    void saveCanvas(true, nextNodes, edges);
    setAssetPickerOpen(false);
  };

  const renderNodePreview = (node: CanvasNode, compact = false) => {
    const output = pickRenderableOutput(outputs[node.node_id], node.config.last_result);
    const imageUrl = output?.image_url || node.config.image_url;
    const videoUrl = output?.video_url || (node.config.media_type === 'video' ? node.config.media_url : '');
    const videoStatus = getOutputStatus(output);
    const videoId = output?.video_id;
    const audioUrl = output?.audio_url || (node.config.media_type === 'audio' ? node.config.media_url : '');
    const text = output?.text;
    const previewHeight = compact ? 112 : Math.max(80, (node.height || NODE_HEIGHT) - 96);
    if (imageUrl) return (
      <div className="group relative w-full overflow-hidden rounded-lg bg-gray-950" style={{ height: previewHeight }}>
        <img src={imageUrl} alt={node.label} draggable={false} className="h-full w-full object-cover" />
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); setPreviewImage({ url: imageUrl, title: node.label }); }}
          className="absolute left-1/2 top-1/2 hidden h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white shadow-2xl ring-1 ring-white/30 hover:bg-black/90 group-hover:flex"
          title="放大查看"
        >
          <ZoomIn size={28} />
        </button>
      </div>
    );
    if (videoUrl) return (
      <div className="relative w-full overflow-hidden rounded-lg bg-gray-950" style={{ height: previewHeight }}>
        <video src={videoUrl} draggable={false} className="h-full w-full bg-black object-cover" controls />
      </div>
    );
    if (isVideoNode(node.type) && videoId) {
      const isFailed = ['failed', 'error'].includes(videoStatus);
      return (
        <div className={`flex h-20 flex-col items-center justify-center rounded-lg border text-xs ${isFailed ? 'border-red-800 bg-red-950/30 text-red-300' : 'border-blue-900 bg-blue-950/30 text-blue-300'}`}>
          <div className="font-medium">{isFailed ? '视频生成失败' : '视频生成中'}</div>
          <div className="mt-1 text-[10px] text-gray-500">{videoId.slice(0, 8)} · {videoStatus || 'pending'}</div>
        </div>
      );
    }
    if (audioUrl) return <div className="rounded-lg bg-gray-950 p-2"><audio src={audioUrl} controls className="w-full" /></div>;
    if (text) return <div className="line-clamp-4 rounded-lg bg-gray-950 p-2 text-xs text-gray-300">{text}</div>;
    return <div className="flex h-20 items-center justify-center rounded-lg bg-gray-950 text-xs text-gray-500">暂无结果</div>;
  };

  const renderAuditState = (node: CanvasNode) => {
    const entries = Object.entries(isVideoNode(node.type) ? collectVisibleAuditStateForNode(node.node_id) : (node.config.audit_state || {}));
    if (!entries.length) return null;
    return (
      <div className="mt-3 rounded-lg border border-gray-800 bg-gray-950 p-3">
        <div className="mb-2 text-xs font-medium text-gray-300">素材审核状态</div>
        <div className="space-y-2">
          {entries.map(([key, audit]) => (
            <div key={key} className="rounded bg-gray-900 p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-gray-300">{key}</span>
                <span className={audit.status === 'Active' ? 'text-green-300' : audit.status === 'Failed' ? 'text-red-300' : 'text-yellow-300'}>
                  {audit.status || '未知'}
                </span>
              </div>
              {audit.assetId && <div className="mt-1 truncate text-[10px] text-gray-500">asset: {audit.assetId}</div>}
              {audit.error && <div className="mt-1 text-[10px] text-red-300">{audit.error}</div>}
            </div>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-gray-500">审核失败时再次运行会复用上游已生成图片，只重新处理这些素材。</div>
      </div>
    );
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center bg-gray-950 text-gray-300"><Loader2 className="mr-2 animate-spin" />加载画布...</div>;
  }

  return (
    <div className="relative flex h-full min-h-0 bg-gray-950 text-white">
      <div
        className="pointer-events-none absolute left-0 top-0 z-40 h-full"
        style={{ width: 6 }}
      />
      <div className="pointer-events-none absolute left-0 top-1/2 z-40 -translate-y-1/2 rounded-r-lg border border-l-0 border-gray-700 bg-gray-900 px-1 py-6 text-[10px] text-gray-500">节点</div>
      {leftPanelOpen && (
        <div
          className="absolute left-0 top-0 z-50 h-full overflow-hidden border-r border-gray-800 bg-gray-900 shadow-2xl"
          style={{ width: 288 }}
          onMouseLeave={() => setLeftPanelOpen(false)}
        >
          <div className="flex h-full flex-col" style={{ width: 288 }}>
        <div className="border-b border-gray-800 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-lg font-semibold">新画布</div>
            <button onClick={createCanvas} className="rounded-lg bg-blue-600 p-2 hover:bg-blue-500" title="新建画布"><Plus size={16} /></button>
          </div>
          <select value={activeCanvasId} onChange={(event) => switchCanvas(event.target.value)} className="mb-2 w-full rounded bg-gray-950 px-3 py-2 text-sm outline-none ring-1 ring-gray-700">
            {canvases.map((canvas) => <option key={canvas.canvas_id} value={canvas.canvas_id}>{canvas.name}</option>)}
          </select>
          <input value={canvasName} onChange={(event) => setCanvasName(event.target.value)} className="w-full rounded bg-gray-950 px-3 py-2 text-sm outline-none ring-1 ring-gray-700" />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={() => saveCanvas(false)} disabled={saving} className="flex items-center justify-center gap-1 rounded bg-gray-700 px-2 py-2 text-xs hover:bg-gray-600 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}保存
            </button>
            <button onClick={() => runWorkflow('continue')} disabled={running} className="flex items-center justify-center gap-1 rounded bg-green-700 px-2 py-2 text-xs hover:bg-green-600 disabled:opacity-50">
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}继续
            </button>
            <button onClick={deleteCanvas} className="flex items-center justify-center gap-1 rounded bg-red-900/60 px-2 py-2 text-xs text-red-200 hover:bg-red-900">
              <Trash2 size={14} />删除
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              onClick={() => runWorkflow('from-selected')}
              disabled={running || !selectedNodeId}
              className="rounded bg-gray-800 px-2 py-2 text-xs text-gray-200 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-45"
              title="重跑当前选中节点及其下游"
            >
              从选中重跑
            </button>
            <button
              onClick={() => runWorkflow('all')}
              disabled={running}
              className="rounded bg-gray-800 px-2 py-2 text-xs text-gray-200 hover:bg-gray-700 disabled:opacity-50"
              title="重跑所有动态节点"
            >
              全部重跑
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 text-sm font-medium text-gray-300">添加节点</div>
          <div className="space-y-2">
            {NODE_DEFINITIONS.map((definition) => {
              const Icon = definition.icon;
              return (
                <button key={definition.type} onClick={() => addNode(definition.type)} className="w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-left hover:border-blue-500 hover:bg-gray-750">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-lg bg-gradient-to-br ${definition.color} p-2`}><Icon size={16} /></span>
                    <span className="text-sm font-medium">{definition.label}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{definition.description}</div>
                </button>
              );
            })}
          </div>
        </div>
        </div>
        </div>
      )}

      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/90 px-3 py-2 text-xs text-gray-300 shadow-lg">
          <span>缩放 {Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(1)} className="rounded bg-gray-700 px-2 py-1 hover:bg-gray-600">重置</button>
          {connecting && <span className="text-blue-300">正在连接：{connecting.type}</span>}
          {selectedEdgeId && <button onClick={() => removeEdge(selectedEdgeId)} className="rounded bg-red-800 px-2 py-1 text-red-100 hover:bg-red-700">删除连线</button>}
        </div>

        <div
          ref={canvasRef}
          className="h-full w-full cursor-grab select-none overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.22)_1px,transparent_0)] [background-size:24px_24px]"
          onWheel={handleCanvasWheel}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              window.getSelection()?.removeAllRanges();
              setPanning({ x: event.clientX - pan.x, y: event.clientY - pan.y });
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
              setRightPanelTab('node');
            }
          }}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={finishPointerAction}
          onMouseLeave={finishPointerAction}
        >
          <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', width: 1, height: 1 }}>
            <svg className="pointer-events-none absolute left-0 top-0 h-[6000px] w-[6000px] overflow-visible">
              {edges.map((edge) => {
                const start = getPortPosition(edge.source_node_id, edge.source_port, 'out');
                const end = getPortPosition(edge.target_node_id, edge.target_port, 'in');
                const dx = Math.max(80, Math.abs(end.x - start.x) / 2);
                const path = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
                const selected = selectedEdgeId === edge.edge_id;
                return (
                  <g key={edge.edge_id} className="pointer-events-auto cursor-pointer" onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.edge_id); setSelectedNodeId(null); }}>
                    <path d={path} stroke="transparent" strokeWidth={EDGE_HIT_STROKE} fill="none" />
                    <path d={path} stroke={selected ? '#60a5fa' : '#64748b'} strokeWidth={selected ? 3 : 2} fill="none" />
                    {edge.order != null && (
                      <g transform={`translate(${end.x - 22}, ${end.y - 10})`}>
                        <circle cx="8" cy="8" r="8" fill={selected ? '#60a5fa' : '#1e293b'} stroke="#64748b" strokeWidth="1" />
                        <text x="8" y="11" textAnchor="middle" fontSize="9" fill="#fff">{edge.order}</text>
                      </g>
                    )}
                  </g>
                );
              })}
              {connecting && connecting.pointer && (() => {
                const start = getPortPosition(connecting.nodeId, connecting.port, 'out');
                const end = connecting.pointer;
                const dx = Math.max(80, Math.abs(end.x - start.x) / 2);
                const path = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
                return <path d={path} stroke="#60a5fa" strokeWidth="3" strokeDasharray="8 8" strokeOpacity="0.5" fill="none" pointerEvents="none" />;
              })()}
            </svg>

            {nodes.map((node) => {
              const definition = getDefinition(node.type);
              const Icon = definition.icon;
              const state = nodeStatus[node.node_id]?.status || 'idle';
              return (
                <div
                  key={node.node_id}
                  data-node-id={node.node_id}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (nodeDragMovedRef.current) {
                      nodeDragMovedRef.current = false;
                      return;
                    }
                    setSelectedNodeId(node.node_id);
                    setSelectedEdgeId(null);
                    setRightPanelTab('node');
                  }}
                  className={`absolute select-none rounded-xl border bg-gray-900 shadow-2xl transition ${selectedNodeId === node.node_id ? 'border-blue-400 ring-2 ring-blue-400/30' : 'border-gray-700'} ${state === 'running' ? 'ring-2 ring-yellow-400/40' : ''} ${state === 'failed' ? 'border-red-500' : ''}`}
                  style={{ left: node.x, top: node.y, width: node.width || NODE_WIDTH, minHeight: node.height || NODE_HEIGHT }}
                >
                  <div
                    className={`cursor-move rounded-t-xl bg-gradient-to-r ${definition.color} px-3 py-2`}
                    onMouseDown={(event) => handleNodeHeaderMouseDown(event, node)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold"><Icon size={16} />{node.label}</div>
                      {state === 'running' && <Loader2 size={16} className="animate-spin" />}
                      {state === 'succeeded' && <CheckCircle size={16} />}
                      {state === 'failed' && <X size={16} />}
                    </div>
                  </div>

                  {definition.inputs.map((port, index) => (
                    <button
                      key={port.key}
                      data-port="in"
                      onClick={(event) => { event.stopPropagation(); handleInputPortClick(node.node_id, port.key, port.type); }}
                      className="absolute -left-3 flex items-center gap-1 rounded-full bg-gray-950/95 px-1.5 py-0.5 text-[10px] text-blue-100 ring-1 ring-blue-500/70 shadow-lg hover:bg-blue-950"
                      style={{ top: ((node.height || NODE_HEIGHT) / (definition.inputs.length + 1)) * (index + 1) - 10 }}
                      title={`${port.label} (${port.type})`}
                    >
                      <span className={getPortClassName(node.node_id, port.key, 'in', port.type)} />
                      <span>{port.label}</span>
                    </button>
                  ))}
                  {definition.outputs.map((port, index) => (
                    <button
                      key={port.key}
                      data-port="out"
                      onClick={(event) => { event.stopPropagation(); handleOutputPortClick(node.node_id, port.key, port.type); }}
                      className="absolute -right-3 flex items-center gap-1 rounded-full bg-gray-950/95 px-1.5 py-0.5 text-[10px] text-green-100 ring-1 ring-green-500/70 shadow-lg hover:bg-green-950"
                      style={{ top: ((node.height || NODE_HEIGHT) / (definition.outputs.length + 1)) * (index + 1) - 10 }}
                      title={`${port.label} (${port.type})`}
                    >
                      <span>{port.label}</span>
                      <span className={getPortClassName(node.node_id, port.key, 'out', port.type)} />
                    </button>
                  ))}

                  <div className="space-y-2 p-3" onMouseDown={(event) => handleNodeContentMouseDown(event, node)}>
                    <div className="text-xs text-gray-400">{definition.description}</div>
                    {renderNodePreview(node)}
                    <div className="flex flex-wrap gap-1 text-[10px] text-gray-500">
                      {definition.inputs.map((port) => <span key={`in-${port.key}`} className="rounded bg-blue-950 px-1.5 py-0.5">入:{port.label}</span>)}
                      {definition.outputs.map((port) => <span key={`out-${port.key}`} className="rounded bg-green-950 px-1.5 py-0.5">出:{port.label}</span>)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      window.getSelection()?.removeAllRanges();
                      setResizingNode({
                        nodeId: node.node_id,
                        startX: event.clientX,
                        startY: event.clientY,
                        width: node.width || NODE_WIDTH,
                        height: node.height || NODE_HEIGHT,
                      });
                    }}
                    className="absolute bottom-1 right-1 h-4 w-4 cursor-se-resize rounded-sm border border-white/40 bg-white/20 hover:bg-white/40"
                    title="缩放节点"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selectedNode && (
        <div className="w-80 flex-shrink-0 overflow-y-auto border-l border-gray-800 bg-gray-900">
        <div className="sticky top-0 z-10 flex border-b border-gray-800 bg-gray-900">
          <button
            onClick={() => setRightPanelTab('node')}
            className={`flex-1 px-4 py-3 text-sm ${rightPanelTab === 'node' ? 'border-b-2 border-blue-400 text-blue-300' : 'text-gray-400 hover:text-gray-200'}`}
          >
            节点
          </button>
          <button
            onClick={() => setRightPanelTab('history')}
            className={`flex-1 px-4 py-3 text-sm ${rightPanelTab === 'history' ? 'border-b-2 border-blue-400 text-blue-300' : 'text-gray-400 hover:text-gray-200'}`}
          >
            历史
          </button>
        </div>
        {rightPanelTab === 'node' ? (
          <CanvasPropertyPanel
            selectedNode={selectedNode}
            nodes={nodes}
            nodeError={selectedNode ? nodeStatus[selectedNode.node_id]?.error : undefined}
            imageApiType={imageApiType}
            videoApiType={videoApiType}
            getIncomingEdges={getIncomingEdges}
            moveInputEdge={moveInputEdge}
            removeNode={removeNode}
            updateNodeLabel={updateNodeLabel}
            updateNodeConfig={updateNodeConfig}
            renderNodePreview={renderNodePreview}
            renderAuditState={renderAuditState}
            onOpenAssetPicker={() => setAssetPickerOpen(true)}
            onOpenUpload={openUpload}
          />
        ) : (
          <CanvasHistoryPanel
            projectId={projectId}
            historyItems={historyItems}
            historyLoading={historyLoading}
            pollingVideoIds={pollingVideoIds}
            onRefresh={loadCanvasHistory}
            onPreviewImage={setPreviewImage}
            onSelectTextNode={(nodeId) => { setSelectedNodeId(nodeId); setRightPanelTab('node'); }}
            onContinuePollingVideo={(videoId) => continuePollingHistoryVideo(videoId, false, true)}
          />
        )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={uploadTarget === 'image' ? 'image/*' : uploadTarget === 'video' ? 'video/*' : 'audio/*'}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleUpload(file);
        }}
      />

      {previewImage && (
        <ImagePreviewModal
          imageUrl={previewImage.url}
          title={previewImage.title}
          subtitle={previewImage.imageId}
          zIndexClassName="z-[90]"
          onClose={() => setPreviewImage(null)}
        />
      )}

      {assetPickerOpen && selectedNode && (
        <CanvasAssetPickerDialog
          assetTab={assetTab}
          characters={characters}
          scenes={scenes}
          props={props}
          storyboards={storyboards}
          selectedNode={selectedNode}
          onAssetTabChange={setAssetTab}
          onSelectAsset={selectAssetForNode}
          onClose={() => setAssetPickerOpen(false)}
        />
      )}
    </div>
  );
}
