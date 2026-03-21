import axios from 'axios';

// 开发环境直接使用后端 URL，生产环境使用相对路径
const API_BASE_URL = import.meta.env.DEV
  ? 'http://localhost:8501/api'
  : '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：注入管理员 JWT
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：401 时发送全局事件
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      window.dispatchEvent(new CustomEvent('admin:unauthorized'));
    }
    return Promise.reject(error);
  }
);

// 项目相关API
export const projectApi = {
  list: () => api.get('/projects'),
  get: (id: string) => api.get(`/projects/${id}`),
  create: (data: { name: string; description?: string }) =>
    api.post('/projects', data),
  update: (id: string, data: any) => api.put(`/projects/${id}`, data),
  delete: (id: string) => api.delete(`/projects/${id}`),
  getStats: (id: string) => api.get(`/projects/${id}/stats`),
};

// 资产相关API
export const assetApi = {
  list: (projectId: string, assetType: string, includeChildren: boolean = true) =>
    api.get(`/projects/${projectId}/assets/${assetType}`, { params: { include_children: includeChildren } }),
  get: (projectId: string, assetType: string, assetId: string) =>
    api.get(`/projects/${projectId}/assets/${assetType}/${assetId}`),
  create: (projectId: string, data: any) =>
    api.post(`/projects/${projectId}/assets`, data),
  createChild: (projectId: string, assetType: string, parentId: string, data: any) =>
    api.post(`/projects/${projectId}/assets/${assetType}/${parentId}/children`, data),
  update: (projectId: string, assetType: string, assetId: string, data: any) =>
    api.put(`/projects/${projectId}/assets/${assetType}/${assetId}`, data),
  delete: (projectId: string, assetType: string, assetId: string) =>
    api.delete(`/projects/${projectId}/assets/${assetType}/${assetId}`),
};

