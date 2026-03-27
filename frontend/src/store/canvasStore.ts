import { create } from 'zustand';
import { canvasApi, assetApi } from '@/services/api';
import type {
  Canvas,
  CanvasElementData,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRun,
  WorkflowValidationResult,
} from '@/types/canvas';

interface CanvasStore {
  // 状态
  canvasList: Canvas[];
  activeCanvasId: string | null;
  canvasElements: Record<string, CanvasElementData>;
  selectedIds: string[];
  selectedNodeId: string | null;
  workflowRuns: Record<string, WorkflowRun[]>; // key: canvasId
  activeRun: WorkflowRun | null;
  loading: boolean;
  error: string | null;

  // 画布操作
  fetchCanvasList: (projectId: string) => Promise<void>;
  createCanvas: (projectId: string, name: string, description?: string) => Promise<Canvas | null>;
  updateCanvas: (projectId: string, canvasId: string, data: any) => Promise<void>;
  deleteCanvas: (projectId: string, canvasId: string) => Promise<void>;
  setActiveCanvas: (canvasId: string) => void;

  // 布局操作
  updateLayout: (projectId: string, canvasId: string, layout: any) => Promise<void>;

  // 选择操作
  selectElement: (id: string, multi: boolean) => void;
  clearSelection: () => void;
  setSelectedNode: (nodeId: string | null) => void;

  // workflow 结构操作
  upsertNode: (projectId: string, canvasId: string, node: WorkflowNode) => Promise<void>;
  removeNode: (projectId: string, canvasId: string, nodeId: string) => Promise<void>;
  upsertEdge: (projectId: string, canvasId: string, edge: WorkflowEdge) => Promise<void>;
  removeEdge: (projectId: string, canvasId: string, edgeId: string) => Promise<void>;
  setWorkflowVariables: (projectId: string, canvasId: string, variables: Record<string, any>) => Promise<void>;

  // workflow 运行
  validateWorkflow: (projectId: string, canvasId: string) => Promise<WorkflowValidationResult | null>;
  runWorkflow: (projectId: string, canvasId: string) => Promise<WorkflowRun | null>;
  cancelWorkflowRun: (projectId: string, canvasId: string, runId: string) => Promise<void>;
  fetchWorkflowRuns: (projectId: string, canvasId: string, limit?: number) => Promise<void>;
  fetchWorkflowRun: (projectId: string, canvasId: string, runId: string) => Promise<WorkflowRun | null>;

  // 画布元素操作
  fetchCanvasElements: (projectId: string) => Promise<void>;
  createCanvasElement: (projectId: string, data: any, position?: { x: number; y: number }) => Promise<string>;
  deleteCanvasElement: (projectId: string, elementId: string) => Promise<void>;
  removeElementFromCanvas: (projectId: string, elementId: string) => Promise<void>;

  // 重置
  reset: () => void;
}

const ensureWorkflowDefaults = (canvas: Canvas): Canvas => ({
  ...canvas,
  schema_version: canvas.schema_version ?? 1,
  nodes: canvas.nodes ?? [],
  edges: canvas.edges ?? [],
  variables: canvas.variables ?? {},
});

