import type { LucideIcon } from 'lucide-react';

export type NodeKind =
  | 'static.image'
  | 'static.video'
  | 'static.audio'
  | 'gen.llm'
  | 'gen.image'
  | 'gen.image_edit'
  | 'director.stage'
  | 'gen.video.text'
  | 'gen.video.image'
  | 'gen.video.multi';

export type PortType = 'text' | 'image' | 'video' | 'audio' | 'media' | 'json';
export type RunStatus = 'idle' | 'running' | 'succeeded' | 'failed';
export type RunMode = 'continue' | 'from-selected' | 'all';
export type CanvasAssetType = 'character' | 'scene' | 'prop' | 'storyboard';

export type AssetAuditState = {
  refType: 'image' | 'video';
  refKey: string;
  assetId?: string;
  status?: string;
  error?: string;
  updatedAt?: string;
};

export type RefMedia = {
  type: 'image' | 'video' | 'audio';
  id?: string;
  url: string;
  name: string;
  sourceAssetId?: string;
  sourceAssetType?: CanvasAssetType;
  audit?: AssetAuditState;
};

export type NodeOutput = {
  text?: string;
  image_id?: string;
  image_url?: string;
  video_id?: string;
  video_url?: string;
  audio_url?: string;
  media?: RefMedia[];
  raw?: unknown;
};

export type CanvasNode = {
  node_id: string;
  type: NodeKind;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  config: {
    prompt?: string;
    negative_prompt?: string;
    size?: string;
    model?: string;
    duration?: number;
    resolution?: string;
    ratio?: string;
    generate_audio?: boolean;
    image_id?: string;
    image_url?: string;
    director_markers?: import('./directorStageUtils').DirectorStageMarker[];
    director_composite_image_id?: string;
    director_composite_image_url?: string;
    director_prompt_edited?: boolean;
    media_id?: string;
    media_url?: string;
    media_type?: 'video' | 'audio';
    asset_id?: string;
    asset_type?: CanvasAssetType;
    asset_name?: string;
    existing_asset_audit_id?: string;
    existing_asset_audit_status?: string;
    file_name?: string;
    input_hash?: string;
    audit_state?: Record<string, AssetAuditState>;
    last_result?: NodeOutput;
  };
};

export type CanvasEdge = {
  edge_id: string;
  source_node_id: string;
  source_port: string;
  source_port_type?: PortType;
  target_node_id: string;
  target_port: string;
  target_port_type?: PortType;
  order?: number;
};

export type CanvasRecord = {
  canvas_id: string;
  name: string;
  description?: string;
  zoom?: number;
  pan_x?: number;
  pan_y?: number;
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
  variables?: Record<string, unknown>;
};

export type HistoryImage = {
  image_id: string;
  prompt?: string;
  image_path?: string | null;
  local_path?: string;
  created_at?: string;
  size?: string;
};

export type HistoryVideo = {
  video_id: string;
  prompt?: string;
  video_path?: string | null;
  local_path?: string;
  status?: string;
  created_at?: string;
  duration?: number;
  resolution?: string;
  ratio?: string;
};

export type HistoryItem =
  | { kind: 'image'; id: string; title: string; createdAt: string; image: HistoryImage }
  | { kind: 'video'; id: string; title: string; createdAt: string; video: HistoryVideo }
  | { kind: 'text'; id: string; title: string; createdAt: string; text: string; nodeId: string };

export type NodeDefinition = {
  type: NodeKind;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
  inputs: { key: string; label: string; type: PortType }[];
  outputs: { key: string; label: string; type: PortType }[];
  defaults: CanvasNode['config'];
};

export interface NewCanvasTabProps {
  projectId: string;
  showAssetSubmit?: boolean;
  imageApiType?: string;
  videoApiType?: string;
}
