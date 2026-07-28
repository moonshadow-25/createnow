import { useState, useEffect } from 'react';
import { Loader2, Check, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { siliconPlatformApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface Props {
  projectId: string;
}

export function SiliconPlatformPanel({ projectId }: Props) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [hasExisting, setHasExisting] = useState(false);
  const [existingAppId, setExistingAppId] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCredentials();
  }, [projectId]);

  const loadCredentials = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await siliconPlatformApi.getCredentials(projectId);
      if (r.data?.configured) {
        setHasExisting(true);
        setExistingAppId(r.data.app_id || '');
        setAppId(r.data.app_id || '');
        setAppSecret(''); // 不返回 secret，用户需重新输入
      } else {
        setHasExisting(false);
        setExistingAppId('');
        setAppId('');
        setAppSecret('');
      }
    } catch (e: any) {
      setError(e.response?.data?.detail || '加载凭证失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!appId.trim()) {
      toast('请输入 App ID', 'error');
      return;
    }
    if (!appSecret.trim()) {
      toast('请输入 App Secret', 'error');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await siliconPlatformApi.saveCredentials(projectId, {
        app_id: appId.trim(),
        app_secret: appSecret.trim(),
      });
      setHasExisting(true);
      setExistingAppId(appId.trim());
      setAppSecret('');
      setShowSecret(false);
      toast('凭证已保存', 'success');
    } catch (e: any) {
      const detail = e.response?.data?.detail || '保存失败';
      setError(detail);
      toast(detail, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-gray-400" />
        <span className="ml-2 text-gray-400">加载中...</span>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-5 max-w-lg">
      {/* 状态卡片 */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-gray-200">硅星人平台凭证</div>
            <div className="text-xs text-gray-500 mt-1">
              {hasExisting
                ? `已绑定 App ID: ${existingAppId}`
                : '未配置，请填入开发者应用凭证'}
            </div>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${
            hasExisting
              ? 'bg-green-900/40 text-green-300 border border-green-700'
              : 'bg-gray-700 text-gray-400 border border-gray-600'
          }`}>
            {hasExisting ? '已配置' : '未配置'}
          </span>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* 编辑卡片 */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-4">
        <h3 className="text-sm font-semibold text-gray-300">
          {hasExisting ? '修改凭证' : '配置凭证'}
        </h3>
        <p className="text-xs text-gray-500">
          在硅星人平台（ai.npaigc.com）注册开发者应用后获取 App ID 和 App Secret。凭证保存在当前项目中。
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">App ID</label>
            <input
              type="text"
              value={appId}
              onChange={e => setAppId(e.target.value)}
              placeholder="APP-XXXX"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">App Secret</label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={appSecret}
                onChange={e => setAppSecret(e.target.value)}
                placeholder={hasExisting ? '留空则不修改，输入新值则更新' : '输入 App Secret'}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 pr-10 text-white text-sm"
              />
              <button
                type="button"
                onClick={() => setShowSecret(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                title={showSecret ? '隐藏' : '显示'}
              >
                {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !appId.trim() || !appSecret.trim()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed px-4 py-2 rounded text-sm"
        >
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              保存中...
            </>
          ) : (
            <>
              <Check size={14} />
              {hasExisting ? '更新凭证' : '保存凭证'}
            </>
          )}
        </button>
      </div>

      {/* 帮助信息 */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 text-xs text-gray-400 leading-relaxed space-y-2">
        <h3 className="text-sm font-medium text-gray-200">使用说明</h3>
        <p>1. 在硅星人平台注册并创建开发者应用，获取 App ID 和 App Secret。</p>
        <p>2. 在此填入凭证，保存后即可在角色编辑中使用"从平台导入"功能。</p>
        <p>3. 导入图片时会产生费用，从硅星人平台账户余额中扣除。</p>
        <p>4. 如需更换凭证，直接输入新的 App ID 和 App Secret 保存即可。</p>
      </div>
    </div>
  );
}