// 对话相关API
export const chatApi = {
  send: (projectId: string, message: string, conversationId?: string) => {
    const url = `/projects/${projectId}/chat`;
    const body = { message, conversation_id: conversationId };
    const token = localStorage.getItem('admin_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    return {
      url: `${API_BASE_URL}${url}`,
      body: JSON.stringify(body),
      headers,
    };
  },
  uploadScript: (projectId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/projects/${projectId}/chat/upload-script`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
  },
  extractAssets: (projectId: string, text: string) =>
    api.post(`/projects/${projectId}/chat/extract`, { text }),
  analyzeScript: (projectId: string, script: string) =>
    api.post(`/projects/${projectId}/chat/analyze-script`, { text: script }),
};

// 生成相关API
export const generationApi = {
  generateImagePrompt: (projectId: string, data: any) =>
    api.post(`/projects/${projectId}/generate/image-prompt`, data),
  generateImage: (projectId: string, data: any) =>
    api.post(`/projects/${projectId}/generate/image`, data),
  listImages: (projectId: string, assetId: string) =>
    api.get(`/projects/${projectId}/generate/images/${assetId}`),
  setPrimaryImage: (projectId: string, assetId: string, imageId: string) =>
    api.post(`/projects/${projectId}/generate/images/${imageId}/set-primary`, {
      asset_id: assetId,
    }),
  uploadImage: (projectId: string, data: {
    asset_id: string;
    asset_type: string;
    file: File;
    prompt?: string;
  }) => {
    const formData = new FormData();
    formData.append('asset_id', data.asset_id);
    formData.append('asset_type', data.asset_type);
    formData.append('file', data.file);
    if (data.prompt) {
      formData.append('prompt', data.prompt);
    }

    return api.post(`/projects/${projectId}/generate/images/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  generateVideoPrompt: (projectId: string, data: any) =>
    api.post(`/projects/${projectId}/generate/video-prompt`, data),
  generateVideoReversePrompt: (projectId: string, data: any) =>
    api.post(`/projects/${projectId}/generate/video-reverse-prompt`, data),
  generateVideo: (projectId: string, data: any) =>
    api.post(`/projects/${projectId}/generate/video`, data),
  generateVideoMultiImage: (projectId: string, data: {
    storyboard_id: string;
    episode_id: string;
    image_ids: string[];
    prompt: string;
    duration?: number;
    resolution?: string;
  }) =>
    api.post(`/projects/${projectId}/generate/video`, {
      storyboard_id: data.storyboard_id,
      episode_id: data.episode_id,
      image_ids: data.image_ids,
      prompt: data.prompt,
      duration: data.duration || 6,
      resolution: data.resolution || '1920x1080'
    }),
  generateVideoMultimodal: (projectId: string, data: {
    storyboard_id: string;
    episode_id: string;
    image_ids?: string[];
    video_urls?: string[];
    audio_urls?: string[];
    prompt: string;
    duration?: number;
    resolution?: string;
    ratio?: string;
    use_web_search?: boolean;
  }) =>
    api.post(`/projects/${projectId}/generate/video`, data),
  // 视频列表和查询
  listVideos: (projectId: string, episodeId?: string) =>
    api.get(`/projects/${projectId}/generate/videos`, { params: { episode_id: episodeId } }),
  getVideo: (projectId: string, videoId: string) =>
    api.get(`/projects/${projectId}/generate/videos/${videoId}`),
  pollVideo: (projectId: string, videoId: string) =>
    api.post(`/projects/${projectId}/generate/videos/${videoId}/poll`),
  setPrimaryVideo: (projectId: string, videoId: string, storyboardId: string) =>
    api.post(`/projects/${projectId}/generate/videos/${videoId}/set-primary`, {
      storyboard_id: storyboardId,
    }),
  // Volcengine 素材库
  submitAsset: (projectId: string, imageIds: string[]) =>
    api.post(`/projects/${projectId}/generate/assets/submit`, { image_ids: imageIds }),
  getAssetStatus: (projectId: string, assetId: string) =>
    api.get(`/projects/${projectId}/generate/assets/${assetId}/status`),
  // 提示词模板管理
  getPromptTemplates: (projectId: string) =>
    api.get(`/projects/${projectId}/generate/prompt-templates`),
  updatePromptTemplates: (projectId: string, data: any) =>
    api.put(`/projects/${projectId}/generate/prompt-templates`, data),
  resetPromptTemplates: (projectId: string) =>
    api.post(`/projects/${projectId}/generate/prompt-templates/reset`),
  // 图像编辑
  generateImageEditPrompt: (projectId: string, parentAssetId: string, childAssetId: string) =>
    api.post(`/projects/${projectId}/generate/image-edit-prompt`, {
      parent_asset_id: parentAssetId,
      child_asset_id: childAssetId,
    }),
  editImage: (projectId: string, data: {
    assetId: string,
    assetType?: string,
    prompt: string,
    size?: string,
    referenceImageIds?: string[]
    referenceImageUrls?: string[]
    template?: string  // 模板ID，如 "character_sheet" 用于生成人设图
  }) =>
    api.post(`/projects/${projectId}/generate/image-edit`, {
      asset_id: data.assetId,
      asset_type: data.assetType || "character",
      prompt: data.prompt,
      ...(data.size && { size: data.size }),  // 只有明确提供时才发送 size
      reference_image_ids: data.referenceImageIds || [],
      reference_image_urls: data.referenceImageUrls || [],
      ...(data.template && { template: data.template }),  // 只有明确提供时才发送 template
    }),
  // VLM图片分析（统一接口）
  analyzeWithVLM: (projectId: string, data: {
    image_ids: string[];
    user_goal: string;
    descriptions?: string[];
    shot_types?: string[];
    camera_angles?: string[];
    actions?: string[];
    dialogues?: string[];
  }) =>
    api.post(`/projects/${projectId}/generate/vlm-analyze`, {
      image_ids: data.image_ids,
      user_goal: data.user_goal,
      descriptions: data.descriptions || [],
      shot_types: data.shot_types || [],
      camera_angles: data.camera_angles || [],
      actions: data.actions || [],
      dialogues: data.dialogues || [],
    }),
  // 生成多分镜融合视频提示词（LLM）
  generateMultiSceneVideoPrompt: (projectId: string, storyboardIds: string[]) =>
    api.post(`/projects/${projectId}/generate/multi-scene-video-prompt`, {
      storyboard_ids: storyboardIds
    }),
  // AI日志
  getAILogs: (projectId: string, params?: { type?: string; limit?: number; offset?: number }) =>
    api.get(`/projects/${projectId}/generate/ai-logs`, { params }),
  clearAILogs: (projectId: string, type?: string) =>
    api.delete(`/projects/${projectId}/generate/ai-logs`, { params: { type } }),
  // 图片下载
  downloadAllImages: (projectId: string) =>
    api.post(`/projects/${projectId}/generate/images/download-all`),
  getDownloadStatus: (projectId: string) =>
    api.get(`/projects/${projectId}/generate/images/download-status`),
  getDownloadStatistics: (projectId: string) =>
    api.get(`/projects/${projectId}/generate/images/download-statistics`),
  // 视频下载
  downloadAllVideos: (projectId: string, episodeId?: string) =>
    api.post(`/projects/${projectId}/generate/videos/download-all`, null, {
      params: episodeId ? { episode_id: episodeId } : undefined,
    }),
  getVideoDownloadStatus: (projectId: string) =>
    api.get(`/projects/${projectId}/generate/videos/download-status`),
  getVideoDownloadStatistics: (projectId: string, episodeId?: string) =>
    api.get(`/projects/${projectId}/generate/videos/download-statistics`, {
      params: episodeId ? { episode_id: episodeId } : undefined,
    }),
  // 视频导出
  exportVideos: (projectId: string, episodeId: string, storyboardIds?: string[]) =>
    api.post(`/projects/${projectId}/generate/videos/export`, {
      episode_id: episodeId,
      storyboard_ids: storyboardIds
    }),
  getVideoExportStatus: (projectId: string) =>
    api.get(`/projects/${projectId}/generate/videos/export-status`),
  // 剪映导出
  getJianyingProjects: (projectId: string) =>
    api.get(`/projects/${projectId}/generate/videos/jiaying-projects`),
  exportToJiaying: (
    projectId: string,
    episodeId: string,
    storyboardIds?: string[],
    mode?: 'new' | 'existing',
    projectName?: string,
    existingProjectId?: string
  ) =>
    api.post(`/projects/${projectId}/generate/videos/export-to-jiaying`, {
      episode_id: episodeId,
      storyboard_ids: storyboardIds,
      mode: mode || 'new',
      project_name: projectName,
      existing_project_id: existingProjectId
    }),
  getJianyingExportStatus: (projectId: string) =>
    api.get(`/projects/${projectId}/generate/videos/jiaying-export-status`),
  // 拆解三宫格
  splitTripleGrid: (projectId: string, storyboardId: string) =>
    api.post(`/projects/${projectId}/generate/images/split-triple`, {
      storyboard_id: storyboardId,
    }),
  // 分镜导出
  exportStoryboards: (projectId: string, storyboardIds: string[], prompt: string) =>
    api.post(`/projects/${projectId}/generate/storyboards/export`, {
      storyboard_ids: storyboardIds,
      prompt: prompt,
    }),
  // 全局风格配置
  getGlobalStyleConfig: (projectId: string) =>
    api.get(`/projects/${projectId}/generate/global-style-config`),
  updateGlobalStyleConfig: (projectId: string, config: any) =>
    api.put(`/projects/${projectId}/generate/global-style-config`, config),
  getStylePresets: (projectId: string) =>
    api.get(`/projects/${projectId}/generate/style-presets`),
  getStylePresetDetail: (projectId: string, presetType: 'image' | 'video', presetId: string) =>
    api.get(`/projects/${projectId}/generate/style-presets/detail/${presetType}/${presetId}`),
};

// 验证相关API
export const validationApi = {
  validateLLM: (config: { api_url?: string; api_key?: string; model?: string; api_type?: string }) =>
    api.post('/validate/llm', config),
  validateImage: (config: { api_url?: string; api_key?: string; model?: string; api_type?: string; image_edit_model?: string }) =>
    api.post('/validate/image', config),
  validateVideo: (config: { api_url?: string; api_key?: string; model?: string; api_type?: string }) =>
    api.post('/validate/video', config),
  validateTTS: (config: { api_url?: string; api_key?: string; model?: string; api_type?: string; voice?: string; id?: string }) =>
    api.post('/validate/tts', config),
};

// 分镜相关API
export const storyboardApi = {
  list: (projectId: string, episodeId: string) =>
    api.get(`/projects/${projectId}/storyboards/episode/${episodeId}`),
  create: (projectId: string, data: any) =>
    api.post(`/projects/${projectId}/storyboards`, data),
  update: (projectId: string, storyboardId: string, data: any) =>
    api.put(`/projects/${projectId}/storyboards/${storyboardId}`, data),
  delete: (projectId: string, storyboardId: string) =>
    api.delete(`/projects/${projectId}/storyboards/${storyboardId}`),
  reorder: (projectId: string, data: { episode_id: string; old_sequence: number; new_sequence: number }) =>
    api.post(`/projects/${projectId}/storyboards/reorder`, data),
  renumber: (projectId: string, episodeId: string) =>
    api.post(`/projects/${projectId}/storyboards/renumber`, { episode_id: episodeId }),
  generate: (projectId: string, data: any) =>
    api.post(`/projects/${projectId}/storyboards/generate`, data),
  createEndFrame: (projectId: string, storyboardId: string) =>
    api.post(`/projects/${projectId}/storyboards/${storyboardId}/create-end-frame`),
  autoMatchAssets: (projectId: string, storyboardId: string) =>
    api.post(`/projects/${projectId}/storyboards/${storyboardId}/auto-match-assets`),
  generateNineGridPrompts: (projectId: string, storyboardId: string) =>
    api.post(`/projects/${projectId}/storyboards/${storyboardId}/generate-nine-grid-prompts`),
  export: (projectId: string, storyboardId: string) =>
    api.post(`/projects/${projectId}/storyboards/${storyboardId}/export`),
  download: (projectId: string, storyboardId: string) =>
    api.get(`/projects/${projectId}/storyboards/${storyboardId}/download`, {
      responseType: 'blob',
    }),
  extractAssets: (projectId: string, episodeId: string) =>
    api.post(`/projects/${projectId}/storyboards/extract-assets`, { episode_id: episodeId }),
  matchAssets: (projectId: string, episodeId: string, overwriteExisting: boolean = false) =>
    api.post(`/projects/${projectId}/storyboards/match-assets`, { episode_id: episodeId, overwrite_existing: overwriteExisting }),
};

// 全局提示词模板API
export const globalPromptApi = {
  get: () => api.get('/global/prompt-templates'),
  update: (data: any) => api.put('/global/prompt-templates', data),
  reset: () => api.post('/global/prompt-templates/reset'),
};

// 剧本创作相关API
export const scriptApi = {
  list: (projectId: string) =>
    api.get(`/projects/${projectId}/scripts`),
  get: (projectId: string, scriptId: string) =>
    api.get(`/projects/${projectId}/scripts/${scriptId}`),
  create: (projectId: string, data: { title?: string; description?: string }) =>
    api.post(`/projects/${projectId}/scripts`, data),
  update: (projectId: string, scriptId: string, data: { title?: string; description?: string }) =>
    api.put(`/projects/${projectId}/scripts/${scriptId}`, data),
  delete: (projectId: string, scriptId: string) =>
    api.delete(`/projects/${projectId}/scripts/${scriptId}`),
  export: (projectId: string, scriptId: string, format: 'txt' | 'pdf' = 'txt') => {
    // 使用原生 axios 以正确处理 responseType
    return axios.get(`${API_BASE_URL}/projects/${projectId}/scripts/${scriptId}/export`, {
      params: { format },
      responseType: format === 'pdf' ? 'arraybuffer' : 'text',
      headers: { 'Content-Type': 'application/json' }
    });
  },
  import: (projectId: string, scriptId: string, content: string, useAi: boolean = true) =>
    api.post(`/projects/${projectId}/scripts/${scriptId}/import`, { content, use_ai: useAi }),
  // 人物管理
  listCharacters: (projectId: string, scriptId: string) =>
    api.get(`/projects/${projectId}/scripts/${scriptId}/characters`),
  addCharacter: (projectId: string, scriptId: string, data: {
    name: string;
    age?: string;
    gender?: string;
    description?: string;
    notes?: string;
  }) =>
    api.post(`/projects/${projectId}/scripts/${scriptId}/characters`, data),
  updateCharacter: (projectId: string, scriptId: string, characterId: string, data: {
    name?: string;
    age?: string;
    gender?: string;
    description?: string;
    notes?: string;
  }) =>
    api.put(`/projects/${projectId}/scripts/${scriptId}/characters/${characterId}`, data),
  deleteCharacter: (projectId: string, scriptId: string, characterId: string) =>
    api.delete(`/projects/${projectId}/scripts/${scriptId}/characters/${characterId}`),
  // 剧集管理
  listEpisodes: (projectId: string, scriptId: string) =>
    api.get(`/projects/${projectId}/scripts/${scriptId}/episodes`),
  addEpisode: (projectId: string, scriptId: string, episodeNumber: number, title?: string) =>
    api.post(`/projects/${projectId}/scripts/${scriptId}/episodes`, { episode_number: episodeNumber, title: title || '' }),
  deleteEpisode: (projectId: string, scriptId: string, episodeId: string) =>
    api.delete(`/projects/${projectId}/scripts/${scriptId}/episodes/${episodeId}`),
  // 场景管理
  listScenes: (projectId: string, scriptId: string, episodeId: string) =>
    api.get(`/projects/${projectId}/scripts/${scriptId}/episodes/${episodeId}/scenes`),
  addScene: (projectId: string, scriptId: string, episodeId: string, data: {
    location: string;
    time_of_day?: string;
    interior_exterior?: string;
    sequence?: number;
  }) =>
    api.post(`/projects/${projectId}/scripts/${scriptId}/episodes/${episodeId}/scenes`, data),
  updateScene: (projectId: string, scriptId: string, sceneId: string, data: {
    location?: string;
    time_of_day?: string;
    interior_exterior?: string;
    content?: string;
    sequence?: number;
  }) =>
    api.put(`/projects/${projectId}/scripts/${scriptId}/scenes/${sceneId}`, data),
  deleteScene: (projectId: string, scriptId: string, sceneId: string) =>
    api.delete(`/projects/${projectId}/scripts/${scriptId}/scenes/${sceneId}`),
  // 镜头行管理
  listLines: (projectId: string, scriptId: string, sceneId: string) =>
    api.get(`/projects/${projectId}/scripts/${scriptId}/scenes/${sceneId}/lines`),
  addLine: (projectId: string, scriptId: string, sceneId: string, data: {
    line_type: string;
    content: string;
    character?: string;
    parenthetical?: string;
    dialogue?: string;
    visual_type?: string;
    visual_description?: string;
    sequence?: number;
  }) =>
    api.post(`/projects/${projectId}/scripts/${scriptId}/scenes/${sceneId}/lines`, data),
  updateLine: (projectId: string, scriptId: string, lineId: string, data: {
    content?: string;
    line_type?: string;
    character?: string;
    parenthetical?: string;
    dialogue?: string;
    visual_type?: string;
    visual_description?: string;
    sequence?: number;
  }) =>
    api.put(`/projects/${projectId}/scripts/${scriptId}/lines/${lineId}`, data),
  deleteLine: (projectId: string, scriptId: string, lineId: string) =>
    api.delete(`/projects/${projectId}/scripts/${scriptId}/lines/${lineId}`),
};

// 画布相关API
export const canvasApi = {
  list: (projectId: string) =>
    api.get(`/projects/${projectId}/canvas`),
  get: (projectId: string, canvasId: string) =>
    api.get(`/projects/${projectId}/canvas/${canvasId}`),
  create: (projectId: string, data: { name: string; description?: string }) =>
    api.post(`/projects/${projectId}/canvas`, data),
  update: (projectId: string, canvasId: string, data: any) =>
    api.put(`/projects/${projectId}/canvas/${canvasId}`, data),
  delete: (projectId: string, canvasId: string) =>
    api.delete(`/projects/${projectId}/canvas/${canvasId}`),
  // 融合生成
  generateFusionPrompt: (projectId: string, data: {
    asset_ids: string[];
    asset_types: string[];
    user_prompt: string;
  }) =>
    api.post(`/projects/${projectId}/generate/fusion-prompt`, data),
  generateFusionImage: (projectId: string, data: {
    asset_ids: string[];
    asset_types: string[];
    prompt: string;
    image_ids: string[];
    size?: string;
    canvas_element_id?: string;
  }) =>
    api.post(`/projects/${projectId}/generate/fusion-image`, data),
};


export default api;

// 版本检查与更新
export const versionApi = {
  getLocalVersion: () => api.get('/version'),
  checkUpdate: () => api.get('/version/check'),
  triggerUpdate: () => api.post('/version/update'),
};

// 认证相关API
export const authApi = {
  info:   () => api.get('/auth/info'),
  start:  () => api.get('/auth/start'),
  poll:   () => api.get('/auth/poll'),
  getKey: () => api.get('/auth/key'),
  logout: () => api.post('/auth/logout'),
};

// 管理员账户认证 API
export const adminAuthApi = {
  login:  (username: string, password: string) => {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    return api.post('/admin/login', formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },
  me:     () => api.get('/admin/me'),
  logout: () => api.post('/admin/logout'),
};

// 管理员用户管理 API
export const adminUserApi = {
  list: () => api.get('/admin/users'),
  create: (data: { username: string; password: string; display_name?: string; assigned_project_ids?: string[] }) =>
    api.post('/admin/users', data),
  update: (userId: string, data: { display_name?: string; password?: string; assigned_project_ids?: string[] }) =>
    api.put(`/admin/users/${userId}`, data),
  delete: (userId: string) => api.delete(`/admin/users/${userId}`),
};
