import { useState } from 'react';
import { X } from 'lucide-react';
import { assetApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface CreateAssetDialogProps {
  open: boolean;
  assetType: 'character' | 'scene' | 'prop';
  onClose: () => void;
  onCreated: () => void;
  projectId: string;
}

export function CreateAssetDialog({
  open,
  assetType,
  onClose,
  onCreated,
  projectId,
}: CreateAssetDialogProps) {
  const { toast } = useToast();
  const [newAsset, setNewAsset] = useState<any>({});
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newAsset.name || !newAsset.description) {
      toast('请填写名称和描述', 'error');
      return;
    }

    setCreating(true);
    try {
      await assetApi.create(projectId, {
        asset_type: assetType,
        ...newAsset,
      });
      setNewAsset({});
      onCreated();
      onClose();
      toast('资产创建成功', 'success');
    } catch (error: any) {
      toast(`创建失败: ${error.response?.data?.detail || error.message}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">
            创建{assetType === 'character' ? '角色' : assetType === 'scene' ? '场景' : '道具'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">名称 *</label>
            <input
              type="text"
              value={newAsset.name || ''}
              onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              placeholder="输入名称"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">描述 *</label>
            <textarea
              value={newAsset.description || ''}
              onChange={(e) => setNewAsset({ ...newAsset, description: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white h-24"
              placeholder="详细描述"
            />
          </div>

          {assetType === 'character' && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-2">性别</label>
                <input
                  type="text"
                  value={newAsset.gender || ''}
                  onChange={(e) => setNewAsset({ ...newAsset, gender: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                  placeholder="男/女"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-2">年龄</label>
                <input
                  type="text"
                  value={newAsset.age || ''}
                  onChange={(e) => setNewAsset({ ...newAsset, age: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                  placeholder="年龄"
                />
              </div>
            </>
          )}

          {assetType === 'scene' && (
            <div>
              <label className="block text-sm text-gray-400 mb-2">地点 *</label>
              <input
                type="text"
                value={newAsset.location || ''}
                onChange={(e) => setNewAsset({ ...newAsset, location: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                placeholder="地点"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg"
          >
            取消
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
            disabled={creating || !newAsset.name || !newAsset.description}
          >
            {creating ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
