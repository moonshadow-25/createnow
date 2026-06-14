import { useState } from 'react';
import {
  moveStickFigurePose,
  normalizeStickFigurePose,
  STICK_FIGURE_JOINTS,
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

const linePairs: [StickFigureJoint, StickFigureJoint][] = [
  ['head', 'body'],
  ['body', 'leftHand'],
  ['body', 'rightHand'],
  ['body', 'leftFoot'],
  ['body', 'rightFoot'],
];

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
    pose: normalizeStickFigurePose(marker, marker.x ?? marker.pose?.body?.x ?? 0.5, marker.y ?? marker.pose?.body?.y ?? 0.5),
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
          {linePairs.map(([from, to]) => (
            <line
              key={`${from}-${to}`}
              x1={marker.pose[from].x}
              y1={marker.pose[from].y}
              x2={marker.pose[to].x}
              y2={marker.pose[to].y}
              stroke="rgba(0,0,0,0.5)"
              strokeWidth={0.014}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {linePairs.map(([from, to]) => (
            <line
              key={`${from}-${to}-color`}
              x1={marker.pose[from].x}
              y1={marker.pose[from].y}
              x2={marker.pose[to].x}
              y2={marker.pose[to].y}
              stroke={marker.color}
              strokeWidth={0.009}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {STICK_FIGURE_JOINTS.map(({ key, label }) => {
            const point = marker.pose[key];
            const isHead = key === 'head';
            return (
              <g key={key}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isHead ? 0.027 : 0.018}
                  fill={marker.color}
                  stroke="#ffffff"
                  strokeWidth={0.004}
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
                {editable && (
                  <text
                    x={point.x}
                    y={point.y - (isHead ? 0.04 : 0.03)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#ffffff"
                    fontSize="0.025"
                    paintOrder="stroke"
                    stroke="#111827"
                    strokeWidth="0.006"
                    className="pointer-events-none select-none"
                  >
                    {label}
                  </text>
                )}
              </g>
            );
          })}
          <text
            x={marker.pose.body.x}
            y={marker.pose.body.y + 0.055}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#ffffff"
            fontSize="0.035"
            fontWeight="700"
            paintOrder="stroke"
            stroke="#111827"
            strokeWidth="0.008"
            className="pointer-events-none select-none"
          >
            {marker.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
