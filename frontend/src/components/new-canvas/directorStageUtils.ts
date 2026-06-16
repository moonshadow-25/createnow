import type { CanvasEdge, CanvasNode } from './types';

export type StickFigurePoint = { x: number; y: number };
export type StickFigureJoint = 'head' | 'neck' | 'hip' | 'leftElbow' | 'rightElbow' | 'leftHand' | 'rightHand' | 'leftKnee' | 'rightKnee' | 'leftFoot' | 'rightFoot';
export type StickFigurePose = Record<StickFigureJoint, StickFigurePoint>;
export type StickFigurePosePreset = 'standing' | 'sitting' | 'lying' | 'kneeling';

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

export type DirectorStageCompositeMarker = Pick<DirectorStageMarker, 'color' | 'colorName' | 'label' | 'pose' | 'scale'>;

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
const keepPoint = (point: StickFigurePoint): StickFigurePoint => ({ x: point.x, y: point.y });
const clampScale = (value: number) => Math.min(1.8, Math.max(0.6, value));

export const STICK_FIGURE_JOINTS: { key: StickFigureJoint; label: string }[] = [
  { key: 'head', label: 'head' },
  { key: 'neck', label: 'neck' },
  { key: 'hip', label: 'hip' },
  { key: 'leftElbow', label: 'leftElbow' },
  { key: 'rightElbow', label: 'rightElbow' },
  { key: 'leftHand', label: 'leftHand' },
  { key: 'rightHand', label: 'rightHand' },
  { key: 'leftKnee', label: 'leftKnee' },
  { key: 'rightKnee', label: 'rightKnee' },
  { key: 'leftFoot', label: 'leftFoot' },
  { key: 'rightFoot', label: 'rightFoot' },
];

export function getStickFigureBaseSize(width: number, height: number) {
  return Math.max(8, Math.min(width, height) * 0.028);
}

export function getStickFigureScale(marker: Partial<DirectorStageMarker> | undefined) {
  return clampScale(marker?.scale ?? 1);
}

export function scaleStickFigurePoint(point: StickFigurePoint, anchor: StickFigurePoint, scale: number): StickFigurePoint {
  if (scale === 1) return point;
  return {
    x: anchor.x + (point.x - anchor.x) * scale,
    y: anchor.y + (point.y - anchor.y) * scale,
  };
}

export function unscaleStickFigurePoint(point: StickFigurePoint, anchor: StickFigurePoint, scale: number): StickFigurePoint {
  if (scale === 1) return keepPoint(point);
  return keepPoint({
    x: anchor.x + (point.x - anchor.x) / scale,
    y: anchor.y + (point.y - anchor.y) / scale,
  });
}

export function scaleStickFigurePose(pose: StickFigurePose, scale: number): StickFigurePose {
  const anchor = pose.neck;
  return Object.fromEntries(
    STICK_FIGURE_JOINTS.map(({ key }) => [key, scaleStickFigurePoint(pose[key], anchor, scale)]),
  ) as StickFigurePose;
}

export function getStickFigureJointRadius(joint: StickFigureJoint, baseSize: number) {
  if (joint === 'head') return baseSize * 1.75;
  return baseSize / 2;
}

export function getDirectorStagePalette(index: number) {
  return DIRECTOR_STAGE_COLORS[index % DIRECTOR_STAGE_COLORS.length];
}

export function getDirectorStageInputLabel(index: number) {
  return `图${index + 1}`;
}

export function createDefaultStickFigurePose(x: number, y: number): StickFigurePose {
  return createStickFigurePosePreset('standing', x, y);
}

export function createStickFigurePosePreset(preset: StickFigurePosePreset, x: number, y: number): StickFigurePose {
  if (preset === 'sitting') {
    return {
      head: { x, y: y - 0.13 },
      neck: { x, y: y - 0.055 },
      hip: { x, y: y + 0.055 },
      leftElbow: { x: x - 0.075, y: y - 0.01 },
      rightElbow: { x: x + 0.075, y: y - 0.01 },
      leftHand: { x: x - 0.14, y: y + 0.035 },
      rightHand: { x: x + 0.14, y: y + 0.035 },
      leftKnee: { x: x - 0.12, y: y + 0.1 },
      rightKnee: { x: x + 0.12, y: y + 0.1 },
      leftFoot: { x: x - 0.18, y: y + 0.1 },
      rightFoot: { x: x + 0.18, y: y + 0.1 },
    };
  }
  if (preset === 'lying') {
    return {
      head: { x: x - 0.18, y: y - 0.01 },
      neck: { x: x - 0.105, y },
      hip: { x: x + 0.055, y },
      leftElbow: { x: x - 0.055, y: y - 0.06 },
      rightElbow: { x: x - 0.055, y: y + 0.06 },
      leftHand: { x: x + 0.035, y: y - 0.075 },
      rightHand: { x: x + 0.035, y: y + 0.075 },
      leftKnee: { x: x + 0.16, y: y - 0.055 },
      rightKnee: { x: x + 0.16, y: y + 0.055 },
      leftFoot: { x: x + 0.27, y: y - 0.055 },
      rightFoot: { x: x + 0.27, y: y + 0.055 },
    };
  }
  if (preset === 'kneeling') {
    return {
      head: { x, y: y - 0.13 },
      neck: { x, y: y - 0.055 },
      hip: { x, y: y + 0.055 },
      leftElbow: { x: x - 0.075, y: y - 0.01 },
      rightElbow: { x: x + 0.075, y: y - 0.01 },
      leftHand: { x: x - 0.14, y: y + 0.035 },
      rightHand: { x: x + 0.14, y: y + 0.035 },
      leftKnee: { x: x - 0.07, y: y + 0.15 },
      rightKnee: { x: x + 0.07, y: y + 0.15 },
      leftFoot: { x: x - 0.16, y: y + 0.16 },
      rightFoot: { x: x + 0.16, y: y + 0.16 },
    };
  }
  return {
    head: { x, y: y - 0.13 },
    neck: { x, y: y - 0.055 },
    hip: { x, y: y + 0.055 },
    leftElbow: { x: x - 0.075, y: y - 0.01 },
    rightElbow: { x: x + 0.075, y: y - 0.01 },
    leftHand: { x: x - 0.14, y: y + 0.035 },
    rightHand: { x: x + 0.14, y: y + 0.035 },
    leftKnee: { x: x - 0.055, y: y + 0.15 },
    rightKnee: { x: x + 0.055, y: y + 0.15 },
    leftFoot: { x: x - 0.12, y: y + 0.27 },
    rightFoot: { x: x + 0.12, y: y + 0.27 },
  };
}


