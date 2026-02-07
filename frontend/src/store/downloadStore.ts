/**
 * 图片下载状态管理 Store
 * 使用 sessionStorage 持久化下载状态
 */

import React from 'react';

// 下载状态类型
export type DownloadStatus = 'idle' | 'running' | 'completed' | 'error';

// 下载进度信息
export interface DownloadProgress {
  total_images: number;
  downloaded_images: number;
  external_images: number;
  local_only_images: number;
  download_progress: number;
}

// 下载任务状态
export interface DownloadState {
  status: DownloadStatus;
  progress: DownloadProgress;
  currentImage: string;
  errors: string[];
  startedAt?: string;
  completedAt?: string;
}

// 项目下载状态映射
interface ProjectDownloadStates {
  [projectId: string]: DownloadState;
}

// 默认状态
const defaultState: DownloadState = {
  status: 'idle',
  progress: {
    total_images: 0,
    downloaded_images: 0,
    external_images: 0,
    local_only_images: 0,
    download_progress: 0,
  },
  currentImage: '',
  errors: [],
};

// ==================== State Management ====================

let states: ProjectDownloadStates = {};
let listeners: Set<() => void> = new Set();

// 从 sessionStorage 加载状态
function loadStates(): ProjectDownloadStates {
  try {
    const stored = sessionStorage.getItem('download_states');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load download states:', e);
  }
  return {};
}

// 保存状态到 sessionStorage
function saveStates() {
  try {
    sessionStorage.setItem('download_states', JSON.stringify(states));
  } catch (e) {
    console.error('Failed to save download states:', e);
  }
}

// 初始化
function init() {
  states = loadStates();
}

// 初始化
init();

// ==================== Store Actions ====================

export const downloadStore = {
  // 获取项目的下载状态
  getState(projectId: string): DownloadState {
    if (!states[projectId]) {
      states[projectId] = { ...defaultState };
    }
    return states[projectId];
  },

  // 设置项目的下载状态
  setState(projectId: string, newState: Partial<DownloadState>) {
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
  updateProgress(projectId: string, progress: DownloadProgress, currentImage: string) {
    if (states[projectId]) {
      states[projectId].progress = progress;
      states[projectId].currentImage = currentImage;
      saveStates();
      notifyListeners();
    }
  },

  // 完成下载
  completeDownload(projectId: string) {
    if (states[projectId]) {
      states[projectId].status = 'completed';
      states[projectId].completedAt = new Date().toISOString();
      states[projectId].currentImage = '';
      saveStates();
      notifyListeners();
    }
  },

  // 下载失败
  failDownload(projectId: string, error: string) {
    if (states[projectId]) {
      states[projectId].status = 'error';
      states[projectId].errors = [error];
      states[projectId].currentImage = '';
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
 * 获取项目下载状态
 */
export function useDownloadState(projectId: string): DownloadState {
  const [, forceUpdate] = React.useState({});

  React.useEffect(() => {
    return downloadStore.subscribe(() => forceUpdate({}));
  }, []);

  return downloadStore.getState(projectId);
}

/**
 * 获取下载进度百分比
 */
export function useDownloadProgress(projectId: string): number {
  const state = useDownloadState(projectId);
  return state.progress.download_progress || 0;
}

/**
 * 是否正在下载
 */
export function useIsDownloading(projectId: string): boolean {
  const state = useDownloadState(projectId);
  return state.status === 'running';
}
