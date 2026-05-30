import { useState, useEffect } from 'react';
import { versionApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import { useThemeStore } from '@/store/themeStore';

interface VersionInfo {
  version: string;
  release_date: string;
  description: string;
}

type State = 'idle' | 'checking' | 'up_to_date' | 'has_update' | 'updating' | 'error';

export function UpdatePanel() {
  const { toast } = useToast();
  const { appearanceMode, toggleAppearanceMode } = useThemeStore();
  const [state, setState] = useState<State>('idle');
  const [localVersion, setLocalVersion] = useState<string>('');
  const [remoteInfo, setRemoteInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    versionApi.getLocalVersion()
      .then(r => setLocalVersion(r.data.version || 'unknown'))
      .catch(() => setLocalVersion('unknown'));
  }, []);

  const handleCheck = async () => {
    setState('checking');
    setError('');
    setRemoteInfo(null);
    try {
      const r = await versionApi.checkUpdate();
      setLocalVersion(r.data.local.version);
      setRemoteInfo(r.data.remote);
      setState(r.data.has_update ? 'has_update' : 'up_to_date');
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || '检查失败');
      setState('error');
    }
  };

  const handleUpdate = async () => {
    setState('updating');
    try {
      await versionApi.triggerUpdate();
      toast('更新已启动，请等待更新窗口完成后重启服务', 'success');
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || '启动更新失败');
      setState('has_update');
      toast('启动更新失败', 'error');
    }
  };


  return (
    <div className="p-6 flex flex-col gap-5 max-w-lg">
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-xs text-gray-400 mb-1">当前版本</div>
        <div className="text-base font-mono text-gray-100">{localVersion || '...'}</div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-xs text-gray-400 mb-2">界面模式</div>
        <button
          onClick={toggleAppearanceMode}
          className="px-3 py-1.5 rounded-full vip-pill text-xs text-gray-300 hover:text-white transition-colors"
          title={appearanceMode === 'classic' ? '切换 VIP 外观' : '切换经典外观'}
        >
          {appearanceMode === 'classic' ? 'Classic' : 'VIP'}
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {state !== 'updating' && (
          <button
            onClick={handleCheck}
            disabled={state === 'checking'}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition disabled:opacity-50 w-fit"
          >
            {state === 'checking' && (
              <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded" />
            )}
            {state === 'checking' ? '检查中...' : '检查更新'}
          </button>
        )}

        {state === 'up_to_date' && (
          <div className="text-sm text-green-400">✓ 已是最新版本</div>
        )}

        {state === 'has_update' && remoteInfo && (
          <div className="bg-gray-800 rounded-lg p-4 border border-blue-500/50 flex flex-col gap-3">
            <div>
              <span className="text-xs text-gray-400 mr-2">发现新版本</span>
              <span className="font-mono text-sm text-blue-300">{remoteInfo.version}</span>
            </div>
            {remoteInfo.description && (
              <p className="text-xs text-gray-400">{remoteInfo.description}</p>
            )}
            <button
              onClick={handleUpdate}
              className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm transition w-fit"
            >
              立即更新
            </button>
          </div>
        )}

        {state === 'updating' && (
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-yellow-400">
              <div className="animate-spin h-3 w-3 border-2 border-yellow-400 border-t-transparent rounded" />
              更新下载中...
            </div>
            <p className="text-xs text-gray-400">
              请等待更新窗口中的下载完成，完成后重启服务即可生效。
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="text-sm text-red-400">{error}</div>
        )}
      </div>
    </div>
  );
}
