import type { CanvasEdge, CanvasNode } from './types';

export type DirectorStageMarker = {
  id: string;
  edgeId: string;
  sourceNodeId: string;
  sourcePort: string;
  sourceLabel: string;
  color: string;
  colorName: string;
  label: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
};

export type DirectorStageSyncArgs = {
  incomingEdges: CanvasEdge[];
  nodes: CanvasNode[];
  currentMarkers: DirectorStageMarker[];
};

export type DirectorStageCompositeMarker = Pick<DirectorStageMarker, 'color' | 'colorName' | 'label' | 'x' | 'y' | 'scale' | 'rotation'>;

export const DIRECTOR_STAGE_COLORS = [
  { color: '#ef4444', colorName: '红色' },
  { color: '#22c55e', colorName: '绿色' },
  { color: '#3b82f6', colorName: '蓝色' },
  { color: '#eab308', colorName: '黄色' },
  { color: '#a855f7', colorName: '紫色' },
  { color: '#f97316', colorName: '橙色' },
  { color: '#14b8a6', colorName: '青色' },
  { color: '#ec4899', colorName: '粉色' },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function getDirectorStagePalette(index: number) {
  return DIRECTOR_STAGE_COLORS[index % DIRECTOR_STAGE_COLORS.length];
}

export function getDirectorStageInputLabel(index: number) {
  return `图${index + 1}`;
}

export function syncDirectorStageMarkers({ incomingEdges, nodes, currentMarkers }: DirectorStageSyncArgs): DirectorStageMarker[] {
  const markerByEdgeId = new Map(currentMarkers.map((marker) => [marker.edgeId, marker]));
  return incomingEdges.map((edge, index) => {
    const existing = markerByEdgeId.get(edge.edge_id);
    const sourceNode = nodes.find((node) => node.node_id === edge.source_node_id);
    const palette = getDirectorStagePalette(index);
    return {
      id: existing?.id || `director-marker-${edge.edge_id}`,
      edgeId: edge.edge_id,
      sourceNodeId: edge.source_node_id,
      sourcePort: edge.source_port,
      sourceLabel: sourceNode?.label || existing?.sourceLabel || getDirectorStageInputLabel(index),
      color: existing?.color || palette.color,
      colorName: existing?.colorName || palette.colorName,
      label: getDirectorStageInputLabel(index),
      x: existing ? clamp(existing.x, 0.04, 0.96) : clamp(0.22 + (index % 3) * 0.22, 0.08, 0.88),
      y: existing ? clamp(existing.y, 0.08, 0.92) : clamp(0.28 + Math.floor(index / 3) * 0.2, 0.08, 0.92),
      scale: existing ? clamp(existing.scale, 0.45, 1.65) : 1,
      rotation: existing ? existing.rotation : 0,
    };
  });
}

function getMarkerSubject(index: number) {
  return `@图${index + 1}中的主体`;
}

export function buildDirectorStagePrompt(markers: DirectorStageCompositeMarker[]) {
  if (!markers.length) return '请根据场景图摆放角色，并保持位置关系、比例和朝向自然。';
  const compositeIndex = markers.length + 1;
  const subjects = markers.map((_, index) => getMarkerSubject(index)).join('、');
  const placementLines = markers.map((marker, index) => `@图${index + 1}中主体的位置严格参考@图${compositeIndex}中的${marker.colorName}小人，并且替换${marker.colorName}小人。`);
  return `${subjects}在图${compositeIndex}中。\n\n${placementLines.join('\n')}`;
}

function createOverlayContext(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建画布上下文');
  return { canvas, context };
}

function loadImage(sourceUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('场景图加载失败'));
    image.src = sourceUrl;
  });
}

function drawPersonMarker(context: CanvasRenderingContext2D, color: string, colorName: string, x: number, y: number, scale: number, rotation: number, label: string) {
  const size = 130 * scale;
  const bodyHeight = size * 0.62;
  const bodyWidth = size * 0.34;
  const headRadius = size * 0.12;
  const badgeWidth = Math.max(74, size * 0.68);
  const badgeHeight = Math.max(28, size * 0.22);

  context.save();
  context.translate(x, y);
  context.rotate((rotation * Math.PI) / 180);
  context.shadowColor = 'rgba(0, 0, 0, 0.3)';
  context.shadowBlur = size * 0.14;
  context.shadowOffsetY = size * 0.06;

  const gradient = context.createLinearGradient(-size * 0.18, -bodyHeight * 0.7, size * 0.2, bodyHeight * 0.38);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.1, color);
  gradient.addColorStop(1, '#111827');

  context.beginPath();
  context.arc(0, -bodyHeight * 0.55, headRadius, 0, Math.PI * 2);
  context.fillStyle = gradient;
  context.fill();

  context.shadowColor = 'transparent';
  context.beginPath();
  context.ellipse(0, -bodyHeight * 0.16, bodyWidth * 0.82, bodyHeight * 0.3, 0, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();

  context.fillStyle = '#f8fafc';
  context.beginPath();
  context.moveTo(-bodyWidth * 0.42, -bodyHeight * 0.02);
  context.lineTo(-bodyWidth * 0.08, bodyHeight * 0.55);
  context.lineTo(bodyWidth * 0.02, bodyHeight * 0.55);
  context.lineTo(-bodyWidth * 0.1, -bodyHeight * 0.02);
  context.closePath();
  context.fill();

  context.beginPath();
  context.moveTo(bodyWidth * 0.42, -bodyHeight * 0.02);
  context.lineTo(bodyWidth * 0.08, bodyHeight * 0.55);
  context.lineTo(-bodyWidth * 0.02, bodyHeight * 0.55);
  context.lineTo(bodyWidth * 0.1, -bodyHeight * 0.02);
  context.closePath();
  context.fill();

  context.fillStyle = '#e5e7eb';
  context.beginPath();
  context.roundRect(-bodyWidth * 0.46, -bodyHeight * 0.38, bodyWidth * 0.92, bodyHeight * 0.2, bodyWidth * 0.08);
  context.fill();

  context.fillStyle = '#0f172a';
  context.beginPath();
  context.roundRect(-badgeWidth / 2, bodyHeight * 0.58, badgeWidth, badgeHeight, badgeHeight / 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = `bold ${Math.max(12, badgeHeight * 0.46)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(`${label} · ${colorName}`, 0, bodyHeight * 0.58 + badgeHeight / 2);

  context.restore();
}

export async function renderDirectorStageComposite(sceneUrl: string, markers: DirectorStageCompositeMarker[]) {
  if (!sceneUrl) throw new Error('缺少场景图');
  const scene = await loadImage(sceneUrl);
  const { canvas, context } = createOverlayContext(scene.naturalWidth || scene.width || 1, scene.naturalHeight || scene.height || 1);
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.drawImage(scene, 0, 0, width, height);
  markers.forEach((marker, index) => {
    drawPersonMarker(
      context,
      marker.color,
      marker.colorName,
      clamp(marker.x, 0, 1) * width,
      clamp(marker.y, 0, 1) * height,
      clamp(marker.scale, 0.45, 1.65),
      marker.rotation,
      getDirectorStageInputLabel(index),
    );
  });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('合成图导出失败'));
      else resolve(blob);
    }, 'image/png');
  });
}
