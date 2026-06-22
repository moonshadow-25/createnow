import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, Plus, RefreshCw, Trash2, Upload, X, Zap } from 'lucide-react';
import { generationApi, materialApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

const MAX_ZIP_SIZE = 200 * 1024 * 1024;
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/jpg';
const TRAINING_DURATION_SECONDS = 60 * 60;

export interface MaterialLook {
  look_id: string;
  name: string;
  prompt?: string;
  image_id?: string;
  image_url?: string;
  status?: string;
  audit_asset_id?: string;
  audit_status?: string;
}

export interface MaterialAsset {
  asset_id: string;
  name: string;
  description?: string;
  front_image_id?: string;
  front_image_url?: string;
  front_audit_asset_id?: string;
  front_audit_status?: string;
  angle_image_ids?: string[];
  angle_images?: Array<{ image_id: string; image_url?: string; audit_asset_id?: string; audit_status?: string }>;
  zip_file_name?: string;
  zip_size?: number;
  zip_media_url?: string;
  training_status?: 'not_started' | 'training' | 'succeeded' | string;
  training_started_at?: string;
  training_ready_at?: string;
  training_completed_at?: string;
  looks?: MaterialLook[];
}

type UploadTarget =
  | { kind: 'front'; material: MaterialAsset }
  | { kind: 'angle'; material: MaterialAsset; index: number }
  | { kind: 'zip'; material: MaterialAsset }
  | { kind: 'clothing'; material: MaterialAsset; look: MaterialLook }
  | { kind: 'look-direct'; material: MaterialAsset; look: MaterialLook };

interface MaterialLibraryPanelProps {
  projectId: string;
}

function mediaUrl(url?: string) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return url;
}

function auditLabel(status?: string) {
  if (status === 'Active') return '审核通过';
  if (status === 'Failed') return '审核失败';
  if (status === 'Processing') return '审核中';
  return '未审核';
}

function trainingLabel(status?: string) {
  if (status === 'succeeded') return '训练成功';
  if (status === 'training') return '训练中';
  return '未训练';
}

