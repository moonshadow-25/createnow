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
  const frontendVersion = __APP_VERSION__;
  const frontendReleaseDate = __APP_RELEASE_DATE__;
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">当前前端版本</div>
          <div className="text-base font-mono text-gray-100">{frontendVersion || 'unknown'}</div>
          {frontendReleaseDate && (
            <div className="text-xs text-gray-500 mt-1">{frontendReleaseDate}</div>
          )}
        </div>
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">当前后端版本</div>
          <div className="text-base font-mono text-gray-100">{localVersion || '...'}</div>
        </div>
      </div>

      {localVersion && localVersion !== 'unknown' && frontendVersion !== 'unknown' && localVersion !== frontendVersion && (
        <div className="bg-yellow-900/30 border border-yellow-600/40 text-yellow-200 rounded-lg px-4 py-3 text-xs">
          前端运行版本与后端安装版本不一致，可能是浏览器仍在使用旧缓存。更新完成后请强制刷新页面。
        </div>
      )}

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

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 text-xs text-gray-400 leading-relaxed space-y-3">
        <h3 className="text-sm font-medium text-gray-200">内容产权声明</h3>
        <p>
          1、ViPro产品和服务的全部知识产权归我们所有，包括但不限于软件、技术、程序、网页、文字、图片、音频、视频、图表、版面设计、电子文档等，但相关权利人根据法律规定应享有权利的除外。我们提供产品及服务时所依托的软件的著作权、专利权及其他知识产权均归我们所右，或我们已获得有效授权
        </p>
        <p>
          2、在您使用ViPro期间，您理解并承诺，输入内容以及您在使用 对发布的内容，包括但不限于文字、图片、视频、音频等各种形式的内容及其中包含的音乐、声音、台词、视觉设计、对话等所有组成部分，均由您原创或已获合法授权，不存在任何违反法律法规规定、侵犯他人合法权益(包括但不限于著作权、专利权、商标权等知识产权及人格权、个人信息权益等其他权益)、违反公序良俗的内容。在法律法规规定允许的范围内，您使用ViPro的输入内容、生成内容及发布的信息内容的知识产权及产生的其他财产权益(如有)归属于您或依法享有该知识产权的权利人。
        </p>
      </div>
    </div>
  );
}
