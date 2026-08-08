import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import { translateError } from '@/utils/errorMessages';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;      // 展示文本（错误时可能为翻译后的中文）
  rawText: string;      // 复制文本（调用方原始消息，恒完整，不翻译）
  duration?: number;
  copyPayload?: () => Promise<string>;  // 可选：复制时额外拉取详细输入/输出日志
}

interface ToastContextType {
  toasts: Toast[];
  toast: (message: string, type?: ToastType, duration?: number, copyPayload?: () => Promise<string>) => void;
  removeToast: (id: string) => void;
}

export const ToastContext = React.createContext<ToastContextType | null>(null);

/** 展示文本超长时的截断长度 */
const MAX_DISPLAY_CHARS = 200;

/** 自增序号 + 时间戳，避免同一毫秒多条 toast 的 id 冲突 */
let toastSeq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 3000, copyPayload?: () => Promise<string>) => {
    const id = `${Date.now()}-${++toastSeq}`;
    let displayMessage = message;

    if (type === 'error') {
      const cn = translateError(message);
      if (cn) {
        displayMessage = cn;
      }
      // 红色失败框给足阅读/复制时间（默认时长即为 3 秒，仅当未显式指定时拉长）
      if (duration === 3000) duration = 10000;
    }

    const newToast: Toast = { id, message: displayMessage, rawText: message, type, duration, copyPayload };

    setToasts(prev => [...prev, newToast]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const contextValue = useMemo(() => ({ toasts, toast: addToast, removeToast }), [addToast, removeToast, toasts]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}

      <div className="fixed bottom-4 right-4 z-[999999] flex flex-col gap-2">
        {toasts.map(t => (
          <ToastCard key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [copying, setCopying] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 自动消失（悬停暂停，给足阅读/复制时间）
  useEffect(() => {
    if (paused || !toast.duration || toast.duration <= 0) return;
    const t = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(t);
  }, [paused, toast.duration, onDismiss]);

  // 卸载时清理复制反馈定时器
  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const handleCopy = useCallback(async () => {
    let text = toast.rawText;
    if (toast.copyPayload) {
      setCopying(true);
      try {
        text = await toast.copyPayload();
      } catch {
        // 拉取详细日志失败时回退到原始错误文本
      }
      setCopying(false);
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // 非 HTTPS 环境（如局域网 IP 访问）剪贴板 API 不可用，降级 textarea + execCommand
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('execCommand copy failed');
      }
      setCopied('copied');
    } catch {
      setCopied('failed');
    }

    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied('idle'), 2000);
  }, [toast.rawText, toast.copyPayload]);

  const displayText = toast.message.length > MAX_DISPLAY_CHARS
    ? `${toast.message.slice(0, MAX_DISPLAY_CHARS)}…`
    : toast.message;

  const copyLabel = copying ? '复制中…' : copied === 'copied' ? '已复制' : copied === 'failed' ? '复制失败' : '复制日志';

  return (
    <div
      className={`flex items-center gap-2 px-4 py-3 rounded shadow-lg ${getToastClasses(toast.type)} max-w-sm`}
      style={{ animation: 'slideIn 0.3s ease-out' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {getToastIcon(toast.type)}
      <span className="text-sm font-medium break-words min-w-0 flex-1" title={toast.message}>
        {displayText}
      </span>
      <button
        onClick={handleCopy}
        disabled={copying}
        className={`ml-1 px-1.5 py-0.5 rounded transition flex-shrink-0 text-xs ${
          copied === 'copied' ? 'bg-green-500/40' : copied === 'failed' ? 'bg-red-800/60' : 'hover:bg-white/20'
        }`}
        title="复制原始错误信息（含请求与响应详情）"
      >
        {copyLabel}
      </button>
      <button
        onClick={onDismiss}
        className="p-0.5 rounded hover:bg-white/20 transition flex-shrink-0"
        title="关闭"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function getToastClasses(type: ToastType): string {
  switch (type) {
    case 'success':
      return 'bg-green-600 text-white border border-green-500';
    case 'error':
      return 'bg-red-600 text-white border border-red-500';
    case 'info':
      return 'bg-blue-600 text-white border border-blue-500';
    default:
      return 'bg-gray-700 text-white border border-gray-600';
  }
}

function getToastIcon(type: ToastType) {
  switch (type) {
    case 'success':
      return <CheckCircle size={16} className="text-white flex-shrink-0" />;
    case 'error':
      return <AlertCircle size={16} className="text-white flex-shrink-0" />;
    case 'info':
      return <Info size={16} className="text-white flex-shrink-0" />;
    default:
      return null;
  }
}

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast 必须在 ToastProvider 内使用');
  }
  return context;
};
