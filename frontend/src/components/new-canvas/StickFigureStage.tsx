import { useEffect, useMemo, useRef, useState } from 'react';
import { StickFigureOverlay } from './StickFigureOverlay';
import type { DirectorStageMarker } from './directorStageUtils';

type Rect = { left: number; top: number; width: number; height: number };

type StickFigureStageProps = {
  imageUrl: string;
  markers: DirectorStageMarker[];
  editable?: boolean;
  alt?: string;
  className?: string;
  onMarkersChange?: (markers: DirectorStageMarker[]) => void;
};

function computeContainRect(containerWidth: number, containerHeight: number, imageWidth: number, imageHeight: number): Rect {
  if (!containerWidth || !containerHeight || !imageWidth || !imageHeight) {
    return { left: 0, top: 0, width: containerWidth, height: containerHeight };
  }
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  };
}

export function StickFigureStage({
  imageUrl,
  markers,
  editable = false,
  alt,
  className = 'relative h-full w-full overflow-hidden',
  onMarkersChange,
}: StickFigureStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateSize = () => setContainerSize({ width: element.clientWidth, height: element.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onImageLoad = () => {
    const image = imageRef.current;
    if (!image) return;
    setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
  };

  useEffect(() => {
    onImageLoad();
  }, [imageUrl]);

  const rect = useMemo(() => computeContainRect(containerSize.width, containerSize.height, imageSize.width, imageSize.height), [containerSize, imageSize]);

  return (
    <div ref={containerRef} className={className}>
      <img
        ref={imageRef}
        src={imageUrl}
        alt={alt || '火柴人场景图'}
        draggable={false}
        onLoad={onImageLoad}
        className="absolute select-none"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      />
      {rect.width > 0 && rect.height > 0 && (
        <div
          className="absolute"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          <StickFigureOverlay markers={markers} editable={editable} onMarkersChange={onMarkersChange} />
        </div>
      )}
    </div>
  );
}
