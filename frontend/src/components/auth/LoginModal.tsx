import { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, Loader2, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/common/Toast';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟

export function LoginModal({ open, onClose }: LoginModalProps) {
  const { toast } = useToast();
  const { setLoggedIn, fetchAuthInfo } = useAuthStore();

  const [step, setStep] = useState<'idle' | 'waiting' | 'success'>('idle');
  const [registerUrl, setRegisterUrl] = useState('');
  const [timedOut, setTimedOut] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  };

  const startPolling = (hid: string) => {
    stopPolling();
    setTimedOut(false);

    // 超时定时器
    timeoutTimerRef.current = setTimeout(() => {
      stopPolling();
      setTimedOut(true);
    }, TIMEOUT_MS);

    // 轮询定时器
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await authApi.poll();
        const data = res.data;
        if (data.registered) {
          stopPolling();
          setStep('success');
          setLoggedIn({
            hardwareId: hid,
            apiKeyMasked: data.api_key?.slice(0, 8) + '****',
            userName: data.user_name || undefined,
            credits: typeof data.credits === 'number' ? data.credits : undefined,
          });
          fetchAuthInfo();
          toast('登录成功！CreateNow 官方接口已激活', 'success');
          setTimeout(() => {
            onClose();
            setStep('idle');
          }, 1500);
        }
      } catch {
        // 忽略单次轮询失败
      }
    }, POLL_INTERVAL_MS);
  };

  const handleStart = async () => {
    try {
      const res = await authApi.start();
      const { url, hardware_id } = res.data;
      setRegisterUrl(url);
      window.open(url, '_blank');
      setStep('waiting');
      startPolling(hardware_id);
    } catch {
      toast('获取注册链接失败，请重试', 'error');
    }
  };

  const handleRetry = () => {
    setStep('idle');
    setTimedOut(false);
  };

  const handleClose = () => {
    stopPolling();
    setStep('idle');
    setTimedOut(false);
    onClose();
  };

  // 关闭时清理
  useEffect(() => {
    if (!open) {
      stopPolling();
      setStep('idle');
      setTimedOut(false);
    }
  }, [open]);

  // 卸载时清理
  useEffect(() => () => stopPolling(), []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl w-full max-w-md p-6 shadow-2xl relative">
        {/* 关闭按钮 */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white"
        >
          <X size={20} />
        </button>

        <h2 className="text-xl font-semibold mb-1">登录 CreateNow</h2>
        <p className="text-sm text-gray-400 mb-6">
          注册账号后自动获取 API Key，新建项目将默认使用官方接口
        </p>

        {step === 'idle' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              点击下方按钮，将在浏览器中打开注册页面。完成注册后，本软件会自动检测并激活您的账号。
            </p>
            <button
              onClick={handleStart}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 py-3 rounded-lg font-medium transition"
            >
              <ExternalLink size={18} />
              打开注册页面
            </button>
          </div>
        )}

        {step === 'waiting' && !timedOut && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 size={40} className="animate-spin text-blue-400" />
              <p className="text-sm text-gray-300 text-center">
                正在等待注册完成…<br />
                <span className="text-gray-500 text-xs">请在浏览器中完成注册，本软件将自动检测（每5秒检查一次）</span>
              </p>
            </div>
            <div className="bg-gray-700 rounded p-3 text-xs text-gray-400 break-all">
              <span className="text-gray-500">注册链接：</span>
              <a href={registerUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline ml-1">
                {registerUrl.slice(0, 60)}…
              </a>
            </div>
            <button
              onClick={handleClose}
              className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
            >
              取消
            </button>
          </div>
        )}

        {step === 'waiting' && timedOut && (
          <div className="space-y-4">
            <p className="text-sm text-yellow-300 text-center">
              等待超时（10分钟），请重试
            </p>
            <button
              onClick={handleRetry}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition"
            >
              重新开始
            </button>
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <CheckCircle2 size={48} className="text-green-400" />
            <p className="text-green-300 font-medium">登录成功！</p>
          </div>
        )}
      </div>
    </div>
  );
}
