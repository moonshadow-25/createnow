import { X } from 'lucide-react';

interface ImagePreviewModalProps {
  imageUrl: string;
  title: string;
  subtitle?: string;
  alt?: string;
  zIndexClassName?: string;
  onClose: () => void;
}

export function ImagePreviewModal({
  imageUrl,
  title,
  subtitle,
  alt,
  zIndexClassName = 'z-[70]',
  onClose,
}: ImagePreviewModalProps) {
  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/80 p-6 ${zIndexClassName}`}
      onMouseDown={onClose}
    >
      <div className="relative max-h-[90vh] max-w-[90vw]" onMouseDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-10 right-0 text-gray-300 hover:text-white"
          aria-label="关闭大图预览"
        >
          <X size={24} />
        </button>
        <img
          src={imageUrl}
          alt={alt || title}
          draggable={false}
          className="max-h-[80vh] max-w-full rounded-lg bg-gray-900 object-contain shadow-2xl"
        />
        <div className="mt-3 text-sm text-gray-200">{title}</div>
        {subtitle && <div className="mt-1 text-xs text-gray-500">{subtitle}</div>}
      </div>
    </div>
  );
}