function formatTrainingCountdown(readyAt?: string, startedAt?: string, nowMs = Date.now()) {
  const readyTime = readyAt ? new Date(readyAt).getTime() : NaN;
  const startedTime = startedAt ? new Date(startedAt).getTime() : NaN;
  const targetTime = Number.isFinite(readyTime)
    ? readyTime
    : Number.isFinite(startedTime)
      ? startedTime + TRAINING_DURATION_SECONDS * 1000
      : NaN;
  if (!Number.isFinite(targetTime)) return '';
  const remainingSeconds = Math.max(0, Math.ceil((targetTime - nowMs) / 1000));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatBytes(size?: number) {
  if (!size) return '';
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.ceil(size / 1024)}KB`;
}

export function MaterialLibraryPanel({ projectId }: MaterialLibraryPanelProps) {
  const { toast } = useToast();
  const [materials, setMaterials] = useState<MaterialAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [lookName, setLookName] = useState('');
  const [lookPrompt, setLookPrompt] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<UploadTarget | null>(null);
  const pollingAssetIdsRef = useRef<Set<string>>(new Set());

  const selected = useMemo(
    () => materials.find((item) => item.asset_id === selectedId) || materials[0],
    [materials, selectedId]
  );

  const loadMaterials = async () => {
    setLoading(true);
    try {
      const response = await materialApi.list(projectId);
      const items = response.data || [];
      setMaterials(items);
      if (!selectedId && items.length) setSelectedId(items[0].asset_id);
      if (selectedId && !items.some((item: MaterialAsset) => item.asset_id === selectedId)) {
        setSelectedId(items[0]?.asset_id || '');
      }
    } catch (error: any) {
      toast(error?.response?.data?.detail || '加载素材库失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMaterials();
  }, [projectId]);

  useEffect(() => {
    if (!materials.some((material) => material.training_status === 'training')) return;
    const timer = window.setInterval(() => {
      void loadMaterials();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [materials, projectId]);

  useEffect(() => {
    if (!materials.some((material) => material.training_status === 'training')) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [materials]);

  const replaceMaterial = (material: MaterialAsset) => {
    setMaterials((prev) => prev.map((item) => item.asset_id === material.asset_id ? material : item));
    setSelectedId(material.asset_id);
  };

  const createMaterial = async () => {
    if (!newName.trim()) {
      toast('请输入素材名称', 'error');
      return;
    }
    setBusy('create');
    try {
      const response = await materialApi.create(projectId, { name: newName.trim(), description: newDescription.trim() });
      setMaterials((prev) => [response.data, ...prev]);
      setSelectedId(response.data.asset_id);
      setNewName('');
      setNewDescription('');
      toast('素材已创建', 'success');
    } catch (error: any) {
      toast(error?.response?.data?.detail || '创建素材失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const deleteMaterial = async (material: MaterialAsset) => {
    if (!confirm(`确定删除素材「${material.name}」吗？`)) return;
    setBusy(`delete-${material.asset_id}`);
    try {
      await materialApi.delete(projectId, material.asset_id);
      setMaterials((prev) => prev.filter((item) => item.asset_id !== material.asset_id));
      if (selectedId === material.asset_id) setSelectedId('');
      toast('素材已删除', 'success');
    } catch (error: any) {
      toast(error?.response?.data?.detail || '删除失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const openUpload = (target: UploadTarget) => {
    uploadTargetRef.current = target;
    fileInputRef.current?.click();
  };

  const updateMaterialImages = async (material: MaterialAsset, patch: Partial<MaterialAsset>) => {
    const response = await materialApi.update(projectId, material.asset_id, patch);
    replaceMaterial(response.data);
    return response.data;
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const target = uploadTargetRef.current;
    event.target.value = '';
    uploadTargetRef.current = null;
    if (!file || !target) return;

    setBusy(`${target.kind}-${target.material.asset_id}`);
    try {
      if (target.kind === 'zip') {
        if (!file.name.toLowerCase().endsWith('.zip')) {
          toast('请上传 zip 文件', 'error');
          return;
        }
        if (file.size > MAX_ZIP_SIZE) {
          toast('zip 人脸库必须小于200MB', 'error');
          return;
        }
        const response = await materialApi.uploadZip(projectId, target.material.asset_id, file);
        replaceMaterial(response.data);
        toast('zip 已上传', 'success');
        return;
      }

      if (!['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(file.type)) {
        toast('请上传 JPG、PNG 或 WEBP 图片', 'error');
        return;
      }
      const response = await generationApi.uploadImage(projectId, {
        asset_id: target.material.asset_id,
        asset_type: 'material',
        file,
        prompt: `素材库上传: ${file.name}`,
      });
      const imageId = response.data.image_id;
      if (target.kind === 'front') {
        await updateMaterialImages(target.material, { front_image_id: imageId });
        toast('正脸图已上传', 'success');
      } else if (target.kind === 'angle') {
        const next = [...(target.material.angle_image_ids || [])];
        next[target.index] = imageId;
        await updateMaterialImages(target.material, { angle_image_ids: next.filter(Boolean) });
        toast('角度图已上传', 'success');
      } else if (target.kind === 'clothing') {
        await generateLook(target.material, target.look, imageId);
      } else if (target.kind === 'look-direct') {
        await uploadLookDirect(target.material, target.look, imageId);
      }
    } catch (error: any) {
      toast(error?.response?.data?.detail || '上传失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const trainMaterial = async (material: MaterialAsset) => {
    setBusy(`train-${material.asset_id}`);
    try {
      const response = await materialApi.train(projectId, material.asset_id);
      replaceMaterial(response.data);
      toast('已开始训练，预计 1 小时完成', 'success');
    } catch (error: any) {
      toast(error?.response?.data?.detail || '训练启动失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const createLook = async () => {
    if (!selected) return;
    if (!lookName.trim()) {
      toast('请输入妆造名称', 'error');
      return;
    }
    setBusy('look-create');
    try {
      const response = await materialApi.createLook(projectId, selected.asset_id, { name: lookName.trim(), prompt: lookPrompt.trim() });
      replaceMaterial(response.data);
      setLookName('');
      setLookPrompt('');
      toast('妆造已添加', 'success');
    } catch (error: any) {
      toast(error?.response?.data?.detail || '添加妆造失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const generateLook = async (material: MaterialAsset, look: MaterialLook, clothingImageId: string) => {
    setBusy(`generate-${look.look_id}`);
    try {
      const response = await materialApi.generateLook(projectId, material.asset_id, look.look_id, {
        clothing_image_id: clothingImageId,
        prompt: look.prompt || '',
        size: '16x9',
      });
      replaceMaterial(response.data.material);
      toast('妆造图已生成', 'success');
    } catch (error: any) {
      toast(error?.response?.data?.detail || '妆造生成失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const uploadLookDirect = async (material: MaterialAsset, look: MaterialLook, imageId: string) => {
    setBusy(`upload-direct-${look.look_id}`);
    try {
      const response = await materialApi.updateLook(projectId, material.asset_id, look.look_id, {
        image_id: imageId,
      });
      replaceMaterial(response.data);
      toast('妆造图已上传', 'success');
    } catch (error: any) {
      toast(error?.response?.data?.detail || '上传妆造图失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const pollSubmittedAssets = async (assetIds: string[], materialId: string) => {
    const freshAssetIds = assetIds.filter((assetId) => assetId && !pollingAssetIdsRef.current.has(assetId));
    if (!freshAssetIds.length) return;
    freshAssetIds.forEach((assetId) => pollingAssetIdsRef.current.add(assetId));
    const pending = new Set(freshAssetIds);
    try {
      for (let attempt = 0; attempt < 120 && pending.size > 0; attempt += 1) {
        await Promise.all(Array.from(pending).map(async (assetId) => {
          try {
            const response = await generationApi.getAssetStatus(projectId, assetId);
            const status = response.data?.status;
            if (status === 'Active' || status === 'Failed') pending.delete(assetId);
          } catch (error) {
            console.error('Failed to poll material asset status:', error);
          }
        }));
        const refreshed = await materialApi.get(projectId, materialId);
        replaceMaterial(refreshed.data);
        if (pending.size === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } finally {
      freshAssetIds.forEach((assetId) => pollingAssetIdsRef.current.delete(assetId));
    }
  };

  // 提取所有审核中的 asset IDs，仅在 IDs 真正变化时触发轮询
  const processingAssetIdsByMaterial = useMemo(() => {
    const map = new Map<string, string[]>();
    materials.forEach((material) => {
      const processingAssetIds: string[] = [];
      if (material.front_audit_asset_id && material.front_audit_status === 'Processing') {
        processingAssetIds.push(material.front_audit_asset_id);
      }
      (material.looks || []).forEach((look) => {
        if (look.audit_asset_id && look.audit_status === 'Processing') {
          processingAssetIds.push(look.audit_asset_id);
        }
      });
      if (processingAssetIds.length > 0) {
        map.set(material.asset_id, processingAssetIds);
      }
    });
    return map;
  }, [materials]);

  useEffect(() => {
    processingAssetIdsByMaterial.forEach((assetIds, materialId) => {
      void pollSubmittedAssets(assetIds, materialId);
    });
  }, [processingAssetIdsByMaterial, projectId]);

  const submitNew = async () => {
    if (!selected) return;
    setBusy('audit-new');
    try {
      const response = await materialApi.submitNew(projectId, selected.asset_id);
      replaceMaterial(response.data.material);
      const assetIds = (response.data.submitted || []).map((item: any) => item.asset_id).filter(Boolean);
      toast(`已提交 ${assetIds.length} 张新增图片审核`, 'success');
      await pollSubmittedAssets(assetIds, selected.asset_id);
    } catch (error: any) {
      toast(error?.response?.data?.detail || '提交审核失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const resubmitAll = async () => {
    if (!selected) return;
    if (!confirm('将重新提审正脸图和所有妆造图，继续？')) return;
    setBusy('audit-all');
    try {
      const response = await materialApi.resubmitAll(projectId, selected.asset_id);
      replaceMaterial(response.data.material);
      const assetIds = (response.data.submitted || []).map((item: any) => item.asset_id).filter(Boolean);
      toast(`已重新提交 ${assetIds.length} 张图片审核`, 'success');
      await pollSubmittedAssets(assetIds, selected.asset_id);
    } catch (error: any) {
      toast(error?.response?.data?.detail || '重新提审失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const removeLook = async (look: MaterialLook) => {
    if (!selected || !confirm(`确定删除妆造「${look.name}」吗？`)) return;
    setBusy(`look-delete-${look.look_id}`);
    try {
      const response = await materialApi.deleteLook(projectId, selected.asset_id, look.look_id);
      replaceMaterial(response.data);
      toast('妆造已删除', 'success');
    } catch (error: any) {
      toast(error?.response?.data?.detail || '删除妆造失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const canGenerateLooks = Boolean(selected?.front_image_id && (selected?.angle_image_ids || []).length >= 5);
  const selectedTrainingCountdown = selected?.training_status === 'training'
    ? formatTrainingCountdown(selected.training_ready_at, selected.training_started_at, nowMs) || '计算中'
    : '';

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={uploadTargetRef.current?.kind === 'zip' ? '.zip,application/zip' : IMAGE_ACCEPT}
        onChange={handleFileSelected}
        className="hidden"
      />

      <div className="rounded-lg border border-gray-700 bg-gray-800/70 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">素材库</h3>
            <p className="text-sm text-gray-400">管理人物素材、妆造图和审核资产 ID。</p>
          </div>
          <button onClick={loadMaterials} disabled={loading} className="flex items-center gap-1 rounded bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600 disabled:opacity-50">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            刷新
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
          <div className="space-y-2 rounded-lg bg-gray-900 p-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新素材名称" className="w-full rounded bg-gray-800 px-3 py-2 text-sm outline-none ring-1 ring-gray-700" />
            <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="素材描述" rows={2} className="w-full rounded bg-gray-800 px-3 py-2 text-sm outline-none ring-1 ring-gray-700" />
            <button onClick={createMaterial} disabled={busy === 'create'} className="flex w-full items-center justify-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm hover:bg-blue-500 disabled:opacity-50">
              {busy === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              创建素材
            </button>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pt-2">
              {materials.map((material) => (
                <button
                  key={material.asset_id}
                  onClick={() => setSelectedId(material.asset_id)}
                  className={`w-full rounded-lg border p-2 text-left transition ${selected?.asset_id === material.asset_id ? 'border-blue-500 bg-blue-950/30' : 'border-gray-700 bg-gray-800 hover:bg-gray-750'}`}
                >
                  <div className="flex items-center gap-2">
                    {material.front_image_url ? (
                      <img src={mediaUrl(material.front_image_url)} className="h-12 w-12 rounded object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-700 text-gray-400"><ImagePlus size={18} /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">{material.name}</div>
                      <div className="text-xs text-gray-400">妆造 {material.looks?.length || 0} · {auditLabel(material.front_audit_status)}</div>
                    </div>
                  </div>
                </button>
              ))}
              {!materials.length && <div className="py-6 text-center text-sm text-gray-500">暂无素材</div>}
            </div>
          </div>

          {selected ? (
            <div className="space-y-4 rounded-lg bg-gray-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-semibold text-white">{selected.name}</div>
                  <div className="mt-1 text-sm text-gray-400">{selected.description || '暂无描述'}</div>
                  <div className="mt-2 text-xs text-gray-500">ID: {selected.asset_id}</div>
                </div>
                <button onClick={() => deleteMaterial(selected)} className="rounded bg-red-900/50 p-2 text-red-200 hover:bg-red-900"><Trash2 size={16} /></button>
              </div>

              <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
                <div className="rounded-lg border border-gray-700 bg-gray-950 p-3">
                  <div className="mb-2 text-sm font-medium text-gray-300">正脸素材</div>
                  {selected.front_image_url ? (
                    <img src={mediaUrl(selected.front_image_url)} className="h-48 w-full rounded object-cover" />
                  ) : (
                    <div className="flex h-48 items-center justify-center rounded border border-dashed border-gray-700 text-sm text-gray-500">未上传正脸</div>
                  )}
                  <button onClick={() => openUpload({ kind: 'front', material: selected })} className="mt-3 flex w-full items-center justify-center gap-1 rounded bg-green-700 px-3 py-2 text-sm hover:bg-green-600">
                    <Upload size={14} />上传正脸图
                  </button>
                  <div className="mt-2 text-xs text-gray-400">{auditLabel(selected.front_audit_status)}</div>
                </div>

                <div className="rounded-lg border border-gray-700 bg-gray-950 p-3">
                  <div className="mb-2 text-sm font-medium text-gray-300">5 张不同角度面部照片</div>
                  <div className="grid grid-cols-5 gap-2">
                    {Array.from({ length: 5 }).map((_, index) => {
                      const image = selected.angle_images?.[index];
                      return (
                        <button key={index} onClick={() => openUpload({ kind: 'angle', material: selected, index })} className="group relative h-32 overflow-hidden rounded border border-dashed border-gray-700 bg-gray-900 hover:border-blue-500">
                          {image?.image_url ? (
                            <img src={mediaUrl(image.image_url)} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full flex-col items-center justify-center text-xs text-gray-500"><Upload size={16} />角度{index + 1}</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-gray-700 bg-gray-950 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-300">zip 人脸库</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {trainingLabel(selected.training_status)}{selectedTrainingCountdown ? ` · 剩余 ${selectedTrainingCountdown}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openUpload({ kind: 'zip', material: selected })} className="flex items-center gap-1 rounded bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600"><Upload size={14} />上传 zip</button>
                    {selected.zip_file_name && selected.training_status !== 'succeeded' && (
                      <button
                        onClick={() => trainMaterial(selected)}
                        disabled={busy === `train-${selected.asset_id}` || selected.training_status === 'training'}
                        className="flex items-center gap-1 rounded bg-purple-700 px-3 py-1.5 text-sm hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {(busy === `train-${selected.asset_id}` || selected.training_status === 'training') ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                        {selected.training_status === 'training' ? `训练中 ${selectedTrainingCountdown}` : '训练'}
                      </button>
                    )}
                  </div>
                </div>
                {selected.zip_file_name ? <div className="text-sm text-gray-300">{selected.zip_file_name} <span className="text-xs text-gray-500">{formatBytes(selected.zip_size)}</span></div> : <div className="text-sm text-gray-500">未上传</div>}
              </div>

              <div className="rounded-lg border border-gray-700 bg-gray-950 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-gray-300">妆造</div>
                    {!canGenerateLooks && <div className="text-xs text-yellow-300">上传正脸和 5 张角度图后可生成妆造。</div>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={submitNew} disabled={busy === 'audit-new' || busy === 'audit-all'} className="rounded bg-blue-700 px-3 py-1.5 text-sm hover:bg-blue-600 disabled:opacity-50">{busy === 'audit-new' ? '审核轮询中...' : '提交新增审核'}</button>
                    <button onClick={resubmitAll} disabled={busy === 'audit-new' || busy === 'audit-all'} className="rounded bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600 disabled:opacity-50">{busy === 'audit-all' ? '审核轮询中...' : '重新提审全部'}</button>
                  </div>
                </div>
                <div className="mb-4 grid gap-2 md:grid-cols-[180px_1fr_auto]">
                  <input value={lookName} onChange={(e) => setLookName(e.target.value)} placeholder="妆造名称" className="rounded bg-gray-900 px-3 py-2 text-sm outline-none ring-1 ring-gray-700" />
                  <input value={lookPrompt} onChange={(e) => setLookPrompt(e.target.value)} placeholder="补充提示词" className="rounded bg-gray-900 px-3 py-2 text-sm outline-none ring-1 ring-gray-700" />
                  <button onClick={createLook} className="rounded bg-blue-600 px-3 py-2 text-sm hover:bg-blue-500">添加妆造项</button>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(selected.looks || []).map((look) => (
                    <div key={look.look_id} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-white">{look.name}</div>
                          <div className="text-xs text-gray-500">{auditLabel(look.audit_status)}</div>
                        </div>
                        <button onClick={() => removeLook(look)} className="text-gray-500 hover:text-red-300"><X size={14} /></button>
                      </div>
                      {look.image_url ? (
                        <img src={mediaUrl(look.image_url)} className="h-40 w-full rounded object-cover" />
                      ) : (
                        <div className="flex h-40 items-center justify-center rounded bg-gray-950 text-sm text-gray-500">暂无妆造图</div>
                      )}
                      {look.prompt && <div className="mt-2 line-clamp-2 text-xs text-gray-400">{look.prompt}</div>}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => openUpload({ kind: 'clothing', material: selected, look })}
                          disabled={!canGenerateLooks || busy === `generate-${look.look_id}`}
                          className="flex items-center justify-center gap-1 rounded bg-purple-700 px-2 py-2 text-xs hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
                          title="上传服饰图后通过 AI 生成妆造图"
                        >
                          {busy === `generate-${look.look_id}` ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                          上传服饰生成
                        </button>
                        <button
                          onClick={() => openUpload({ kind: 'look-direct', material: selected, look })}
                          disabled={busy === `upload-direct-${look.look_id}`}
                          className="flex items-center justify-center gap-1 rounded bg-green-700 px-2 py-2 text-xs hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                          title="直接上传已完成的妆造图"
                        >
                          {busy === `upload-direct-${look.look_id}` ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                          直接上传妆造图
                        </button>
                      </div>
                      {look.audit_asset_id && <div className="mt-2 truncate text-[10px] text-gray-500">assetid: {look.audit_asset_id}</div>}
                    </div>
                  ))}
                  {!selected.looks?.length && (
                    <div className="rounded-lg border border-dashed border-gray-700 p-8 text-center text-sm text-gray-500">
                      <div className="mb-2 text-gray-300">还没有妆造图</div>
                      <div className="mb-4 text-xs text-gray-500">先填写上方“妆造名称”，点击“添加妆造项”，再在妆造卡片中上传服饰图生成妆造图。</div>
                      <button
                        type="button"
                        onClick={createLook}
                        disabled={!lookName.trim()}
                        className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        添加妆造项
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[360px] items-center justify-center rounded-lg bg-gray-900 text-gray-500">请选择或创建素材</div>
          )}
        </div>
      </div>
    </div>
  );
}
