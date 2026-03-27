/**
 * 画布相关类型定义
 */

export type CanvasElementType = 'character' | 'scene' | 'prop' | 'storyboard' | 'canvas_element';

export type WorkflowPortType = 'text' | 'image' | 'image_list' | 'video' | 'json';

export interface WorkflowNode {
  node_id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  config: Record<string, any>;
  model_override?: string;
}

export interface WorkflowEdge {
  edge_id: string;
  source_node_id: string;
  source_port: string;
  source_port_type?: WorkflowPortType;
  target_node_id: string;
  target_port: string;
  target_port_type?: WorkflowPortType;
  condition?: string;
}

export type WorkflowRunStatus =
  | 'created'
  | 'validating'
  | 'running'
  | 'canceling'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'partial_failed';

export type WorkflowNodeRunStatus =
  | 'idle'
  | 'ready'
  | 'running'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'skipped';

export interface WorkflowRunNodeState {
  status: WorkflowNodeRunStatus;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
}

export interface WorkflowRun {
  run_id: string;
  canvas_id: string;
  project_id: string;
  status: WorkflowRunStatus;
  cancel_requested: boolean;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  node_states: Record<string, WorkflowRunNodeState>;
  outputs: Record<string, any>;
  trigger?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  node_count: number;
  edge_count: number;
}

export interface Canvas {
  canvas_id: string;
  project_id: string;
  name: string;
  description: string;
  zoom: number;
  pan_x: number;
  pan_y: number;
  elements: CanvasElementPosition[];
  schema_version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CanvasElementPosition {
  id: string;
  type: CanvasElementType;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasElementData {
  id: string;
  type: CanvasElementType;
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
  character: '#3B82F6', // 蓝色
  scene: '#10B981', // 绿色
  prop: '#F59E0B', // 橙色
  storyboard: '#8B5CF6', // 紫色
  canvas_element: '#EC4899', // 粉色
} as const;
