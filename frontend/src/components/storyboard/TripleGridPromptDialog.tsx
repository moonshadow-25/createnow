import { useState, useEffect } from "react";

interface TripleGridPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (prompt: string) => void;
  defaultPrompt: string;
  isGenerating: boolean;
}

export default function TripleGridPromptDialog({
  isOpen,
  onClose,
  onConfirm,
  defaultPrompt,
  isGenerating,
}: TripleGridPromptDialogProps) {
  const [prompt, setPrompt] = useState(defaultPrompt);

  useEffect(() => {
    if (isOpen) {
      setPrompt(defaultPrompt);
    }
  }, [isOpen, defaultPrompt]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4">
        <div className="px-6 py-4 border-b border-gray-700 flex justify-between items-start">
          <div>
            <h3 className="text-lg font-semibold text-white">
              生成三宫格分镜图
            </h3>
            <p className="text-sm text-gray-400 mt-1">
              编辑提示词后，将使用当前分镜主图生成竖向三宫格图片
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            提示词
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full h-48 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            placeholder="请输入生成三宫格的提示词..."
            disabled={isGenerating}
          />
        </div>

        <div className="px-6 py-4 border-t border-gray-700 flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 border border-gray-600 rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(prompt)}
            disabled={isGenerating || !prompt.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 flex items-center"
          >
            {isGenerating ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                生成中...
              </>
            ) : (
              "确认生成"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
