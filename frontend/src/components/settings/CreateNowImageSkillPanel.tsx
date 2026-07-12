import { useEffect, useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { useToast } from '@/components/common/Toast';
import { userSkillsApi } from '@/services/api';
import { useCreatenowModelConfigStore } from '@/store/createnowModelConfigStore';

const OFFICIAL_API_URL = 'https://myapi.firstarpc.com/v1';

export function CreateNowImageSkillPanel() {
  const { toast } = useToast();
  const { config, loading, fetchConfig } = useCreatenowModelConfigStore();
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await userSkillsApi.downloadCreateNowImageSkill();
      toast('图像技能已开始下载', 'success');
    } catch {
      toast('图像技能下载失败，请稍后重试', 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-6">
        <section className="border border-gray-700 bg-gray-900/60 rounded-lg p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-white">CreateNow 图像技能</h3>
            <p className="mt-1 text-sm text-gray-400">
              下载后解压即可作为 Claude Code 或 OpenClaw 技能使用。
            </p>
          </div>

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-gray-500">官方 API 地址</dt>
              <dd className="mt-1 break-all text-gray-200">{OFFICIAL_API_URL}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">默认图像模型</dt>
              <dd className="mt-1 font-mono text-gray-200">
                {loading ? '加载中...' : config.default_models.image}
              </dd>
            </div>
          </dl>

          <div>
            <h4 className="text-xs font-medium text-gray-500">可用图像模型</h4>
            {loading ? (
              <div className="mt-2 text-sm text-gray-400">加载中...</div>
            ) : config.suggestions.image.length ? (
              <div className="mt-2 overflow-hidden border border-gray-700 rounded-md">
                {config.suggestions.image.map((item) => (
                  <div key={`${item.label}-${item.model}`} className="grid grid-cols-2 gap-3 border-b border-gray-700 px-3 py-2 text-sm last:border-b-0">
                    <span className="text-gray-300">{item.label}</span>
                    <span className="font-mono text-gray-400">{item.model}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-gray-400">暂无可用图像模型</div>
            )}
          </div>

          <div className="flex justify-end border-t border-gray-700 pt-4">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-600"
            >
              {downloading ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
              {downloading ? '下载中...' : '下载图像技能'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
