import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, X } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { projectApi, assetApi, generationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import { QUICK_START_TEMPLATES, QuickStartTemplate } from '@/data/quickStartTemplates';
import { useThemeStore } from '@/store/themeStore';

export function QuickStartSection() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { setCurrentProject } = useProjectStore();
  const appearanceMode = useThemeStore(s => s.appearanceMode);
  const isVipMode = appearanceMode === 'vip';
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [confirmTemplate, setConfirmTemplate] = useState<QuickStartTemplate | null>(null);

  const handleClick = (template: QuickStartTemplate) => {
    if (loadingId) return;
    setConfirmTemplate(template);
  };

  const handleConfirm = async () => {
    const template = confirmTemplate;
    if (!template) return;
    setConfirmTemplate(null);
    setLoadingId(template.id);
    try {
      const projectRes = await projectApi.create({ name: template.name, description: template.subtitle });
      const project = projectRes.data;
      const pid = project.project_id;

      await projectApi.update(pid, {
        total_episodes: 1,
        minutes_per_episode: template.minutesPerEpisode,
      });

      await generationApi.updateGlobalStyleConfig(pid, {
        prompt_language: 'zh',
        global_resolution: template.globalResolution,
        image_style: {
          preset_id: 'custom',
          custom_suffix: template.imageStylePrompt,
          enabled: true,
          custom_presets: [],
          active_custom_id: '',
        },
        video_style: {
          preset_id: 'custom',
          custom_suffix: template.videoStylePrompt,
          enabled: true,
          custom_presets: [],
          active_custom_id: '',
        },
      });

      await assetApi.create(pid, {
        asset_type: 'episode',
        episode_number: 1,
        name: '第1集',
        description: '',
        script: template.scriptContent,
      });

      setCurrentProject(project);
      navigate(`/project/${pid}`);
    } catch (err: any) {
      toast(err?.response?.data?.detail || '创建项目失败', 'error');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <>
      <div className="mb-8">
        <h2 className="text-sm font-medium text-gray-400 mb-3">快速开始</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {QUICK_START_TEMPLATES.map((template) => (
            <button
              key={template.id}
              onClick={() => handleClick(template)}
              disabled={loadingId !== null}
              className={`relative w-full aspect-video rounded-xl overflow-hidden group focus:outline-none ${isVipMode ? 'vip-card-surface vip-quickstart-card' : ''}`}
            >
              <img
                src={template.coverImage}
                alt={template.name}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="absolute inset-0 bg-gray-700 -z-10" />
              <div
                className="absolute inset-0"
                style={isVipMode
                  ? { background: 'linear-gradient(to top, rgba(7,8,12,0.92) 0%, rgba(26,20,14,0.66) 38%, rgba(0,0,0,0.05) 68%)' }
                  : { background: 'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 35%, transparent 60%)' }}
              />
              {loadingId === template.id && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <span style={{ color: '#fff' }} className="text-xs">创建中...</span>
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 px-3 py-3 flex items-end justify-between gap-2">
                <div className="text-left">
                  <div style={isVipMode
                    ? { color: '#f5e7c5', textShadow: '0 2px 10px rgba(0,0,0,0.72)' }
                    : { color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }} className="text-sm font-semibold leading-snug">
                    {template.name}
                  </div>
                  <div style={isVipMode
                    ? { color: 'rgba(236,212,162,0.82)', textShadow: '0 1px 5px rgba(0,0,0,0.6)' }
                    : { color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }} className="text-xs mt-0.5">
                    {template.subtitle}
                  </div>
                </div>
                <ArrowRight size={14} style={isVipMode ? { color: 'rgba(240,211,148,0.9)', flexShrink: 0 } : { color: 'rgba(255,255,255,0.85)', flexShrink: 0 }} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 确认弹窗 */}
      {confirmTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-80 shadow-xl">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-base font-semibold">创建项目</h3>
              <button onClick={() => setConfirmTemplate(null)} className="text-gray-400 hover:text-gray-200 p-0.5">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-gray-400 mb-1">即将根据模板创建新项目：</p>
            <p className="text-sm font-medium mb-1">{confirmTemplate.name}</p>
            <p className="text-xs text-gray-500 mb-5">{confirmTemplate.subtitle}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmTemplate(null)}
                className="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                确认创建
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
