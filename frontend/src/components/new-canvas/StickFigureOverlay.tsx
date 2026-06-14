import { useState } from 'react';
import {
  moveStickFigurePose,
  normalizeStickFigurePose,
  type DirectorStageMarker,
  type StickFigureJoint,
  type StickFigurePoint,
} from './directorStageUtils';

export type StickFigureOverlayProps = {
  markers: DirectorStageMarker[];
  width: number;
  height: number;
  editable?: boolean;
  onMarkersChange?: (markers: DirectorStageMarker[]) => void;
};

type DragState = {
  markerId: string;
  joint: StickFigureJoint;
  pointerId: number;
};

const bonePairs: [StickFigureJoint, StickFigureJoint][] = [
  ['head', 'neck'],
  ['neck', 'hip'],
  ['neck', 'leftElbow'],
  ['leftElbow', 'leftHand'],
  ['neck', 'rightElbow'],
  ['rightElbow', 'rightHand'],
  ['hip', 'leftKnee'],
  ['leftKnee', 'leftFoot'],
  ['hip', 'rightKnee'],
  ['rightKnee', 'rightFoot'],
];

const getBaseSize = (width: number, height: number) => Math.max(8, Math.min(width, height) * 0.028);
const getJointRadius = (joint: StickFigureJoint, baseSize: number) => {
  if (joint === 'head') return baseSize * 1.35;
  return baseSize / 2;
};

function getSvgPoint(event: React.PointerEvent<SVGElement> | PointerEvent, svg: SVGSVGElement): StickFigurePoint {
  const rect = svg.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

export function StickFigureOverlay({ markers, width, height, editable = false, onMarkersChange }: StickFigureOverlayProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const normalizedMarkers = markers.map((marker) => ({
    ...marker,
    pose: normalizeStickFigurePose(marker, marker.x ?? marker.pose?.neck?.x ?? 0.5, marker.y ?? marker.pose?.neck?.y ?? 0.5),
  }));

  const updateMarkerJoint = (markerId: string, joint: StickFigureJoint, point: StickFigurePoint) => {
    onMarkersChange?.(normalizedMarkers.map((marker) => marker.id === markerId
      ? { ...marker, pose: moveStickFigurePose(marker.pose, joint, point) }
      : marker));
  };

  const baseSize = getBaseSize(width, height);

  return (
    <svg
      className="absolute inset-0 h-full w-full touch-none"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onPointerMove={(event) => {
        if (!editable || !dragState || event.pointerId !== dragState.pointerId) return;
        const point = getSvgPoint(event, event.currentTarget);
        updateMarkerJoint(dragState.markerId, dragState.joint, point);
      }}
      onPointerUp={(event) => {
        if (dragState?.pointerId === event.pointerId) setDragState(null);
      }}
      onPointerCancel={(event) => {
        if (dragState?.pointerId === event.pointerId) setDragState(null);
      }}
    >
      {normalizedMarkers.map((marker) => (
        <g key={marker.id}>
          {bonePairs.map(([from, to]) => (
            <line
              key={`${from}-${to}-shadow`}
              x1={marker.pose[from].x * width}
              y1={marker.pose[from].y * height}
              x2={marker.pose[to].x * width}
              y2={marker.pose[to].y * height}
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={baseSize * 1.35}
              strokeLinecap="round"
            />
          ))}
          {bonePairs.map(([from, to]) => (
            <line
              key={`${from}-${to}`}
              x1={marker.pose[from].x * width}
              y1={marker.pose[from].y * height}
              x2={marker.pose[to].x * width}
              y2={marker.pose[to].y * height}
              stroke={marker.color}
              strokeWidth={baseSize}
              strokeLinecap="round"
            />
          ))}
          {Object.entries(marker.pose).map(([joint, point]) => {
            const key = joint as StickFigureJoint;
            const radius = getJointRadius(key, baseSize);
            return (
              <circle
                key={key}
                cx={point.x * width}
                cy={point.y * height}
                r={radius}
                fill={marker.color}
                stroke="#ffffff"
                strokeWidth={2}
                className={editable ? 'cursor-grab active:cursor-grabbing' : ''}
                onPointerDown={(event) => {
                  if (!editable) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragState({ markerId: marker.id, joint: key, pointerId: event.pointerId });
                }}
              />
            );
          })}
        </g>
      ))}
    </svg>
  );
}
