import { useState, useCallback } from 'react';

type DialogState = Record<string, boolean>;

/**
 * 统一的对话框状态管理 Hook
 * 用于替代多个独立的 useState(false) 对话框状态
 */
export function useDialogManager(initialState: DialogState = {}) {
  const [dialogs, setDialogs] = useState(initialState);

  const open = useCallback((dialogName: string) => {
    setDialogs(prev => ({ ...prev, [dialogName]: true }));
  }, []);

  const close = useCallback((dialogName: string) => {
    setDialogs(prev => ({ ...prev, [dialogName]: false }));
  }, []);

  const toggle = useCallback((dialogName: string) => {
    setDialogs(prev => ({ ...prev, [dialogName]: !prev[dialogName] }));
  }, []);

  const isOpen = useCallback((dialogName: string) => {
    return dialogs[dialogName] || false;
  }, [dialogs]);

  return { open, close, toggle, isOpen };
}
