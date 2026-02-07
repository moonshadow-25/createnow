import { create } from 'zustand';
import { canvasApi, assetApi } from '@/services/api';
import type { Canvas, CanvasElementData } from '@/types/canvas';

interface CanvasStore {
  // 状态
  canvasList: Canvas[];
  activeCanvasId: string | null;
  canvasElements: Record<string, CanvasElementData>;
  selectedIds: string[];
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

  // 画布元素操作
  fetchCanvasElements: (projectId: string) => Promise<void>;
  createCanvasElement: (projectId: string, data: any, position?: { x: number; y: number }) => Promise<string>;
  deleteCanvasElement: (projectId: string, elementId: string) => Promise<void>;
  removeElementFromCanvas: (projectId: string, elementId: string) => Promise<void>;

  // 重置
  reset: () => void;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  // 初始状态
  canvasList: [],
  activeCanvasId: null,
  canvasElements: {},
  selectedIds: [],
  loading: false,
  error: null,

  // 获取画布列表
  fetchCanvasList: async (projectId: string) => {
    set({ loading: true, error: null });
    try {
      const response = await canvasApi.list(projectId);
      const canvases = response.data || [];

      // 如果没有画布，自动创建默认画布
      if (canvases.length === 0) {
        const newCanvas = await get().createCanvas(projectId, '默认画布');
        if (newCanvas) {
          set({
            canvasList: [newCanvas],
            activeCanvasId: newCanvas.canvas_id,
            loading: false
          });
        }
      } else {
        set({
          canvasList: canvases,
          activeCanvasId: canvases[0].canvas_id,
          loading: false
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
      const newCanvas = response.data;

      set(state => ({
        canvasList: [...state.canvasList, newCanvas],
        activeCanvasId: newCanvas.canvas_id
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
      const updatedCanvas = response.data;

      set(state => ({
        canvasList: state.canvasList.map(c =>
          c.canvas_id === canvasId ? updatedCanvas : c
        )
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
        const newActiveId = state.activeCanvasId === canvasId
          ? (newList.length > 0 ? newList[0].canvas_id : null)
          : state.activeCanvasId;

        return {
          canvasList: newList,
          activeCanvasId: newActiveId
        };
      });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  // 设置当前画布
  setActiveCanvas: (canvasId: string) => {
    set({ activeCanvasId: canvasId, selectedIds: [] });
  },

  // 更新布局
  updateLayout: async (projectId: string, canvasId: string, layout: any) => {
    try {
      await canvasApi.update(projectId, canvasId, layout);

      set(state => ({
        canvasList: state.canvasList.map(c =>
          c.canvas_id === canvasId ? { ...c, ...layout } : c
        )
      }));
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  // 选择元素
  selectElement: (id: string, multi: boolean) => {
    set(state => {
      if (multi) {
        // 多选模式
        if (state.selectedIds.includes(id)) {
          return { selectedIds: state.selectedIds.filter(i => i !== id) };
        } else {
          return { selectedIds: [...state.selectedIds, id] };
        }
      } else {
        // 单选模式
        return { selectedIds: [id] };
      }
    });
  },

  // 清除选择
  clearSelection: () => {
    set({ selectedIds: [] });
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
          data: el
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
        ...data
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
            data: newElement
          }
        }
      }));

      // 将元素添加到当前活动画布的布局中
      const state = get();
      const activeCanvas = state.canvasList.find(c => c.canvas_id === state.activeCanvasId);

      if (activeCanvas) {
        // 使用提供的位置，或默认位置
        const centerX = position?.x ?? 500;
        const centerY = position?.y ?? 300;

        const newPositions = [...activeCanvas.elements, {
          id: newElement.asset_id,
          type: 'canvas_element' as const,
          x: centerX,
          y: centerY,
          width: 200,
          height: 200
        }];

        // 立即更新 canvasList 状态，避免自动布局将元素放到 (50, 50)
        set(state => ({
          canvasList: state.canvasList.map(c =>
            c.canvas_id === activeCanvas.canvas_id
              ? { ...c, elements: newPositions }
              : c
          )
        }));

        // 然后异步更新后端
        await get().updateLayout(projectId, activeCanvas.canvas_id, {
          elements: newPositions
        });
      }

      // 返回创建的元素ID
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
      // 从elements数组中移除
      const newElements = activeCanvas.elements.filter(e => e.id !== elementId);

      // 更新布局
      await get().updateLayout(projectId, activeCanvas.canvas_id, {
        elements: newElements
      });

      // 如果该元素被选中，从selectedIds中移除
      if (state.selectedIds.includes(elementId)) {
        set(state => ({
          selectedIds: state.selectedIds.filter(id => id !== elementId)
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
      loading: false,
      error: null
    });
  }
}));
