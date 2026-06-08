import { useState, useRef } from 'react';
import { Plus, X, Loader2, Upload, Image } from 'lucide-react';
import { assetApi, generationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';
import type { UsedAssetIdsByType } from '@/utils/assetTags';
import { AssetPickerPanel, type AssetPickerTab } from '@/components/assets/AssetPickerPanel';

export interface AssetSelectorDialogProps {
  show: boolean;
  projectId: string;
  characters: any[];
  scenes: any[];
  props: any[];
  selectedCharacters: string[];
  setSelectedCharacters: (v: string[]) => void;
  selectedScenes: string[];
  setSelectedScenes: (v: string[]) => void;
  selectedProps: string[];
  setSelectedProps: (v: string[]) => void;
  usedAssetIdsByType?: UsedAssetIdsByType;
  onClose: () => void;
  onAssetsAdded: () => void;
}

interface QuickAddFormProps {
  projectId: string;
  onAssetsAdded: () => void;
  onClose: () => void;
}

function QuickAddForm({ projectId, onAssetsAdded, onClose }: QuickAddFormProps) {
  const { toast } = useToast();
  const [assetType, setAssetType] = useState<AssetPickerTab>('character');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast('请填写资产名称', 'error'); return; }
    setIsSubmitting(true);
    try {
      const res = await assetApi.create(projectId, { asset_type: assetType, name: name.trim(), description: description.trim() });
      const newAsset = res.data;
      if (imageFile && newAsset?.asset_id) {
        try {
          const imgRes = await generationApi.uploadImage(projectId, {
            asset_id: newAsset.asset_id,
            asset_type: assetType,
            file: imageFile,
          });
          const imageId = imgRes.data?.image_id;
          if (imageId) {
            await generationApi.setPrimaryImage(projectId, newAsset.asset_id, imageId);
          }
        } catch (e) {
          console.warn('Image upload failed:', e);
        }
      }
      toast(`资产"${name.trim()}"已创建`, 'success');
      onAssetsAdded();
      onClose();
    } catch (e: any) {
      toast(`创建失败: ${e.response?.data?.detail || e.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-300">快速添加资产</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">类型</label>
          <select
            value={assetType}
            onChange={(e) => setAssetType(e.target.value as AssetPickerTab)}
            className="w-full bg-gray-600 border border-gray-500 rounded px-2 py-1.5 text-sm text-white"
          >
            <option value="character">角色</option>
            <option value="scene">场景</option>
            <option value="prop">道具</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">名称 *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="资产名称"
            className="w-full bg-gray-600 border border-gray-500 rounded px-2 py-1.5 text-sm text-white"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">描述（选填）</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="简短描述..."
          className="w-full bg-gray-600 border border-gray-500 rounded px-2 py-1.5 text-sm text-white"
        />
      </div>
      <div className="flex items-center gap-3">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="w-16 h-16 rounded bg-gray-600 border-2 border-dashed border-gray-500 hover:border-blue-500 cursor-pointer flex items-center justify-center flex-shrink-0 overflow-hidden"
        >
          {imagePreview ? (
            <img src={imagePreview} alt="预览" className="w-full h-full object-cover" />
          ) : (
            <Image size={20} className="text-gray-400" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-xs text-gray-400">点击左侧上传图片（选填）</p>
          {imageFile && <p className="text-xs text-green-400 mt-1 truncate">{imageFile.name}</p>}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 rounded">取消</button>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !name.trim()}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded flex items-center gap-1"
        >
          {isSubmitting ? <><Loader2 size={12} className="animate-spin" />创建中...</> : <><Upload size={12} />创建资产</>}
        </button>
      </div>
    </div>
  );
}

export function AssetSelectorDialog({
  show,
  projectId,
  characters,
  scenes,
  props,
  selectedCharacters,
  setSelectedCharacters,
  selectedScenes,
  setSelectedScenes,
  selectedProps,
  setSelectedProps,
  usedAssetIdsByType,
  onClose,
  onAssetsAdded,
}: AssetSelectorDialogProps) {
  const [showAddForm, setShowAddForm] = useState(false);

  const toggleCharacter = (id: string) => {
    setSelectedCharacters(
      selectedCharacters.includes(id)
        ? selectedCharacters.filter(x => x !== id)
        : [...selectedCharacters, id]
    );
  };

  const toggleScene = (id: string) => {
    setSelectedScenes(
      selectedScenes.includes(id)
        ? selectedScenes.filter(x => x !== id)
        : [...selectedScenes, id]
    );
  };

  const toggleProp = (id: string) => {
    setSelectedProps(
      selectedProps.includes(id)
        ? selectedProps.filter(x => x !== id)
        : [...selectedProps, id]
    );
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60]">
      <div className="bg-gray-800 rounded-lg p-5 w-full max-w-[90vw] h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">选择资产</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
            >
              <Plus size={14} />快速添加
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16} /></button>
          </div>
        </div>

        {showAddForm && (
          <div className="mb-3">
            <QuickAddForm
              projectId={projectId}
              onAssetsAdded={onAssetsAdded}
              onClose={() => setShowAddForm(false)}
            />
          </div>
        )}

        <AssetPickerPanel
          characters={characters}
          scenes={scenes}
          props={props}
          selectedCharacters={selectedCharacters}
          selectedScenes={selectedScenes}
          selectedProps={selectedProps}
          onToggleCharacter={toggleCharacter}
          onToggleScene={toggleScene}
          onToggleProp={toggleProp}
          usedAssetIdsByType={usedAssetIdsByType}
          onAddEmptyAsset={() => setShowAddForm(true)}
          className="flex-1"
        />

        <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-700">
          <div className="text-sm text-gray-400">
            已选：角色 {selectedCharacters.length} · 场景 {selectedScenes.length} · 道具 {selectedProps.length}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
              取消
            </button>
            <button onClick={onClose} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm">
              确认选择
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
