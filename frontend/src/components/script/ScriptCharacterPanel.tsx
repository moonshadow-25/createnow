import { useState } from 'react';
import { X, Trash2, Edit2, User } from 'lucide-react';
import { scriptApi } from '@/services/api';
import { useToast } from '@/components/common/Toast';

interface ScriptCharacterPanelProps {
  projectId: string;
  scriptId: string;
  characters: Array<{
    character_id: string;
    name: string;
    age?: string;
    gender?: string;
    description: string;
    notes: string;
  }>;
  onClose: () => void;
  onRefresh: () => void;
}

export function ScriptCharacterPanel({
  projectId,
  scriptId,
  characters,
  onClose,
  onRefresh
}: ScriptCharacterPanelProps) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    age: '',
    gender: '',
    description: '',
    notes: ''
  });

  const handleAdd = () => {
    setEditingId('new');
    setEditForm({ name: '', age: '', gender: '', description: '', notes: '' });
  };

  const handleEdit = (char: any) => {
    setEditingId(char.character_id);
    setEditForm({
      name: char.name,
      age: char.age || '',
      gender: char.gender || '',
      description: char.description || '',
      notes: char.notes || ''
    });
  };

  const handleSave = async () => {
    if (!editForm.name.trim()) {
      toast('请输入角色名', 'error');
      return;
    }

    try {
      if (editingId === 'new') {
        await scriptApi.addCharacter(projectId, scriptId, editForm);
        toast('人物已添加', 'success');
      } else if (editingId) {
        await scriptApi.updateCharacter(projectId, scriptId, editingId, editForm);
        toast('人物已更新', 'success');
      }
      setEditingId(null);
      setEditForm({ name: '', age: '', gender: '', description: '', notes: '' });
      onRefresh();
    } catch (error: any) {
      toast(`操作失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  const handleDelete = async (characterId: string) => {
    if (!confirm('确定删除该人物吗？')) return;
    try {
      await scriptApi.deleteCharacter(projectId, scriptId, characterId);
      toast('人物已删除', 'success');
      onRefresh();
    } catch (error: any) {
      toast(`删除失败: ${error.response?.data?.detail || error.message}`, 'error');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({ name: '', age: '', gender: '', description: '', notes: '' });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <User size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold">剧本人物表</h2>
            <span className="text-sm text-gray-400">({characters.length})</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* 人物列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          {editingId === 'new' || editingId ? (
            // 编辑/添加表单
            <div className="bg-gray-700 rounded-lg p-4 space-y-4">
              <h3 className="font-semibold text-blue-400">
                {editingId === 'new' ? '添加人物' : '编辑人物'}
              </h3>
              <div>
                <label className="block text-sm text-gray-400 mb-1">角色名 *</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2"
                  placeholder="如：马湘兰"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">年龄</label>
                  <input
                    type="text"
                    value={editForm.age}
                    onChange={(e) => setEditForm({ ...editForm, age: e.target.value })}
                    className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2"
                    placeholder="如：15岁"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">性别</label>
                  <select
                    value={editForm.gender}
                    onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}
                    className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2"
                  >
                    <option value="">未选择</option>
                    <option value="男">男</option>
                    <option value="女">女</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">描述</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 h-20"
                  placeholder="角色的详细描述..."
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">备注</label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 h-16"
                  placeholder="额外备注..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            // 人物列表
            <>
              <button
                onClick={handleAdd}
                className="w-full mb-4 py-2 border-2 border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-blue-500 hover:text-blue-400 transition"
              >
                + 添加人物
              </button>

              {characters.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <User size={32} className="mx-auto mb-2 opacity-50" />
                  <p>暂无人物</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {characters.map((char) => (
                    <div
                      key={char.character_id}
                      className="bg-gray-700 rounded-lg p-3 flex items-start justify-between"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{char.name}</span>
                          {char.age && <span className="text-xs text-gray-400">{char.age}</span>}
                          {char.gender && <span className="text-xs text-gray-400">{char.gender}</span>}
                        </div>
                        {char.description && (
                          <p className="text-sm text-gray-300">{char.description}</p>
                        )}
                        {char.notes && (
                          <p className="text-xs text-gray-500 mt-1">备注: {char.notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleEdit(char)}
                          className="text-gray-400 hover:text-blue-400 p-1"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(char.character_id)}
                          className="text-gray-400 hover:text-red-400 p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
