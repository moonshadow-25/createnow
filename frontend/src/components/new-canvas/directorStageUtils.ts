import type { CanvasEdge, CanvasNode } from './types';

export type StickFigurePoint = { x: number; y: number };
export type StickFigureJoint = 'head' | 'body' | 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot';
export type StickFigurePose = Record<StickFigureJoint, StickFigurePoint>;

export type DirectorStageMarker = {
  id: string;
  edgeId: string;
  sourceNodeId: string;
  sourcePort: string;
  sourceLabel: string;
  color: string;
  colorName: string;
  label: string;
  pose: StickFigurePose;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
};

export type DirectorStageSyncArgs = {
  incomingEdges: CanvasEdge[];
  nodes: CanvasNode[];
  currentMarkers: DirectorStageMarker[];
};

export type DirectorStageCompositeMarker = Pick<DirectorStageMarker, 'color' | 'colorName' | 'label' | 'pose'>;

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

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const clampPoint = (point: StickFigurePoint): StickFigurePoint => ({ x: clamp(point.x), y: clamp(point.y) });

export const STICK_FIGURE_JOINTS: { key: StickFigureJoint; label: string }[] = [
  { key: 'head', label: '头' },
  { key: 'body', label: '身体' },
  { key: 'leftHand', label: '左手' },
  { key: 'rightHand', label: '右手' },
  { key: 'leftFoot', label: '左脚' },
  { key: 'rightFoot', label: '右脚' },
];

export function getDirectorStagePalette(index: number) {
  return DIRECTOR_STAGE_COLORS[index % DIRECTOR_STAGE_COLORS.length];
}

export function getDirectorStageInputLabel(index: number) {
  return `图${index + 1}`;
}

export function createDefaultStickFigurePose(x: number, y: number): StickFigurePose {
  return {
    head: { x, y: clamp(y - 0.07) },
    body: { x, y },
    leftHand: { x: clamp(x - 0.07), y: clamp(y + 0.01) },
    rightHand: { x: clamp(x + 0.07), y: clamp(y + 0.01) },
    leftFoot: { x: clamp(x - 0.045), y: clamp(y + 0.12) },
    rightFoot: { x: clamp(x + 0.045), y: clamp(y + 0.12) },
  };
}

export function normalizeStickFigurePose(marker: Partial<DirectorStageMarker> | undefined, fallbackX: number, fallbackY: number): StickFigurePose {
  const pose = marker?.pose || createDefaultStickFigurePose(marker?.x ?? fallbackX, marker?.y ?? fallbackY);
  return {
    head: clampPoint(pose.head),
    body: clampPoint(pose.body),
    leftHand: clampPoint(pose.leftHand),
    rightHand: clampPoint(pose.rightHand),
    leftFoot: clampPoint(pose.leftFoot),
    rightFoot: clampPoint(pose.rightFoot),
  };
}

export function moveStickFigurePose(pose: StickFigurePose, joint: StickFigureJoint, point: StickFigurePoint): StickFigurePose {
  const nextPoint = clampPoint(point);
  if (joint !== 'head' && joint !== 'body') return { ...pose, [joint]: nextPoint };
  const origin = pose[joint];
  const dx = nextPoint.x - origin.x;
  const dy = nextPoint.y - origin.y;
  return Object.fromEntries(
    STICK_FIGURE_JOINTS.map(({ key }) => [key, clampPoint({ x: pose[key].x + dx, y: pose[key].y + dy })]),
  ) as StickFigurePose;
}

export function syncDirectorStageMarkers({ incomingEdges, nodes, currentMarkers }: DirectorStageSyncArgs): DirectorStageMarker[] {
  const markerByEdgeId = new Map(currentMarkers.map((marker) => [marker.edgeId, marker]));
  return incomingEdges.map((edge, index) => {
    const existing = markerByEdgeId.get(edge.edge_id);
    const sourceNode = nodes.find((node) => node.node_id === edge.source_node_id);
    const palette = getDirectorStagePalette(index);
    const x = existing?.x ?? 0.22 + (index % 3) * 0.22;
    const y = existing?.y ?? 0.28 + Math.floor(index / 3) * 0.2;
    return {
      id: existing?.id || `director-marker-${edge.edge_id}`,
      edgeId: edge.edge_id,
      sourceNodeId: edge.source_node_id,
      sourcePort: edge.source_port,
      sourceLabel: sourceNode?.label || existing?.sourceLabel || getDirectorStageInputLabel(index),
      color: existing?.color || palette.color,
      colorName: existing?.colorName || palette.colorName,
      label: getDirectorStageInputLabel(index),
      pose: normalizeStickFigurePose(existing, clamp(x, 0.08, 0.88), clamp(y, 0.08, 0.82)),
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
  const placementLines = markers.map((marker, index) => `@图${index + 1}中主体的位置严格参考@图${compositeIndex}中的${marker.colorName}火柴人，并且替换${marker.colorName}火柴人。`);
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

function drawLine(context: CanvasRenderingContext2D, from: StickFigurePoint, to: StickFigurePoint, width: number, height: number) {
  context.moveTo(from.x * width, from.y * height);
  context.lineTo(to.x * width, to.y * height);
}

export function drawStickFigure(context: CanvasRenderingContext2D, marker: DirectorStageCompositeMarker, width: number, height: number) {
  const pose = marker.pose;
  const lineWidth = Math.max(5, Math.min(width, height) * 0.012);
  const jointRadius = Math.max(7, Math.min(width, height) * 0.018);
  const headRadius = Math.max(12, Math.min(width, height) * 0.035);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = marker.color;
  context.lineWidth = lineWidth;
  context.shadowColor = 'rgba(0, 0, 0, 0.45)';
  context.shadowBlur = lineWidth;
  context.beginPath();
  drawLine(context, pose.head, pose.body, width, height);
  drawLine(context, pose.body, pose.leftHand, width, height);
  drawLine(context, pose.body, pose.rightHand, width, height);
  drawLine(context, pose.body, pose.leftFoot, width, height);
  drawLine(context, pose.body, pose.rightFoot, width, height);
  context.stroke();
  context.shadowColor = 'transparent';
  context.fillStyle = marker.color;
  STICK_FIGURE_JOINTS.forEach(({ key }) => {
    const radius = key === 'head' ? headRadius : jointRadius;
    const point = pose[key];
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = Math.max(2, lineWidth * 0.35);
    context.stroke();
  });
  context.fillStyle = '#ffffff';
  context.font = `bold ${Math.max(12, Math.min(width, height) * 0.022)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(marker.label, pose.body.x * width, (pose.body.y + 0.035) * height);
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
  markers.forEach((marker) => drawStickFigure(context, marker, width, height));
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('合成图导出失败'));
      else resolve(blob);
    }, 'image/png');
  });
}
