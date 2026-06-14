import { ZoomIn } from 'lucide-react';

type CanvasImageNodePreviewProps = {
  imageUrl: string;
  title: string;
  height: number;
  onOpenPreview: (url: string, title: string) => void;
};

export function CanvasImageNodePreview({ imageUrl, title, height, onOpenPreview }: CanvasImageNodePreviewProps) {
  return (
    <div className="group relative w-full overflow-hidden rounded-lg bg-gray-950" style={{ height }}>
      <img src={imageUrl} alt={title} draggable={false} className="h-full w-full object-cover" />
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onOpenPreview(imageUrl, title); }}
        className="absolute left-1/2 top-1/2 hidden h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/70 text-white shadow-2xl ring-1 ring-white/30 hover:bg-black/90 group-hover:flex"
        title="放大查看"
      >
        <ZoomIn size={28} />
      </button>
    </div>
  );
}