const getCanvasById = (canvasList: Canvas[], canvasId: string) => canvasList.find(c => c.canvas_id === canvasId);

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  // 初始状态
  canvasList: [],
  activeCanvasId: null,
  canvasElements: {},
  selectedIds: [],
  selectedNodeId: null,
  workflowRuns: {},
  activeRun: null,
  loading: false,
  error: null,

  // 获取画布列表
  fetchCanvasList: async (projectId: string) => {
    set({ loading: true, error: null });
    try {
      const response = await canvasApi.list(projectId);
      const canvases = (response.data || []).map((c: Canvas) => ensureWorkflowDefaults(c));

      // 如果没有画布，自动创建默认画布
      if (canvases.length === 0) {
        const newCanvas = await get().createCanvas(projectId, '默认画布');
        if (newCanvas) {
          set({
            canvasList: [newCanvas],
            activeCanvasId: newCanvas.canvas_id,
            selectedNodeId: null,
            loading: false,
          });
        } else {
          set({ loading: false });
        }
      } else {
        set({
          canvasList: canvases,
          activeCanvasId: canvases[0].canvas_id,
          selectedNodeId: null,
          loading: false,
        });
      }
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  // 创建画布
  createCanvas: async (projectId: string, name: string, description?: string) => {
    try {
      const response = await canvasApi.create(projectId, { name, description: description || '' });
      const newCanvas = ensureWorkflowDefaults(response.data);

      set(state => ({
        canvasList: [...state.canvasList, newCanvas],
        activeCanvasId: newCanvas.canvas_id,
        selectedNodeId: null,
      }));

      return newCanvas;
    } catch (error: any) {
      set({ error: error.message });
      return null;
    }
  },

  // 更新画布
  updateCanvas: async (projectId: string, canvasId: string, data: any) => {
    try {
      const response = await canvasApi.update(projectId, canvasId, data);
      const updatedCanvas = ensureWorkflowDefaults(response.data);

      set(state => ({
        canvasList: state.canvasList.map(c => (c.canvas_id === canvasId ? updatedCanvas : c)),
      }));
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  // 删除画布
  deleteCanvas: async (projectId: string, canvasId: string) => {
    try {
      await canvasApi.delete(projectId, canvasId);

      set(state => {
        const newList = state.canvasList.filter(c => c.canvas_id !== canvasId);
        const newActiveId = state.activeCanvasId === canvasId ? (newList.length > 0 ? newList[0].canvas_id : null) : state.activeCanvasId;

        const newRuns = { ...state.workflowRuns };
        delete newRuns[canvasId];

        return {
          canvasList: newList,
          activeCanvasId: newActiveId,
          selectedNodeId: null,
          activeRun: newActiveId ? (newRuns[newActiveId]?.[0] || null) : null,
          workflowRuns: newRuns,
        };
      });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  // 设置当前画布
  setActiveCanvas: (canvasId: string) => {
    set(state => ({
      activeCanvasId: canvasId,
      selectedIds: [],
      selectedNodeId: null,
      activeRun: state.workflowRuns[canvasId]?.[0] || null,
    }));
  },

  // 更新布局
  updateLayout: async (projectId: string, canvasId: string, layout: any) => {
    try {
      await canvasApi.update(projectId, canvasId, layout);

      set(state => ({
        canvasList: state.canvasList.map(c => (c.canvas_id === canvasId ? ensureWorkflowDefaults({ ...c, ...layout }) : c)),
      }));
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  // 选择元素
  selectElement: (id: string, multi: boolean) => {
    set(state => {
      if (multi) {
        if (state.selectedIds.includes(id)) {
          return { selectedIds: state.selectedIds.filter(i => i !== id), selectedNodeId: null };
        }
        return { selectedIds: [...state.selectedIds, id], selectedNodeId: null };
      }
      return { selectedIds: [id], selectedNodeId: null };
    });
  },

  clearSelection: () => {
    set({ selectedIds: [], selectedNodeId: null });
  },

  setSelectedNode: (nodeId: string | null) => {
    set({ selectedNodeId: nodeId, selectedIds: [] });
  },

  upsertNode: async (projectId: string, canvasId: string, node: WorkflowNode) => {
    const canvas = getCanvasById(get().canvasList, canvasId);
    if (!canvas) return;

    const nodes = [...(canvas.nodes || [])];
    const idx = nodes.findIndex(n => n.node_id === node.node_id);
    if (idx >= 0) nodes[idx] = node;
    else nodes.push(node);

    await get().updateCanvas(projectId, canvasId, {
      schema_version: 2,
      nodes,
    });
  },

  removeNode: async (projectId: string, canvasId: string, nodeId: string) => {
    const canvas = getCanvasById(get().canvasList, canvasId);
    if (!canvas) return;

    const nodes = (canvas.nodes || []).filter(n => n.node_id !== nodeId);
    const edges = (canvas.edges || []).filter(e => e.source_node_id !== nodeId && e.target_node_id !== nodeId);

    await get().updateCanvas(projectId, canvasId, {
      schema_version: 2,
      nodes,
      edges,
    });

    set(state => ({
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    }));
  },

  upsertEdge: async (projectId: string, canvasId: string, edge: WorkflowEdge) => {
    const canvas = getCanvasById(get().canvasList, canvasId);
    if (!canvas) return;

    const edges = [...(canvas.edges || [])];
    const idx = edges.findIndex(e => e.edge_id === edge.edge_id);
    if (idx >= 0) edges[idx] = edge;
    else edges.push(edge);

    await get().updateCanvas(projectId, canvasId, {
      schema_version: 2,
      edges,
    });
  },

  removeEdge: async (projectId: string, canvasId: string, edgeId: string) => {
    const canvas = getCanvasById(get().canvasList, canvasId);
    if (!canvas) return;

    const edges = (canvas.edges || []).filter(e => e.edge_id !== edgeId);
    await get().updateCanvas(projectId, canvasId, {
      schema_version: 2,
      edges,
    });
  },

  setWorkflowVariables: async (projectId: string, canvasId: string, variables: Record<string, any>) => {
    await get().updateCanvas(projectId, canvasId, {
      schema_version: 2,
      variables,
    });
  },

  validateWorkflow: async (projectId: string, canvasId: string) => {
    try {
      const response = await canvasApi.validateWorkflow(projectId, canvasId);
      return response.data as WorkflowValidationResult;
    } catch (error: any) {
      set({ error: error.message });
      return null;
    }
  },

  runWorkflow: async (projectId: string, canvasId: string) => {
    try {
      const response = await canvasApi.runWorkflow(projectId, canvasId, { trigger: 'manual' });
      const run = response.data as WorkflowRun;

      set(state => {
        const runs = state.workflowRuns[canvasId] || [];
        return {
          workflowRuns: {
            ...state.workflowRuns,
            [canvasId]: [run, ...runs.filter(r => r.run_id !== run.run_id)],
          },
          activeRun: run,
        };
      });

      return run;
    } catch (error: any) {
      set({ error: error.message });
      return null;
    }
  },

  cancelWorkflowRun: async (projectId: string, canvasId: string, runId: string) => {
    try {
      const response = await canvasApi.cancelWorkflowRun(projectId, canvasId, runId);
      const run = response.data as WorkflowRun;

      set(state => {
        const runs = (state.workflowRuns[canvasId] || []).map(r => (r.run_id === runId ? run : r));
        return {
          workflowRuns: { ...state.workflowRuns, [canvasId]: runs },
          activeRun: state.activeRun?.run_id === runId ? run : state.activeRun,
        };
      });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  fetchWorkflowRuns: async (projectId: string, canvasId: string, limit: number = 50) => {
    try {
      const response = await canvasApi.listWorkflowRuns(projectId, canvasId, limit);
      const runs = (response.data || []) as WorkflowRun[];
      set(state => ({
        workflowRuns: {
          ...state.workflowRuns,
          [canvasId]: runs,
        },
        activeRun: state.activeCanvasId === canvasId ? runs[0] || null : state.activeRun,
      }));
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  fetchWorkflowRun: async (projectId: string, canvasId: string, runId: string) => {
    try {
      const response = await canvasApi.getWorkflowRun(projectId, canvasId, runId);
      const run = response.data as WorkflowRun;

      set(state => {
        const runs = state.workflowRuns[canvasId] || [];
        const idx = runs.findIndex(r => r.run_id === run.run_id);
        const updatedRuns = [...runs];
        if (idx >= 0) updatedRuns[idx] = run;
        else updatedRuns.unshift(run);

        return {
          workflowRuns: { ...state.workflowRuns, [canvasId]: updatedRuns },
          activeRun: state.activeRun?.run_id === runId || state.activeCanvasId === canvasId ? run : state.activeRun,
        };
      });

      return run;
    } catch (error: any) {
      set({ error: error.message });
      return null;
    }
  },

  // 获取画布元素
  fetchCanvasElements: async (projectId: string) => {
    try {
      const response = await assetApi.list(projectId, 'canvas_element', true);
      const elements = response.data || [];

      const elementsMap: Record<string, CanvasElementData> = {};
      elements.forEach((el: any) => {
        elementsMap[el.asset_id] = {
          id: el.asset_id,
          type: 'canvas_element',
          name: el.name,
          imageUrl: el.primary_image_url || '',
          data: el,
        };
      });

      set({ canvasElements: elementsMap });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  // 创建画布元素
  createCanvasElement: async (projectId: string, data: any, position?: { x: number; y: number }) => {
    try {
      const response = await assetApi.create(projectId, {
        asset_type: 'canvas_element',
        ...data,
      });

      const newElement = response.data;

      // 更新画布元素状态
      set(state => ({
        canvasElements: {
          ...state.canvasElements,
          [newElement.asset_id]: {
            id: newElement.asset_id,
            type: 'canvas_element',
            name: newElement.name,
            imageUrl: newElement.primary_image_url || '',
            data: newElement,
          },
        },
      }));

      // 将元素添加到当前活动画布的布局中
      const state = get();
      const activeCanvas = state.canvasList.find(c => c.canvas_id === state.activeCanvasId);

      if (activeCanvas) {
        const centerX = position?.x ?? 500;
        const centerY = position?.y ?? 300;

        const newPositions = [
          ...activeCanvas.elements,
          {
            id: newElement.asset_id,
            type: 'canvas_element' as const,
            x: centerX,
            y: centerY,
            width: 200,
            height: 200,
          },
        ];

        set(state => ({
          canvasList: state.canvasList.map(c => (c.canvas_id === activeCanvas.canvas_id ? { ...c, elements: newPositions } : c)),
        }));

        await get().updateLayout(projectId, activeCanvas.canvas_id, {
          elements: newPositions,
        });
      }

      return newElement.asset_id;
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    }
  },

  // 删除画布元素
  deleteCanvasElement: async (projectId: string, elementId: string) => {
    try {
      await assetApi.delete(projectId, 'canvas_element', elementId);

      set(state => {
        const newElements = { ...state.canvasElements };
        delete newElements[elementId];
        return { canvasElements: newElements };
      });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  // 从画布移除元素（不删除资产）
  removeElementFromCanvas: async (projectId: string, elementId: string) => {
    const state = get();
    const activeCanvas = state.canvasList.find(c => c.canvas_id === state.activeCanvasId);

    if (!activeCanvas) return;

    try {
      const newElements = activeCanvas.elements.filter(e => e.id !== elementId);

      await get().updateLayout(projectId, activeCanvas.canvas_id, {
        elements: newElements,
      });

      if (state.selectedIds.includes(elementId)) {
        set(state => ({
          selectedIds: state.selectedIds.filter(id => id !== elementId),
        }));
      }
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  // 重置
  reset: () => {
    set({
      canvasList: [],
      activeCanvasId: null,
      canvasElements: {},
      selectedIds: [],
      selectedNodeId: null,
      workflowRuns: {},
      activeRun: null,
      loading: false,
      error: null,
    });
  },
}));