export function normalizeStickFigurePose(marker: Partial<DirectorStageMarker> | undefined, fallbackX: number, fallbackY: number): StickFigurePose {
  const defaults = createDefaultStickFigurePose(marker?.x ?? fallbackX, marker?.y ?? fallbackY);
  const pose = marker?.pose || defaults;
  const pick = (key: StickFigureJoint, fallback?: StickFigurePoint) => keepPoint((pose as any)[key] || fallback || defaults[key]);
  if ('body' in pose) {
    return {
      head: pick('head'),
      neck: pick('neck', (pose as any).body),
      hip: pick('hip', (pose as any).body || (pose as any).leftFoot),
      leftElbow: pick('leftElbow', (pose as any).leftHand),
      rightElbow: pick('rightElbow', (pose as any).rightHand),
      leftHand: pick('leftHand'),
      rightHand: pick('rightHand'),
      leftKnee: pick('leftKnee', (pose as any).leftFoot),
      rightKnee: pick('rightKnee', (pose as any).rightFoot),
      leftFoot: pick('leftFoot'),
      rightFoot: pick('rightFoot'),
    };
  }
  return {
    head: pick('head'),
    neck: pick('neck'),
    hip: pick('hip'),
    leftElbow: pick('leftElbow'),
    rightElbow: pick('rightElbow'),
    leftHand: pick('leftHand'),
    rightHand: pick('rightHand'),
    leftKnee: pick('leftKnee'),
    rightKnee: pick('rightKnee'),
    leftFoot: pick('leftFoot'),
    rightFoot: pick('rightFoot'),
  };
}

export function moveStickFigurePose(pose: StickFigurePose, joint: StickFigureJoint, point: StickFigurePoint): StickFigurePose {
  const nextPoint = keepPoint(point);
  if (joint === 'head') {
    const dx = nextPoint.x - pose.head.x;
    const dy = nextPoint.y - pose.head.y;
    return Object.fromEntries(
      STICK_FIGURE_JOINTS.map(({ key }) => [key, keepPoint({ x: pose[key].x + dx, y: pose[key].y + dy })]),
    ) as StickFigurePose;
  }
  return { ...pose, [joint]: nextPoint };
}


export function syncDirectorStageMarkers({ incomingEdges, nodes, currentMarkers }: DirectorStageSyncArgs): DirectorStageMarker[] {
  const markerByEdgeId = new Map(currentMarkers.map((marker) => [marker.edgeId, marker]));
  const markerBySource = new Map(currentMarkers.map((marker) => [`${marker.sourceNodeId}:${marker.sourcePort}`, marker]));
  return incomingEdges.map((edge, index) => {
    const existing = markerByEdgeId.get(edge.edge_id) || markerBySource.get(`${edge.source_node_id}:${edge.source_port}`);
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
      color: palette.color,
      colorName: palette.colorName,
      label: getDirectorStageInputLabel(index),
      pose: normalizeStickFigurePose(existing, clamp(x, 0.08, 0.88), clamp(y, 0.08, 0.82)),
      scale: getStickFigureScale(existing),
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
  const scale = getStickFigureScale(marker);
  const pose = scaleStickFigurePose(marker.pose, scale);
  const boneWidth = getStickFigureBaseSize(width, height) * scale;
  const jointRadius = getStickFigureJointRadius('neck', boneWidth);
  const headRadius = getStickFigureJointRadius('head', boneWidth);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = marker.color;
  context.lineWidth = boneWidth;
  context.shadowColor = 'rgba(0, 0, 0, 0.35)';
  context.shadowBlur = boneWidth * 0.4;
  context.beginPath();
  drawLine(context, pose.head, pose.neck, width, height);
  drawLine(context, pose.neck, pose.hip, width, height);
  drawLine(context, pose.neck, pose.leftElbow, width, height);
  drawLine(context, pose.leftElbow, pose.leftHand, width, height);
  drawLine(context, pose.neck, pose.rightElbow, width, height);
  drawLine(context, pose.rightElbow, pose.rightHand, width, height);
  drawLine(context, pose.hip, pose.leftKnee, width, height);
  drawLine(context, pose.leftKnee, pose.leftFoot, width, height);
  drawLine(context, pose.hip, pose.rightKnee, width, height);
  drawLine(context, pose.rightKnee, pose.rightFoot, width, height);
  context.stroke();
  context.shadowColor = 'transparent';
  context.fillStyle = marker.color;
  const jointMap: Array<[StickFigureJoint, number]> = [
    ['head', headRadius],
    ['neck', jointRadius],
    ['hip', jointRadius],
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
    context.lineWidth = 2;
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
