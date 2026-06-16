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
      head: { x: x - 0.005674, y: y - 0.092816 },
      neck: { x, y },
      hip: { x: x + 0.005058, y: y + 0.146625 },
      leftElbow: { x: x - 0.042229, y: y + 0.010418 },
      rightElbow: { x: x + 0.040219, y: y + 0.031373 },
      leftHand: { x: x - 0.076178, y: y + 0.043946 },
      rightHand: { x: x + 0.046282, y: y + 0.138243 },
      leftKnee: { x: x - 0.07502, y: y + 0.060097 },
      rightKnee: { x: x - 0.039804, y: y + 0.077474 },
      leftFoot: { x: x - 0.091995, y: y + 0.17535 },
      rightFoot: { x: x - 0.041071, y: y + 0.229833 },
    };
  }
  if (preset === 'lying') {
    return {
      head: { x: x - 0.062564, y: y - 0.002515 },
      neck: { x, y },
      hip: { x: x + 0.07906, y: y - 0.010885 },
      leftElbow: { x: x + 0.018436, y: y - 0.046508 },
      rightElbow: { x: x + 0.040261, y: y + 0.05198 },
      leftHand: { x: x + 0.082697, y: y - 0.082132 },
      rightHand: { x: x + 0.097247, y: y + 0.049885 },
      leftKnee: { x: x + 0.132826, y: y - 0.039887 },
      rightKnee: { x: x + 0.136046, y: y + 0.024739 },
      leftFoot: { x: x + 0.192237, y: y - 0.039887 },
      rightFoot: { x: x + 0.207582, y: y + 0.035216 },
    };
  }
  if (preset === 'kneeling') {
    return {
      head: { x: x - 0.002104, y: y - 0.095055 },
      neck: { x, y },
      hip: { x: x + 0.001449, y: y + 0.152612 },
      leftElbow: { x: x - 0.0325, y: y + 0.064601 },
      rightElbow: { x: x + 0.029336, y: y + 0.058315 },
      leftHand: { x: x - 0.054325, y: y + 0.137944 },
      rightHand: { x: x + 0.052373, y: y + 0.146326 },
      leftKnee: { x: x - 0.024013, y: y + 0.242719 },
      rightKnee: { x: x + 0.026911, y: y + 0.244814 },
      leftFoot: { x: x - 0.068874, y: y + 0.089747 },
      rightFoot: { x: x + 0.074198, y: y + 0.077174 },
    };
  }
  return {
    head: { x: x + 0.000038, y: y - 0.095614 },
    neck: { x, y },
    hip: { x: x + 0.000995, y: y + 0.130184 },
    leftElbow: { x: x - 0.035425, y: y + 0.043119 },
    rightElbow: { x: x + 0.040486, y: y + 0.047492 },
    leftHand: { x: x - 0.054786, y: y + 0.153235 },
    rightHand: { x: x + 0.049494, y: y + 0.149044 },
    leftKnee: { x: x - 0.018404, y: y + 0.203527 },
    rightKnee: { x: x + 0.025245, y: y + 0.205622 },
    leftFoot: { x: x - 0.025679, y: y + 0.308302 },
    rightFoot: { x: x + 0.03252, y: y + 0.318779 },
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
