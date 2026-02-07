import { useState, useEffect } from 'react';
import { X, FolderPlus, FolderOpen, Loader2, AlertCircle } from 'lucide-react';
import { generationApi } from '@/services/api';

interface JianyingExportDialogProps {
  projectId: string;
  episodeName?: string;
  selectedCount: number;
  onConfirm: (options: {
    mode: 'new' | 'existing';
    projectName?: string;
    existingProjectId?: string;
  }) => void;
  onClose: () => void;
}

export function JianyingExportDialog({
  projectId,
  episodeName,
  selectedCount,
  onConfirm,
  onClose
}: JianyingExportDialogProps) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [projectName, setProjectName] = useState('');
  const [existingProjects, setExistingProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 生成默认项目名
  useEffect(() => {
    const date = new Date();
    const dateStr = date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).replace(/\//g, '');
    const defaultName = `${episodeName || '未命名剧集'}_分镜导出_${dateStr}`;
    setProjectName(defaultName);
  }, [episodeName]);

  // 加载现有项目列表
  useEffect(() => {
    if (mode === 'existing') {
      loadExistingProjects();
    }
  }, [mode]);

  const loadExistingProjects = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await generationApi.getJianyingProjects(projectId);
      if (response.data.success) {
        setExistingProjects(response.data.projects || []);
        if (response.data.projects.length === 0) {
          setError('未找到剪映项目，请先在剪映中创建项目');
        }
      } else {
        setError(response.data.message || '未检测到剪映安装');
      }
    } catch (error: any) {
      console.error('Failed to load jiaying projects:', error);
      setError('加载项目列表失败：' + (error.response?.data?.detail || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (mode === 'new') {
      if (!projectName.trim()) {
        setError('请输入项目名称');
        return;
      }
      onConfirm({ mode: 'new', projectName: projectName.trim() });
    } else {
      if (!selectedProjectId) {
        setError('请选择一个项目');
        return;
      }
      onConfirm({ mode: 'existing', existingProjectId: selectedProjectId });
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        {/* 标题 */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <span className="text-2xl">🎬</span>
            导出到剪映
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X size={24} />
          </button>
        </div>

        {/* 提示信息 */}
        <div className="mb-6 p-4 bg-blue-500 bg-opacity-10 border border-blue-500 rounded-lg">
          <div className="text-sm">
            将导出 <span className="text-blue-400 font-semibold">{selectedCount}</span> 个分镜视频到剪映专业版
          </div>
          <div className="text-xs text-gray-400 mt-1">
            视频将按分镜顺序自动排列在时间轴上
          </div>
        </div>

        {/* 模式选择 */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-3">选择导出方式</label>
          <div className="grid grid-cols-2 gap-4">
            {/* 创建新项目 */}
            <button
              onClick={() => setMode('new')}
              className={`p-4 rounded-lg border-2 transition ${
                mode === 'new'
                  ? 'border-purple-500 bg-purple-500 bg-opacity-10'
                  : 'border-gray-600 hover:border-gray-500'
              }`}
            >
              <FolderPlus size={32} className="mx-auto mb-2 text-purple-400" />
              <div className="font-semibold">创建新项目</div>
              <div className="text-xs text-gray-400 mt-1">
                在剪映中创建一个新项目
              </div>
            </button>

            {/* 导入到现有项目 */}
            <button
              onClick={() => setMode('existing')}
              className={`p-4 rounded-lg border-2 transition ${
                mode === 'existing'
                  ? 'border-purple-500 bg-purple-500 bg-opacity-10'
                  : 'border-gray-600 hover:border-gray-500'
              }`}
            >
              <FolderOpen size={32} className="mx-auto mb-2 text-pink-400" />
              <div className="font-semibold">导入到现有项目</div>
              <div className="text-xs text-gray-400 mt-1">
                添加到已有的剪映项目末尾
              </div>
            </button>
          </div>
        </div>

        {/* 创建新项目 - 输入项目名 */}
        {mode === 'new' && (
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">项目名称</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => {
                setProjectName(e.target.value);
                setError('');
              }}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded focus:outline-none focus:border-purple-500 transition"
              placeholder="请输入项目名称"
              autoFocus
            />
            <div className="text-xs text-gray-400 mt-2 flex items-start gap-1">
              <span>💡</span>
              <span>项目名会显示在剪映的项目列表中，建议使用有意义的名称</span>
            </div>
          </div>
        )}

        {/* 导入到现有项目 - 选择项目 */}
        {mode === 'existing' && (
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">选择项目</label>
            {loading ? (
              <div className="flex items-center justify-center py-12 bg-gray-700 rounded-lg">
                <Loader2 className="animate-spin mr-2" size={20} />
                <span className="text-gray-400">正在扫描剪映项目...</span>
              </div>
            ) : existingProjects.length === 0 ? (
              <div className="text-center py-12 bg-gray-700 rounded-lg">
                <FolderOpen size={48} className="mx-auto mb-3 text-gray-500" />
                <div className="text-gray-400 mb-2">未找到剪映项目</div>
                <div className="text-xs text-gray-500">
                  请先在剪映中创建项目，或选择"创建新项目"
                </div>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-2 bg-gray-700 rounded-lg p-2">
                {existingProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setError('');
                    }}
                    className={`w-full p-3 rounded border-2 text-left transition ${
                      selectedProjectId === project.id
                        ? 'border-purple-500 bg-purple-500 bg-opacity-10'
                        : 'border-gray-600 hover:border-gray-500 bg-gray-800'
                    }`}
                  >
                    <div className="font-semibold">{project.name}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      更新时间：{new Date(project.update_time).toLocaleString('zh-CN')}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="text-xs text-gray-400 mt-2 flex items-start gap-1">
              <span>💡</span>
              <span>视频将被添加到选中项目的时间轴末尾</span>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-3 bg-red-500 bg-opacity-10 border border-red-500 rounded-lg flex items-start gap-2">
            <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
            <span className="text-sm text-red-400">{error}</span>
          </div>
        )}

        {/* 按钮 */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded transition"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={
              (mode === 'new' && !projectName.trim()) ||
              (mode === 'existing' && !selectedProjectId)
            }
            className="px-6 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            确认导出
          </button>
        </div>
      </div>
    </div>
  );
}
