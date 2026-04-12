import { useEffect, useRef, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import { useSaasAuthStore } from '@/store/saasAuthStore';

const baseUrl = import.meta.env.DEV ? 'http://localhost:8501/api' : '/api';

export function SaasLoginModal() {
  const { loginWithPoll } = useSaasAuthStore();

  const [step, setStep] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');
  const [registerUrl, setRegisterUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // 组件卸载时清理
  useEffect(() => () => stopPoll(), []);

  const handleStart = async () => {
    setErrorMsg('');
    setStep('waiting');
    try {
      // 前端生成随机 session_id，无需硬件信息
      const sessionId = crypto.randomUUID();

      // 从后端获取登录 URL
      const res = await fetch(`${baseUrl}/user/auth/start?session_id=${sessionId}`);
      if (!res.ok) throw new Error('获取登录链接失败');
      const data = await res.json();

      setRegisterUrl(data.url);
      window.open(data.url, '_blank');

      // 开始轮询
      pollRef.current = setInterval(async () => {
        try {
          const result = await loginWithPoll(sessionId);
          if (result.registered) {
            stopPoll();
            setStep('success');
          }
        } catch {
          // 轮询失败不中断，继续等待
        }
      }, 3000);
    } catch (e: any) {
      setErrorMsg(e.message || '启动失败');
      setStep('error');
    }
  };

  const handleCancel = () => {
    stopPoll();
    setStep('idle');
    setRegisterUrl('');
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 rounded-xl w-full max-w-sm p-8 shadow-2xl">
        <h2 className="text-xl font-semibold mb-1 text-white flex items-baseline gap-2">
          登录 ViPro
          <span className="text-sm font-medium text-gray-400 border border-gray-400 px-2 py-0.5 rounded-md">满血API</span>
        </h2>
        <p className="text-sm text-gray-400 mb-6">
          使用您的 ViPro 账号登录，AI 调用将使用您账号内的额度。
        </p>

        {step === 'idle' && (
          <button
            onClick={handleStart}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 py-2.5 rounded-lg font-medium text-sm transition"
          >
            <ExternalLink size={16} />
            前往 ViPro 登录
          </button>
        )}

        {step === 'waiting' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-gray-700 rounded-lg p-4">
              <Loader2 size={18} className="animate-spin text-blue-400 shrink-0" />
              <div>
                <p className="text-sm text-white font-medium">等待登录确认…</p>
                <p className="text-xs text-gray-400 mt-0.5">已在新标签页打开登录页，完成后将自动跳转</p>
              </div>
            </div>

            {registerUrl && (
              <p className="text-xs text-gray-500 text-center">
                未自动打开？
                <a href={registerUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline ml-1">
                  点击此处
                </a>
              </p>
            )}

            <button
              onClick={handleCancel}
              className="w-full text-sm text-gray-400 hover:text-white py-2 transition"
            >
              取消
            </button>
          </div>
        )}

        {step === 'success' && (
          <div className="text-center">
            <p className="text-green-400 font-medium">登录成功！</p>
            <p className="text-xs text-gray-400 mt-1">正在进入…</p>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-red-400">{errorMsg}</p>
            <button
              onClick={() => setStep('idle')}
              className="w-full bg-gray-700 hover:bg-gray-600 py-2 rounded-lg text-sm transition"
            >
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
