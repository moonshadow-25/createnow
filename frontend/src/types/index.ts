// 消息角色类型
export type MessageRole = 'user' | 'assistant' | 'system';

// 工具调用类型
export interface ToolCall {
  id?: string;
  name: string;
  parameters?: any;
}

export interface ToolResult {
  name: string;
  tool_call_id?: string;
  result?: any;
  raw_result?: any;
}

// 资产提取信息
export interface AssetsExtracted {
  characters?: string[];
  scenes?: string[];
  props?: string[];
  episodes?: number[];
}

// 消息类型
export interface Message {
  message_id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  thinking?: string;
  assets_extracted?: AssetsExtracted;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
}

// 流式响应数据块类型
export interface StreamChunk {
  type: 'thinking' | 'thinking_end' | 'content' | 'content_end' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'confirmation_required';
  content?: string;
  tool_call?: ToolCall;
  tool_name?: string;
  tool_call_id?: string;
  result?: any;
  raw_result?: any;
  submitted?: Array<{ image_id: string; asset_id: string; status: string }>;
  conversation_id?: string;
  // 确认机制字段
  token?: string;
  description?: string;
}

// 基础资产类型
export interface Asset {
  asset_id: string;
  project_id: string;
  asset_type: 'character' | 'scene' | 'prop';
  name: string;
  description: string;
  parent_id?: string;
  tags?: string[];
  image_id?: string;
  primary_image_url?: string;
  image_count?: number;
  created_at: string;
  updated_at: string;
}

// 角色类型
export interface Character extends Asset {
  asset_type: 'character';
  gender?: string;
  age?: string;
  appearance?: string;
  personality?: string;
  voice_prompt?: string;      // 音色描述
  voice_id?: string;          // TTS 音色名
  voice_audio_id?: string;    // 主音色样本音频 ID
  voice_enabled?: boolean;    // 是否启用声音引用
}

// 场景类型
export interface Scene extends Asset {
  asset_type: 'scene';
  location?: string;
  time_of_day?: string;
  mood?: string;
}

// 道具类型
export interface Prop extends Asset {
  asset_type: 'prop';
  category?: string;
}

// 剧集类型
export interface Episode {
  episode_id: string;
  project_id: string;
  name: string;
  script_content: string;
  created_at: string;
  updated_at: string;
}

// 分镜类型
export interface Storyboard {
  asset_id: string;
  project_id: string;
  episode_id: string;
  sequence: number;
  description: string;
  script_scene_label?: string;
  character_ids: string[];
  scene_id?: string;
  prop_ids: string[];
  camera_angle?: string;
  shot_type?: string;
  dialogue: string;
  action: string;
  image_id?: string;
  primary_image_url?: string;
  image_count?: number;
  created_at: string;
  updated_at: string;
}

// API配置类型
export interface ApiConfig {
  api_type: 'openai' | 'dashscope' | 'local' | 'byteseed' | 'createnow';
  api_url: string;
  api_key?: string;
  model: string;
  image_edit_model?: string;  // 阿里百炼专用：图像编辑模型
  use_url_for_edit?: boolean;  // 图像编辑时使用URL还是base64
  voice?: string;  // TTS专用：OpenAI/阿里百炼的音色
  id?: string;  // TTS专用：本地API的speaker id
  generate_audio?: boolean;  // ByteSeed视频专用：是否生成音频
  watermark?: boolean;  // ByteSeed图像/视频专用：是否添加水印
  max_images?: number;  // ByteSeed图像专用：多图生成数量（1-4）
  multimodal_reference?: boolean;  // ByteSeed视频专用：全能参考（把资产图一起传入）
}

// 图像尺寸配置
export interface ImageSizes {
  character?: string;
  scene?: string;
  prop?: string;
  storyboard?: string;
}

// 配置预设类型
export interface ApiConfigPreset {
  id: string;                    // 唯一ID（UUID）
  name: string;                  // 预设名称（用户自定义，默认为模型名）
  config: ApiConfig;             // 完整的API配置
  created_at: string;            // 创建时间
}

// 所有预设的映射
export interface ApiConfigPresetsMap {
  llm: ApiConfigPreset[];
  vlm: ApiConfigPreset[];
  image: ApiConfigPreset[];
  video: ApiConfigPreset[];
  tts: ApiConfigPreset[];
}

export interface ProjectStats {
  episode_count: number;
  total_storyboards: number;
  storyboards_with_image: number;
  storyboards_with_video: number;
  total_images: number;
  generated_images?: number;
  total_image_cost?: number;
  total_video_seconds: number;
  storyboard_video_seconds: number;
  total_video_compute_units?: number;
  storyboard_video_compute_units?: number;
  failed_video_compute_units?: number;
  other_cost?: number;
  total_compute_spent?: number;
}

export interface ProjectUserCost {
  image_cost: number;
  video_cost: number;
  total_cost: number;
}

export interface ProjectDailyCost {
  date: string;
  image_cost: number;
  video_cost: number;
  total_cost: number;
}

export interface ProjectEpisodeCost {
  episode_id: string;
  name: string;
  episode_number?: number;
  image_cost: number;
  video_cost: number;
  total_cost: number;
}

export interface ProjectCostBreakdown {
  daily_costs: ProjectDailyCost[];
  episode_costs: ProjectEpisodeCost[];
}

// 项目类型
export interface Project {
  project_id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  stats?: ProjectStats;
  user_costs?: Record<string, ProjectUserCost>;
  unknown_costs?: ProjectUserCost;
  ai_config?: {
    llm: ApiConfig;
    vlm?: ApiConfig;
    image: ApiConfig;
    video: ApiConfig;
    tts?: ApiConfig;
    image_sizes?: ImageSizes;
    config_presets?: ApiConfigPresetsMap;
    prompt_templates?: {
      image_prompt_template?: string;
      video_prompt_template?: string;
      video_reverse_prompt_template?: string;
      storyboard_generation_prompt_template?: string;
      storyboard_image_prompt_template?: string;
      storyboard_image_edit_prompt_template?: string;
      image_edit_prompt_template?: string;
    };
  };
  total_episodes?: number;
  minutes_per_episode?: number;
  compute_budget_per_minute?: number;
  project_duration_days?: number;
  budget_total?: number;    // 项目总预算（compute units），管理员设置
  rating?: number | null;   // 项目评分，0-10，null=未评分
  review?: string;          // 项目评论/备注
}
