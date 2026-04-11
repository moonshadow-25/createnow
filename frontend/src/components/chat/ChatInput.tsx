import { useRef, useState } from 'react';
import { Send, FileText, X, Upload } from 'lucide-react';
import { useToast } from '@/components/common/Toast';

export interface UploadedFile {
  name: string;
  content: string;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (message: string) => void;
  isStreaming: boolean;
  uploadedFiles: UploadedFile[];
  onFileLoaded: (file: UploadedFile) => void;
  onClearFile: (index: number) => void;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  isStreaming,
  uploadedFiles,
  onFileLoaded,
  onClearFile,
}: ChatInputProps) {
  const { toast } = useToast();
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!value.trim() && uploadedFiles.length === 0) return;
    if (isStreaming) return;

    // 构建发送消息：用户输入 + 所有文件内容
    let message = value;
    if (uploadedFiles.length > 0) {
      const filesContent = uploadedFiles
        .map(f => `[剧本文件: ${f.name}]\n${f.content}`)
        .join('\n\n');
      message = value ? `${value}\n\n${filesContent}` : filesContent;
    }

    onSend(message);
  };

  const handleFileLoad = async (file: File) => {
    // 验证文件类型
    if (!file.name.endsWith('.txt') && !file.name.endsWith('.md')) {
      toast('仅支持 .txt 和 .md 格式的剧本文件', 'error');
      return;
    }

    try {
      const content = await file.text();
      onFileLoaded({
        name: file.name,
        content: content
      });
      toast(`已加载剧本: ${file.name}`, 'success');
    } catch (error: any) {
      toast(`读取文件失败: ${error.message}`, 'error');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files) {
      Array.from(files).forEach(handleFileLoad);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  return (
    <div className="border-t border-gray-700 p-4">
      {/* 上传文件指示器列表 */}
      {uploadedFiles.length > 0 && (
        <div className="mb-2 space-y-1">
          {uploadedFiles.map((file, index) => (
            <div
              key={index}
              className="p-2 bg-blue-900 bg-opacity-30 border border-blue-700 rounded-lg flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-blue-400" />
                <span className="text-sm text-blue-300">{file.name}</span>
                <span className="text-xs text-gray-400">(已加载)</span>
              </div>
              <button
                onClick={() => onClearFile(index)}
                className="text-gray-400 hover:text-red-400 transition"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 拖拽上传区域 + 输入框 */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        className={`relative rounded-lg transition-colors ${
          isDragging
            ? 'bg-blue-900 bg-opacity-20 border-2 border-blue-500 border-dashed'
            : ''
        }`}
      >
        {isDragging && (
          <div className="absolute inset-0 flex items-center justify-center bg-blue-900 bg-opacity-40 rounded-lg z-10 pointer-events-none">
            <div className="text-center">
              <Upload size={32} className="mx-auto text-blue-400 mb-2" />
              <p className="text-blue-300">拖放剧本文件到此处</p>
            </div>
          </div>
        )}

        {/* 快捷语句按钮 */}
        <div className="flex gap-2 mb-2">
          {[
            { label: '提取资产', text: '提取资产', className: 'bg-emerald-700 hover:bg-emerald-600 text-emerald-100' },
            { label: '匹配资产', text: '匹配资产', className: 'bg-violet-700 hover:bg-violet-600 text-violet-100' },
            { label: '重新生成分镜', text: '重新生成分镜', className: 'bg-blue-700 hover:bg-blue-600 text-blue-100' },
          ].map(({ label, text, className }) => (
            <button
              key={label}
              onClick={() => onSend(text)}
              disabled={isStreaming}
              className={`px-3 py-1 text-xs disabled:opacity-40 disabled:cursor-not-allowed rounded-full transition ${className}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="我可以创建、修改分镜、资产中的所有内容，告诉我你的想法，我来实现"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 resize-y focus:outline-none focus:border-blue-500"
            rows={3}
            disabled={isStreaming}
          />
          <div className="flex justify-end">
            <button
              onClick={handleSend}
              disabled={isStreaming || (!value.trim() && uploadedFiles.length === 0)}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 px-4 py-1.5 rounded-lg transition flex items-center gap-1.5 text-sm"
            >
              <Send size={14} />
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
