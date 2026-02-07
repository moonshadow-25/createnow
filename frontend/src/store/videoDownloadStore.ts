/**
 * 视频下载状态管理 Store
 * 使用 sessionStorage 持久化下载状态
 */

import React from 'react';

// 下载状态类型
export type VideoDownloadStatus = 'idle' | 'running' | 'completed' | 'error';

// 下载进度信息
export interface VideoDownloadProgress {
  total_videos: number;
  downloaded_videos: number;
  external_videos: number;
  local_only_videos: number;
  download_progress: number;
}

// 下载任务状态
export interface VideoDownloadState {
  status: VideoDownloadStatus;
  progress: VideoDownloadProgress;
  currentVideo: string;
  errors: string[];
  startedAt?: string;
  completedAt?: string;
}

// 项目下载状态映射
interface ProjectVideoDownloadStates {
  [projectId: string]: VideoDownloadState;
}

// 默认状态
const defaultState: VideoDownloadState = {
  status: 'idle',
  progress: {
    total_videos: 0,
    downloaded_videos: 0,
    external_videos: 0,
    local_only_videos: 0,
    download_progress: 0,
  },
  currentVideo: '',
  errors: [],
};

// ==================== State Management ====================

let states: ProjectVideoDownloadStates = {};
let listeners: Set<() => void> = new Set();

// 从 sessionStorage 加载状态
function loadStates(): ProjectVideoDownloadStates {
  try {
    const stored = sessionStorage.getItem('video_download_states');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load video download states:', e);
  }
  return {};
}

// 保存状态到 sessionStorage
function saveStates() {
  try {
    sessionStorage.setItem('video_download_states', JSON.stringify(states));
  } catch (e) {
    console.error('Failed to save video download states:', e);
  }
}

// 初始化
function init() {
  states = loadStates();
}

// 初始化
init();

// ==================== Store Actions ====================

export const videoDownloadStore = {
  // 获取项目的下载状态
  getState(projectId: string): VideoDownloadState {
    if (!states[projectId]) {
      states[projectId] = { ...defaultState };
    }
    return states[projectId];
  },

  // 设置项目的下载状态
  setState(projectId: string, newState: Partial<VideoDownloadState>) {
    if (!states[projectId]) {
      states[projectId] = { ...defaultState };
    }
    states[projectId] = { ...states[projectId], ...newState };
    saveStates();
    notifyListeners();
  },

  // 开始下载
  startDownload(projectId: string) {
    states[projectId] = {
      ...defaultState,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    saveStates();
    notifyListeners();
  },

  // 更新进度
  updateProgress(projectId: string, progress: VideoDownloadProgress, currentVideo: string) {
    if (states[projectId]) {
      states[projectId].progress = progress;
      states[projectId].currentVideo = currentVideo;
      saveStates();
      notifyListeners();
    }
  },

  // 完成下载
  completeDownload(projectId: string) {
    if (states[projectId]) {
      states[projectId].status = 'completed';
      states[projectId].completedAt = new Date().toISOString();
      states[projectId].currentVideo = '';
      saveStates();
      notifyListeners();
    }
  },

  // 下载失败
  failDownload(projectId: string, error: string) {
    if (states[projectId]) {
      states[projectId].status = 'error';
      states[projectId].errors = [error];
      states[projectId].currentVideo = '';
      states[projectId].completedAt = new Date().toISOString();
      saveStates();
      notifyListeners();
    }
  },

  // 重置状态
  resetState(projectId: string) {
    states[projectId] = { ...defaultState };
    saveStates();
    notifyListeners();
  },

  // 清除所有状态
  clearAll() {
    states = {};
    saveStates();
    notifyListeners();
  },

  // 订阅状态变化
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

// 通知所有监听器
function notifyListeners() {
  listeners.forEach(listener => listener());
}

// ==================== Hooks ====================

/**
 * 获取项目视频下载状态
 */
export function useVideoDownloadState(projectId: string): VideoDownloadState {
  const [, forceUpdate] = React.useState({});

  React.useEffect(() => {
    return videoDownloadStore.subscribe(() => forceUpdate({}));
  }, []);

  return videoDownloadStore.getState(projectId);
}

/**
 * 获取视频下载进度百分比
 */
export function useVideoDownloadProgress(projectId: string): number {
  const state = useVideoDownloadState(projectId);
  return state.progress.download_progress || 0;
}

/**
 * 是否正在下载视频
 */
export function useIsVideoDownloading(projectId: string): boolean {
  const state = useVideoDownloadState(projectId);
  return state.status === 'running';
}
