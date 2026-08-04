import { useState, useEffect, useCallback } from 'react';
import { X, Search, ChevronLeft, ChevronRight, Loader2, Download, AlertCircle, Check } from 'lucide-react';
import { siliconPlatformApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface Talent {
  talent_id: number;
  name: string;
  gender: string;
  age_range: string;
  level_name: string;
  main_image_url: string;
  asset_count: number;
  description?: string;
}

interface Props {
  open: boolean;
  projectId: string;
  characterName: string;
  characterId: string;
  onClose: () => void;
  onImported: () => void;
}

type Step = 'select-talent' | 'confirm';

const ROLE_TYPES = ['主角', '配角', '群演'] as const;

export function PlatformImagePicker({ open, projectId, characterName, characterId, onClose, onImported }: Props) {
  const { toast } = useToast();

  // ── 步骤状态 ──
  const [step, setStep] = useState<Step>('select-talent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── 凭证 ──
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);

  // ── 艺人列表 ──
  const [talents, setTalents] = useState<Talent[]>([]);
  const [talentCount, setTalentCount] = useState(0);
  const [talentPage, setTalentPage] = useState(1);
  const [talentSearch, setTalentSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // ── 选中艺人 ──
  const [selectedTalent, setSelectedTalent] = useState<Talent | null>(null);
  const [roleType, setRoleType] = useState<string>('主角');

  // ── 导入状态 ──
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const PAGE_SIZE = 20;

  // ── 初始化：检查凭证 ──
  useEffect(() => {
    if (!open) return;
    setStep('select-talent');
    setSelectedTalent(null);
    setError('');
    setImportDone(false);
    setImportResult(null);

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
      if (search.trim()) params.keyword = search.trim();
      const r = await siliconPlatformApi.listTalents(projectId, params);
      setTalents(r.data?.items || []);
      setTalentCount(r.data?.total || 0);
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

  // ── 选中艺人 → 确认 ──
  const handleSelectTalent = (talent: Talent) => {
    setSelectedTalent(talent);
    setStep('confirm');
  };

  // ── 确认导入（批量获取全部三视图）──
  const handleConfirmImport = async () => {
    if (!selectedTalent) return;
    setImporting(true);
    setError('');
    try {
      const r = await siliconPlatformApi.acquireTalent(projectId, {
        talent_id: selectedTalent.talent_id,
        role_type: roleType,
        character_id: characterId,
      });
      setImportResult(r.data);
      setImportDone(true);
      toast('三视图导入成功！', 'success');
      // 延迟关闭让用户看到成功状态
      setTimeout(() => {
        onImported();
        onClose();
      }, 1200);
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

          {/* ── 凭证未配置 ── */}
          {hasCredentials === false && (
            <div className="bg-gray-700 rounded-lg p-6 text-center space-y-3">
              <AlertCircle size={32} className="text-yellow-400 mx-auto" />
              <div>
                <h3 className="text-sm font-semibold text-gray-200">未配置硅星人平台凭证</h3>
                <p className="text-xs text-gray-400 mt-1">
                  请先在项目设置中配置 App ID 和 App Secret。
                </p>
              </div>
              <p className="text-xs text-gray-500">
                设置 → 角色库 → 填入凭证
              </p>
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
                        key={talent.talent_id}
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
                              {talent.name?.[0] || '?'}
                            </div>
                          )}
                        </div>
                        <div className="p-2">
                          <div className="text-sm font-medium text-white truncate">{talent.name}</div>
                          <div className="text-xs text-gray-400 mt-1">
                            {talent.gender} · {talent.age_range} · {talent.level_name}
                          </div>
                          {typeof talent.asset_count === 'number' && (
                            <div className="text-[10px] text-gray-500 mt-0.5">
                              {talent.asset_count} 个公开资产
                            </div>
                          )}
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

          {/* ── 步骤2: 确认 ── */}
          {!loading && step === 'confirm' && selectedTalent && (
            <div className="space-y-4">
              <button
                onClick={() => { setStep('select-talent'); setSelectedTalent(null); }}
                className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
              >
                <ChevronLeft size={14} />
                返回艺人列表
              </button>

              <div className="bg-gray-700 rounded-lg p-4 flex gap-4">
                {/* 艺人主图 */}
                <div className="w-40 h-40 bg-gray-600 rounded overflow-hidden shrink-0">
                  {selectedTalent.main_image_url ? (
                    <img
                      src={getImageUrl(selectedTalent.main_image_url)}
                      alt={selectedTalent.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500 text-3xl font-bold">
                      {selectedTalent.name?.[0] || '?'}
                    </div>
                  )}
                </div>

                {/* 详情 */}
                <div className="flex-1 space-y-2">
                  <div className="text-sm font-medium text-white">{selectedTalent.name}</div>
                  <div className="text-xs text-gray-400">
                    {selectedTalent.gender} · {selectedTalent.age_range} · {selectedTalent.level_name}
                    {typeof selectedTalent.asset_count === 'number' && ` · ${selectedTalent.asset_count} 个公开资产`}
                  </div>
                  {selectedTalent.description && (
                    <div className="text-xs text-gray-500">{selectedTalent.description}</div>
                  )}

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

                  <div className="text-xs text-yellow-400 bg-yellow-900/20 rounded px-3 py-2 space-y-1">
                    <div>导入对象：角色「{characterName}」</div>
                    <div>将获取该艺人的全部三视图资产（正脸 / 侧面 / 全身 / 后背），下载为角色的多张图片。</div>
                    <div>费用将从已绑定的硅星人平台余额中扣除；同一项目重复获取同一资产不重复扣费。余额不足请先在硅星人 WEB 端充值。</div>
                  </div>

                  {/* 导入成功摘要 */}
                  {importDone && importResult && (
                    <div className="flex items-center gap-2 text-sm text-green-400 bg-green-900/20 rounded px-3 py-2">
                      <Check size={16} />
                      已导入 {importResult.images?.length || 0} 张图片
                      {typeof importResult.total_cost === 'number' && ` · 本次费用 ¥${importResult.total_cost}`}
                      {importResult.charged_assets === 0 && '（已获取过，未重复扣费）'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-between items-center px-4 py-3 border-t border-gray-700 shrink-0">
          <div className="text-xs text-gray-500">
            {step === 'select-talent' && '步骤 1/2: 选择艺人'}
            {step === 'confirm' && '步骤 2/2: 确认导入'}
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
