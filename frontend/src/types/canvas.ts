/**
 * 画布相关类型定义
 */

export interface Canvas {
  canvas_id: string;
  project_id: string;
  name: string;
  description: string;
  zoom: number;
  pan_x: number;
  pan_y: number;
  elements: CanvasElementPosition[];
  created_at: string;
  updated_at: string;
}

export interface CanvasElementPosition {
  id: string;
  type: 'character' | 'scene' | 'prop' | 'storyboard' | 'canvas_element';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasElementData {
  id: string;
  type: 'character' | 'scene' | 'prop' | 'storyboard' | 'canvas_element';
  name: string;
  imageUrl: string;
  data: any; // 原始资产数据
}

export interface CanvasElement {
  asset_id: string;
  name: string;
  description: string;
  asset_type: string;
  source_asset_ids: string[];
  source_types: string[];
  fusion_prompt: string;
  image_id?: string;
  created_at: string;
  updated_at: string;
}

// 边框颜色配置
export const BORDER_COLORS = {
  character: '#3B82F6',    // 蓝色
  scene: '#10B981',        // 绿色
  prop: '#F59E0B',         // 橙色
  storyboard: '#8B5CF6',   // 紫色
  canvas_element: '#EC4899' // 粉色
} as const;
