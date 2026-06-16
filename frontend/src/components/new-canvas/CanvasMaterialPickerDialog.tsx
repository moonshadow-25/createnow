import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { materialApi } from '@/services/api';
import type { MaterialAsset } from '@/components/assets/MaterialLibraryPanel';

type CanvasMaterialPickerDialogProps = {
  projectId: string;
  selectedMaterialId?: string;
  selectedLookIds?: string[];
  onSelect: (material: MaterialAsset, lookIds: string[]) => void;
  onClose: () => void;
};

export function CanvasMaterialPickerDialog({ projectId, selectedMaterialId, selectedLookIds = [], onSelect, onClose }: CanvasMaterialPickerDialogProps) {
  const [materials, setMaterials] = useState<MaterialAsset[]>([]);
  const [activeId, setActiveId] = useState(selectedMaterialId || '');
  const [lookIds, setLookIds] = useState<string[]>(selectedLookIds);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    materialApi.list(projectId)
      .then((res) => {
        const items = (res.data || []).filter((item: MaterialAsset) => item.training_status === 'succeeded');
        setMaterials(items);
        if (!activeId && items[0]) setActiveId(items[0].asset_id);
        if (activeId && !items.some((item: MaterialAsset) => item.asset_id === activeId)) setActiveId(items[0]?.asset_id || '');
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  const active = useMemo(() => materials.find((item) => item.asset_id === activeId), [materials, activeId]);

  const toggleLook = (lookId: string) => {
    setLookIds([lookId]);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70">
      <div className="flex h-[78vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900 text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 p-4">
          <div>
            <div className="text-lg font-semibold">选择lora</div>
            <div className="text-sm text-gray-400">选择一个素材和需要输出的妆造（单选）。</div>
          </div>
          <button onClick={onClose} className="rounded bg-gray-800 p-2 hover:bg-gray-700"><X size={18} /></button>
        </div>
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-gray-400"><Loader2 className="mr-2 animate-spin" />加载中...</div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr]">
            <div className="min-h-0 overflow-y-auto border-r border-gray-800 p-3">
              {materials.map((material) => (
                <button
                  key={material.asset_id}
                  onClick={() => { setActiveId(material.asset_id); setLookIds([]); }}
                  className={`mb-2 w-full rounded-lg border p-2 text-left ${activeId === material.asset_id ? 'border-blue-500 bg-blue-950/30' : 'border-gray-700 bg-gray-800 hover:bg-gray-750'}`}
                >
                  <div className="flex items-center gap-2">
                    {material.front_image_url ? <img src={material.front_image_url} className="h-12 w-12 rounded object-cover" /> : <div className="h-12 w-12 rounded bg-gray-700" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{material.name}</div>
                      <div className="text-xs text-gray-400">妆造 {material.looks?.length || 0}</div>
                    </div>
                  </div>
                </button>
              ))}
              {!materials.length && <div className="py-8 text-center text-sm text-gray-500">暂无训练成功的 lora，请先到资产页 lora 上传 zip 并完成训练。</div>}
            </div>
            <div className="min-h-0 overflow-y-auto p-4">
              {active ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    {active.front_image_url ? <img src={active.front_image_url} className="h-40 w-32 rounded object-cover" /> : <div className="flex h-40 w-32 items-center justify-center rounded bg-gray-800 text-xs text-gray-500">无正脸图</div>}
                    <div>
                      <div className="text-xl font-semibold">{active.name}</div>
                      <div className="mt-1 text-sm text-gray-400">{active.description || '暂无描述'}</div>
                      <div className="mt-2 text-xs text-gray-500">正脸 + {active.angle_images?.length || 0} 张角度图将一起输出。</div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-medium text-gray-300">选择妆造</div>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {(active.looks || []).map((look) => {
                        const checked = lookIds.includes(look.look_id);
                        return (
                          <button key={look.look_id} onClick={() => toggleLook(look.look_id)} className={`rounded-lg border p-2 text-left ${checked ? 'border-blue-500 bg-blue-950/30' : 'border-gray-700 bg-gray-800 hover:bg-gray-750'}`}>
                            {look.image_url ? <img src={look.image_url} className="mb-2 h-32 w-full rounded object-cover" /> : <div className="mb-2 flex h-32 items-center justify-center rounded bg-gray-950 text-xs text-gray-500">未生成</div>}
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">{look.name}</span>
                              {checked && <Check size={14} className="text-blue-300" />}
                            </div>
                          </button>
                        );
                      })}
                      {!active.looks?.length && <div className="rounded border border-dashed border-gray-700 p-6 text-center text-sm text-gray-500">暂无妆造</div>}
                    </div>
                  </div>
                </div>
              ) : <div className="text-sm text-gray-500">请选择素材</div>}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-gray-800 p-4">
          <button onClick={onClose} className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600">取消</button>
          <button onClick={() => active && onSelect(active, lookIds)} disabled={!active} className="rounded bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500 disabled:opacity-50">确认选择</button>
        </div>
      </div>
    </div>
  );
}
