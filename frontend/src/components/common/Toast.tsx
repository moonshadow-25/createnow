import React, { useState, useContext } from 'react';
import { CheckCircle, AlertCircle, Info } from 'lucide-react';
import { translateError } from '@/utils/errorMessages';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  originalText?: string;  // 可复制的原始英文错误
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  toast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

export const ToastContext = React.createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (message: string, type: ToastType = 'info', duration = 3000, originalText?: string) => {
    const id = Date.now().toString();
    let displayMessage = message;
    let copyText = originalText;

    if (type === 'error') {
      const cn = translateError(message);
      if (cn) {
        displayMessage = cn;
        copyText = message;
      }
      if (duration === 3000) duration = 5000;
    }

    const newToast: Toast = { id, message: displayMessage, type, duration, originalText: copyText };

    setToasts(prev => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toasts, toast: addToast, removeToast }}>
      {children}

      <div className="fixed bottom-4 right-4 z-[999999] flex flex-col gap-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-2 px-4 py-3 rounded shadow-lg ${getToastClasses(t.type)} max-w-sm`}
            style={{ animation: 'slideIn 0.3s ease-out' }}
          >
            {getToastIcon(t.type)}
            <span className="text-sm font-medium">{t.message}</span>
            {t.originalText && (
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(t.originalText!);
                  } catch {
                    // fallback: ignore
                  }
                }}
                className="ml-1 px-1.5 py-0.5 rounded hover:bg-white/20 transition flex-shrink-0 text-xs"
                title="复制原始错误信息"
              >
                复制日志
              </button>
            )}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `}</style>
    </ToastContext.Provider>
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
      return <CheckCircle size={16} className="text-white" />;
    case 'error':
      return <AlertCircle size={16} className="text-white" />;
    case 'info':
      return <Info size={16} className="text-white" />;
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
