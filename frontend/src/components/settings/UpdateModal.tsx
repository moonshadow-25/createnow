import { X } from 'lucide-react';
import { UpdatePanel } from './UpdatePanel';

interface UpdateModalProps {
  onClose: () => void;
}

export function UpdateModal({ onClose }: UpdateModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col border border-gray-700 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold">检查更新</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto">
          <UpdatePanel />
        </div>
      </div>
    </div>
  );
}
