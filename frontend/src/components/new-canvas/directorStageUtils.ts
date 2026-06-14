import type { CanvasEdge, CanvasNode } from './types';

export type StickFigurePoint = { x: number; y: number };
export type StickFigureJoint = 'head' | 'neck' | 'leftElbow' | 'rightElbow' | 'leftHand' | 'rightHand' | 'leftKnee' | 'rightKnee' | 'leftFoot' | 'rightFoot';
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
  { key: 'head', label: 'head' },
  { key: 'neck', label: 'neck' },
  { key: 'leftElbow', label: 'leftElbow' },
  { key: 'rightElbow', label: 'rightElbow' },
  { key: 'leftHand', label: 'leftHand' },
  { key: 'rightHand', label: 'rightHand' },
  { key: 'leftKnee', label: 'leftKnee' },
  { key: 'rightKnee', label: 'rightKnee' },
  { key: 'leftFoot', label: 'leftFoot' },
  { key: 'rightFoot', label: 'rightFoot' },
];

export function getDirectorStagePalette(index: number) {
  return DIRECTOR_STAGE_COLORS[index % DIRECTOR_STAGE_COLORS.length];
}

export function getDirectorStageInputLabel(index: number) {
  return `图${index + 1}`;
}

export function createDefaultStickFigurePose(x: number, y: number): StickFigurePose {
  return {
    head: { x, y: clamp(y - 0.08) },
    neck: { x, y: clamp(y - 0.03) },
    leftElbow: { x: clamp(x - 0.07), y: clamp(y - 0.01) },
    rightElbow: { x: clamp(x + 0.07), y: clamp(y - 0.01) },
    leftHand: { x: clamp(x - 0.12), y: clamp(y + 0.04) },
    rightHand: { x: clamp(x + 0.12), y: clamp(y + 0.04) },
    leftKnee: { x: clamp(x - 0.05), y: clamp(y + 0.11) },
    rightKnee: { x: clamp(x + 0.05), y: clamp(y + 0.11) },
    leftFoot: { x: clamp(x - 0.05), y: clamp(y + 0.19) },
    rightFoot: { x: clamp(x + 0.05), y: clamp(y + 0.19) },
  };
}


export function normalizeStickFigurePose(marker: Partial<DirectorStageMarker> | undefined, fallbackX: number, fallbackY: number): StickFigurePose {
  const pose = marker?.pose || createDefaultStickFigurePose(marker?.x ?? fallbackX, marker?.y ?? fallbackY);
  if ('body' in pose) {
    return {
      head: clampPoint(pose.head),
      neck: clampPoint((pose as any).neck || pose.body),
      leftElbow: clampPoint((pose as any).leftElbow || pose.leftHand),
      rightElbow: clampPoint((pose as any).rightElbow || pose.rightHand),
      leftHand: clampPoint(pose.leftHand),
      rightHand: clampPoint(pose.rightHand),
      leftKnee: clampPoint((pose as any).leftKnee || pose.leftFoot),
      rightKnee: clampPoint((pose as any).rightKnee || pose.rightFoot),
      leftFoot: clampPoint(pose.leftFoot),
      rightFoot: clampPoint(pose.rightFoot),
    };
  }
  return {
    head: clampPoint(pose.head),
    neck: clampPoint(pose.neck),
    leftElbow: clampPoint(pose.leftElbow),
    rightElbow: clampPoint(pose.rightElbow),
    leftHand: clampPoint(pose.leftHand),
    rightHand: clampPoint(pose.rightHand),
    leftKnee: clampPoint(pose.leftKnee),
    rightKnee: clampPoint(pose.rightKnee),
    leftFoot: clampPoint(pose.leftFoot),
    rightFoot: clampPoint(pose.rightFoot),
  };
}

export function moveStickFigurePose(pose: StickFigurePose, joint: StickFigureJoint, point: StickFigurePoint): StickFigurePose {
  const nextPoint = clampPoint(point);
  if (joint === 'head') {
    const dx = nextPoint.x - pose.head.x;
    const dy = nextPoint.y - pose.head.y;
    return Object.fromEntries(
      STICK_FIGURE_JOINTS.map(({ key }) => [key, clampPoint({ x: pose[key].x + dx, y: pose[key].y + dy })]),
    ) as StickFigurePose;
  }
  if (joint === 'neck') {
    const dx = nextPoint.x - pose.neck.x;
    const dy = nextPoint.y - pose.neck.y;
    return {
      ...pose,
      neck: nextPoint,
      leftElbow: clampPoint({ x: pose.leftElbow.x + dx, y: pose.leftElbow.y + dy }),
      rightElbow: clampPoint({ x: pose.rightElbow.x + dx, y: pose.rightElbow.y + dy }),
      leftKnee: clampPoint({ x: pose.leftKnee.x + dx, y: pose.leftKnee.y + dy }),
      rightKnee: clampPoint({ x: pose.rightKnee.x + dx, y: pose.rightKnee.y + dy }),
      leftHand: clampPoint({ x: pose.leftHand.x + dx, y: pose.leftHand.y + dy }),
      rightHand: clampPoint({ x: pose.rightHand.x + dx, y: pose.rightHand.y + dy }),
      leftFoot: clampPoint({ x: pose.leftFoot.x + dx, y: pose.leftFoot.y + dy }),
      rightFoot: clampPoint({ x: pose.rightFoot.x + dx, y: pose.rightFoot.y + dy }),
    };
  }
  return { ...pose, [joint]: nextPoint };
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
  const lineWidth = Math.max(4, Math.min(width, height) * 0.01);
  const jointRadius = Math.max(5, Math.min(width, height) * 0.012);
  const headRadius = Math.max(10, Math.min(width, height) * 0.026);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = marker.color;
  context.lineWidth = lineWidth;
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = lineWidth * 0.75;
  context.beginPath();
  drawLine(context, pose.head, pose.neck, width, height);
  drawLine(context, pose.neck, pose.leftElbow, width, height);
  drawLine(context, pose.leftElbow, pose.leftHand, width, height);
  drawLine(context, pose.neck, pose.rightElbow, width, height);
  drawLine(context, pose.rightElbow, pose.rightHand, width, height);
  drawLine(context, pose.neck, pose.leftKnee, width, height);
  drawLine(context, pose.leftKnee, pose.leftFoot, width, height);
  drawLine(context, pose.neck, pose.rightKnee, width, height);
  drawLine(context, pose.rightKnee, pose.rightFoot, width, height);
  context.stroke();
  context.shadowColor = 'transparent';
  context.fillStyle = marker.color;
  const jointMap: Array<[StickFigureJoint, number]> = [
    ['head', headRadius],
    ['neck', jointRadius * 1.1],
    ['leftElbow', jointRadius],
    ['rightElbow', jointRadius],
    ['leftHand', jointRadius],
    ['rightHand', jointRadius],
    ['leftKnee', jointRadius],
    ['rightKnee', jointRadius],
    ['leftFoot', jointRadius],
    ['rightFoot', jointRadius],
  ];
  jointMap.forEach(([key, radius]) => {
    const point = pose[key];
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#ffffff';
    context.lineWidth = Math.max(1.5, lineWidth * 0.3);
    context.stroke();
  });
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
