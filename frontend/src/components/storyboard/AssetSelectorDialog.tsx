import { useState, useRef } from 'react';
import { Plus, Check, X, Loader2, Upload, Image } from 'lucide-react';
import { assetApi, generationApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

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
  onClose: () => void;
  onAssetsAdded: () => void;
}

type AssetTab = 'character' | 'scene' | 'prop';


function getAssetThumbnailUrl(asset: any): string | null {
  if (asset.primary_image_url) return asset.primary_image_url;
  if (asset.image_url) return asset.image_url;
  return null;
}

interface AssetGridItemProps {
  asset: any;
  selected: boolean;
  onToggle: () => void;
  color: 'blue' | 'green' | 'purple';
}

function AssetGridItem({ asset, selected, onToggle, color }: AssetGridItemProps) {
  const borderColor = {
    blue: selected ? 'border-blue-400' : 'border-transparent hover:border-blue-600',
    green: selected ? 'border-green-400' : 'border-transparent hover:border-green-600',
    purple: selected ? 'border-purple-400' : 'border-transparent hover:border-purple-600',
  }[color];

  const thumbnailUrl = getAssetThumbnailUrl(asset);
  const initial = (asset.name || '?')[0].toUpperCase();

  return (
    <div
      onClick={onToggle}
      className={`relative w-24 flex-shrink-0 flex flex-col items-center gap-1 p-2 rounded-lg cursor-pointer bg-gray-700 hover:bg-gray-600 border-2 transition ${borderColor}`}
    >
      <div className="w-16 h-16 rounded overflow-hidden bg-gray-600 flex items-center justify-center flex-shrink-0">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={asset.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-2xl font-bold text-gray-400">{initial}</span>
        )}
      </div>
      <span className="text-xs text-center truncate w-full text-gray-200">{asset.name}</span>
      {selected && (
        <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
          <Check size={12} className="text-white" />
        </div>
      )}
    </div>
  );
}

interface QuickAddFormProps {
  projectId: string;
  onAssetsAdded: () => void;
  onClose: () => void;
}

function QuickAddForm({ projectId, onAssetsAdded, onClose }: QuickAddFormProps) {
  const { toast } = useToast();
  const [assetType, setAssetType] = useState<AssetTab>('character');
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
            onChange={(e) => setAssetType(e.target.value as AssetTab)}
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
  onClose,
  onAssetsAdded,
}: AssetSelectorDialogProps) {
  const [activeTab, setActiveTab] = useState<AssetTab>('character');
  const [showAddForm, setShowAddForm] = useState(false);

  if (!show) return null;

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

  const tabs: { key: AssetTab; label: string; count: number; selectedCount: number }[] = [
    { key: 'character', label: '角色', count: characters.length, selectedCount: selectedCharacters.length },
    { key: 'scene', label: '场景', count: scenes.length, selectedCount: selectedScenes.length },
    { key: 'prop', label: '道具', count: props.length, selectedCount: selectedProps.length },
  ];

  const tabColor: Record<AssetTab, 'blue' | 'green' | 'purple'> = {
    character: 'blue',
    scene: 'green',
    prop: 'purple',
  };
  const tabActiveClass: Record<AssetTab, string> = {
    character: 'border-blue-500 text-blue-400',
    scene: 'border-green-500 text-green-400',
    prop: 'border-purple-500 text-purple-400',
  };

  const currentAssets = activeTab === 'character' ? characters : activeTab === 'scene' ? scenes : props;
  const isSelected = (id: string) =>
    activeTab === 'character' ? selectedCharacters.includes(id)
    : activeTab === 'scene' ? selectedScenes.includes(id)
    : selectedProps.includes(id);
  const onToggle = (id: string) =>
    activeTab === 'character' ? toggleCharacter(id)
    : activeTab === 'scene' ? toggleScene(id)
    : toggleProp(id);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60]">
      <div className="bg-gray-800 rounded-lg p-5 w-full max-w-[90vw] h-[85vh] flex flex-col">
        {/* 顶部 */}
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

        {/* 快速添加表单 */}
        {showAddForm && (
          <div className="mb-3">
            <QuickAddForm
              projectId={projectId}
              onAssetsAdded={onAssetsAdded}
              onClose={() => setShowAddForm(false)}
            />
          </div>
        )}

        {/* Tab 栏 */}
        <div className="flex border-b border-gray-700 mb-4">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2 text-sm font-medium border-b-2 transition ${
                activeTab === tab.key ? tabActiveClass[tab.key] : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs">
                ({tab.count}
                {tab.selectedCount > 0 && <span className="text-yellow-400">·已选{tab.selectedCount}</span>}
                )
              </span>
            </button>
          ))}
        </div>

        {/* 资产格子 */}
        <div className="flex-1 overflow-y-auto">
          {currentAssets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <span>暂无{tabs.find(t => t.key === activeTab)?.label}</span>
              <button
                onClick={() => setShowAddForm(true)}
                className="mt-2 text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
              >
                <Plus size={12} />添加一个
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3 p-1">
              {currentAssets.map(asset => (
                <AssetGridItem
                  key={asset.asset_id}
                  asset={asset}
                  selected={isSelected(asset.asset_id)}
                  onToggle={() => onToggle(asset.asset_id)}
                  color={tabColor[activeTab]}
                />
              ))}
            </div>
          )}
        </div>

        {/* 底部 */}
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
