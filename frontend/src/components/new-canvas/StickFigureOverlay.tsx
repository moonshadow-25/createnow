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
  ['neck', 'leftElbow'],
  ['leftElbow', 'leftHand'],
  ['neck', 'rightElbow'],
  ['rightElbow', 'rightHand'],
  ['neck', 'leftKnee'],
  ['leftKnee', 'leftFoot'],
  ['neck', 'rightKnee'],
  ['rightKnee', 'rightFoot'],
];

const jointRadius: Record<StickFigureJoint, number> = {
  head: 0.032,
  neck: 0.016,
  leftElbow: 0.015,
  rightElbow: 0.015,
  leftHand: 0.016,
  rightHand: 0.016,
  leftKnee: 0.015,
  rightKnee: 0.015,
  leftFoot: 0.016,
  rightFoot: 0.016,
};

function getSvgPoint(event: React.PointerEvent<SVGElement> | PointerEvent, svg: SVGSVGElement): StickFigurePoint {
  const rect = svg.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

export function StickFigureOverlay({ markers, editable = false, onMarkersChange }: StickFigureOverlayProps) {
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

  return (
    <svg
      className="absolute inset-0 h-full w-full touch-none"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      onPointerMove={(event) => {
        if (!editable || !dragState || event.pointerId !== dragState.pointerId) return;
        updateMarkerJoint(dragState.markerId, dragState.joint, getSvgPoint(event, event.currentTarget));
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
              x1={marker.pose[from].x}
              y1={marker.pose[from].y}
              x2={marker.pose[to].x}
              y2={marker.pose[to].y}
              stroke="rgba(0,0,0,0.55)"
              strokeWidth={0.016}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {bonePairs.map(([from, to]) => (
            <line
              key={`${from}-${to}`}
              x1={marker.pose[from].x}
              y1={marker.pose[from].y}
              x2={marker.pose[to].x}
              y2={marker.pose[to].y}
              stroke={marker.color}
              strokeWidth={0.01}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {Object.entries(marker.pose).map(([joint, point]) => {
            const key = joint as StickFigureJoint;
            return (
              <circle
                key={key}
                cx={point.x}
                cy={point.y}
                r={jointRadius[key]}
                fill={marker.color}
                stroke="#ffffff"
                strokeWidth={0.0035}
                vectorEffect="non-scaling-stroke"
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
