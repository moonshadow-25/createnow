import { useState, useEffect, useCallback } from 'react';
import { X, Search, ChevronLeft, ChevronRight, Loader2, Download, AlertCircle, Check } from 'lucide-react';
import { siliconPlatformApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface Talent {
  id: number;
  name: string;
  gender: string;
  age_range: string;
  level_name: string;
  main_image_url: string;
  total_revenue: number;
}

interface AssetItem {
  asset_id: string;
  asset_type: string;
  sub_type: string;
  name: string;
  description: string;
  preview_url: string;
  tags: string[];
  talent_id: number;
  talent_name: string;
}

interface TalentAssetsGrouped {
  talent_id: number;
  talent_name: string;
  groups: Array<{
    asset_type: string;
    asset_type_display: string;
    items: AssetItem[];
  }>;
}

interface Props {
  open: boolean;
  projectId: string;
  characterName: string;
  characterId: string;
  onClose: () => void;
  onImported: () => void;
}

type Step = 'select-talent' | 'select-image' | 'confirm';

const ROLE_TYPES = ['主角', '配角', '群演'] as const;

export function PlatformImagePicker({ open, projectId, characterName, characterId, onClose, onImported }: Props) {
  const { toast } = useToast();

  // ── 步骤状态 ──
  const [step, setStep] = useState<Step>('select-talent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── 凭证 ──
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);

  // ── 艺人列表 ──
  const [talents, setTalents] = useState<Talent[]>([]);
  const [talentCount, setTalentCount] = useState(0);
  const [talentPage, setTalentPage] = useState(1);
  const [talentSearch, setTalentSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // ── 选中艺人 ──
  const [selectedTalent, setSelectedTalent] = useState<Talent | null>(null);
  const [talentAssets, setTalentAssets] = useState<TalentAssetsGrouped | null>(null);

  // ── 选中资产 ──
  const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null);
  const [roleType, setRoleType] = useState<string>('主角');

  // ── 导入状态 ──
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  const PAGE_SIZE = 20;

  // ── 初始化：检查凭证 ──
  useEffect(() => {
    if (!open) return;
    setStep('select-talent');
    setSelectedTalent(null);
    setTalentAssets(null);
    setSelectedAsset(null);
    setError('');
    setImportDone(false);

    siliconPlatformApi.getCredentials(projectId)
      .then(r => setHasCredentials(r.data?.configured ?? false))
      .catch(() => setHasCredentials(false));
  }, [open, projectId]);

  // ── 加载艺人列表 ──
  const loadTalents = useCallback(async (page: number, search: string) => {
    setLoading(true);
    setError('');
    try {
      const params: any = { page, page_size: PAGE_SIZE };
      if (search.trim()) params.search = search.trim();
      const r = await siliconPlatformApi.listTalents(projectId, params);
      setTalents(r.data?.results || []);
      setTalentCount(r.data?.count || 0);
    } catch (e: any) {
      setError(e.response?.data?.detail || '加载艺人列表失败');
      setTalents([]);
      setTalentCount(0);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open && hasCredentials === true) {
      loadTalents(talentPage, talentSearch);
    }
  }, [open, hasCredentials, talentPage, talentSearch, loadTalents]);

  // ── 凭证保存 ──
  const handleSaveCredentials = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      toast('请填写 app_id 和 app_secret', 'error');
      return;
    }
    setSavingCreds(true);
    try {
      await siliconPlatformApi.saveCredentials(projectId, {
        app_id: appId.trim(),
        app_secret: appSecret.trim(),
      });
      setHasCredentials(true);
      toast('凭证已保存', 'success');
    } catch (e: any) {
      toast(e.response?.data?.detail || '保存凭证失败', 'error');
    } finally {
      setSavingCreds(false);
    }
  };

  // ── 选中艺人 → 加载资产 ──
  const handleSelectTalent = async (talent: Talent) => {
    setSelectedTalent(talent);
    setSelectedAsset(null);
    setLoading(true);
    setError('');
    try {
      const r = await siliconPlatformApi.getTalentAssets(projectId, talent.id);
      setTalentAssets(r.data);
      setStep('select-image');
    } catch (e: any) {
      setError(e.response?.data?.detail || '加载艺人资产失败');
    } finally {
      setLoading(false);
    }
  };

  // ── 选中图片 → 确认 ──
  const handleSelectImage = (asset: AssetItem) => {
    setSelectedAsset(asset);
    setStep('confirm');
  };

  // ── 确认导入 ──
  const handleConfirmImport = async () => {
    if (!selectedAsset) return;
    setImporting(true);
    setError('');
    try {
      await siliconPlatformApi.acquire(projectId, {
        asset_id: selectedAsset.asset_id,
        role_type: roleType,
        character_id: characterId,
        project_name: projectId,
      });
      setImportDone(true);
      toast('图片导入成功！', 'success');
      // 延迟关闭让用户看到成功状态
      setTimeout(() => {
        onImported();
        onClose();
      }, 800);
    } catch (e: any) {
      const detail = e.response?.data?.detail || '导入失败';
      if (e.response?.status === 402) {
        setError(`余额不足：${detail}。请先在硅星人 WEB 端充值后再试。`);
      } else {
        setError(detail);
      }
    } finally {
      setImporting(false);
    }
  };

  // ── 搜索 ──
  const handleSearch = () => {
    setTalentSearch(searchInput);
    setTalentPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(talentCount / PAGE_SIZE));

  // ── 获取艺人头像 URL（处理可能的相对路径）──
  const getImageUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return `https://ai.npaigc.com${url.startsWith('/') ? '' : '/'}${url}`;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* 标题栏 */}
        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-700 shrink-0">
          <h2 className="text-lg font-semibold">
            从平台导入角色图片
            {selectedTalent && <span className="text-sm text-gray-400 ml-2">→ {selectedTalent.name}</span>}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ── 错误提示 ── */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* ── 凭证配置 ── */}
          {hasCredentials === false && (
            <div className="bg-gray-700 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-300">配置硅星人平台凭证</h3>
              <p className="text-xs text-gray-400">
                请填入在硅星人平台申请的开发者应用凭证。凭证将保存在当前项目中。
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={appId}
                  onChange={e => setAppId(e.target.value)}
                  placeholder="App ID (如 APP-XXXX)"
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white text-sm"
                />
                <input
                  type="password"
                  value={appSecret}
                  onChange={e => setAppSecret(e.target.value)}
                  placeholder="App Secret"
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white text-sm"
                />
              </div>
              <button
                onClick={handleSaveCredentials}
                disabled={savingCreds}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm disabled:opacity-50"
              >
                {savingCreds ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                保存凭证
              </button>
            </div>
          )}

          {/* ── 加载中 ── */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-gray-400" />
              <span className="ml-2 text-gray-400">加载中...</span>
            </div>
          )}

          {/* ── 步骤1: 选艺人 ── */}
          {!loading && step === 'select-talent' && hasCredentials === true && (
            <div className="space-y-4">
              {/* 搜索栏 */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                    placeholder="搜索艺人姓名..."
                    className="w-full bg-gray-700 border border-gray-600 rounded pl-9 pr-3 py-2 text-white text-sm"
                  />
                </div>
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                >
                  搜索
                </button>
              </div>

              {/* 艺人网格 */}
              {talents.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {talents.map(talent => (
                      <div
                        key={talent.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectTalent(talent)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSelectTalent(talent); }}
                        className="bg-gray-700 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition"
                      >
                        <div className="aspect-square bg-gray-600">
                          {talent.main_image_url ? (
                            <img
                              src={getImageUrl(talent.main_image_url)}
                              alt={talent.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-500 text-3xl font-bold">
                              {talent.name[0]}
                            </div>
                          )}
                        </div>
                        <div className="p-2">
                          <div className="text-sm font-medium text-white truncate">{talent.name}</div>
                          <div className="text-xs text-gray-400 mt-1">
                            {talent.gender} · {talent.age_range} · {talent.level_name}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 分页 */}
                  {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-3">
                      <button
                        onClick={() => setTalentPage(p => Math.max(1, p - 1))}
                        disabled={talentPage <= 1}
                        className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="text-sm text-gray-400">{talentPage} / {totalPages}</span>
                      <button
                        onClick={() => setTalentPage(p => Math.min(totalPages, p + 1))}
                        disabled={talentPage >= totalPages}
                        className="p-1.5 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  {talentSearch ? '未找到匹配的艺人' : '暂无艺人数据'}
                </div>
              )}
            </div>
          )}

          {/* ── 步骤2: 选图片 ── */}
          {!loading && step === 'select-image' && talentAssets && (
            <div className="space-y-4">
              <button
                onClick={() => { setStep('select-talent'); setSelectedTalent(null); setTalentAssets(null); }}
                className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
              >
                <ChevronLeft size={14} />
                返回艺人列表
              </button>

              {talentAssets.groups.map((group, gi) => (
                <div key={gi}>
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">
                    {group.asset_type_display} ({group.items.length})
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {group.items.map(asset => (
                      <div
                        key={asset.asset_id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectImage(asset)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSelectImage(asset); }}
                        className="bg-gray-700 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-green-500 transition"
                      >
                        <div className="aspect-square bg-gray-600 relative">
                          {asset.preview_url ? (
                            <img
                              src={asset.preview_url}
                              alt={asset.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-500">
                              无预览
                            </div>
                          )}
                          {/* 水印提示 */}
                          <div className="absolute top-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                            水印预览
                          </div>
                        </div>
                        <div className="p-2">
                          <div className="text-xs text-white truncate">{asset.name}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            {asset.sub_type} · {asset.tags?.slice(0, 2).join('、')}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {talentAssets.groups.length === 0 && (
                <div className="text-center py-12 text-gray-500">该艺人暂无公开资产</div>
              )}
            </div>
          )}

          {/* ── 步骤3: 确认 ── */}
          {!loading && step === 'confirm' && selectedAsset && (
            <div className="space-y-4">
              <button
                onClick={() => setStep('select-image')}
                className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
              >
                <ChevronLeft size={14} />
                返回图片选择
              </button>

              <div className="bg-gray-700 rounded-lg p-4 flex gap-4">
                {/* 预览 */}
                <div className="w-40 h-40 bg-gray-600 rounded overflow-hidden shrink-0">
                  {selectedAsset.preview_url ? (
                    <img src={selectedAsset.preview_url} alt={selectedAsset.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500">无预览</div>
                  )}
                </div>

                {/* 详情 */}
                <div className="flex-1 space-y-2">
                  <div className="text-sm font-medium text-white">{selectedAsset.name}</div>
                  <div className="text-xs text-gray-400">{selectedAsset.description || '暂无描述'}</div>
                  <div className="text-xs text-gray-500">
                    类型: {selectedAsset.sub_type} · 艺人: {selectedAsset.talent_name}
                  </div>

                  <div className="pt-2">
                    <label className="block text-xs text-gray-400 mb-1">角色类型（影响价格）</label>
                    <select
                      value={roleType}
                      onChange={e => setRoleType(e.target.value)}
                      className="bg-gray-600 border border-gray-500 rounded px-3 py-1.5 text-white text-sm"
                    >
                      {ROLE_TYPES.map(rt => (
                        <option key={rt} value={rt}>{rt}</option>
                      ))}
                    </select>
                  </div>

                  <div className="text-xs text-yellow-400 bg-yellow-900/20 rounded px-3 py-2">
                    导入对象：角色「{characterName}」<br />
                    费用将从已绑定的硅星人平台余额中扣除。余额不足请先在硅星人 WEB 端充值。
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-between items-center px-4 py-3 border-t border-gray-700 shrink-0">
          <div className="text-xs text-gray-500">
            {step === 'select-talent' && '步骤 1/3: 选择艺人'}
            {step === 'select-image' && '步骤 2/3: 选择图片'}
            {step === 'confirm' && '步骤 3/3: 确认导入'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-sm"
            >
              取消
            </button>
            {step === 'confirm' && (
              <button
                onClick={handleConfirmImport}
                disabled={importing || importDone}
                className="flex items-center gap-2 px-4 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm disabled:opacity-50"
              >
                {importDone ? (
                  <>
                    <Check size={14} />
                    导入成功
                  </>
                ) : importing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    导入中...
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    确认导入
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
