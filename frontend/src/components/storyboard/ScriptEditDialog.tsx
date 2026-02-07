export interface ScriptEditDialogProps {
  show: boolean;
  editingScript: string;
  onScriptChange: (script: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function ScriptEditDialog({
  show,
  editingScript,
  onScriptChange,
  onSave,
  onClose,
}: ScriptEditDialogProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">编辑剧本</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>
        <textarea
          value={editingScript}
          onChange={(e) => onScriptChange(e.target.value)}
          className="w-full h-96 bg-gray-700 border border-gray-600 rounded-lg p-4 text-sm text-gray-200 resize-none focus:outline-none focus:border-blue-500"
          placeholder="输入剧本内容..."
        />
        <div className="flex justify-end gap-3 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          >
            取消
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
