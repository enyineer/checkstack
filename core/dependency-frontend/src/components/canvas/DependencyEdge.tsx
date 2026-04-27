
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import type { ImpactType } from "@checkstack/dependency-common";

export interface DependencyEdgeData extends Record<string, unknown> {
  impactType: ImpactType;
  transitive: boolean;
  label?: string | null;
}

export type DependencyEdge = Edge<DependencyEdgeData, "dependency">;

const impactColors: Record<ImpactType, string> = {
  informational: "stroke-sky-400/50",
  degraded: "stroke-amber-400/60",
  critical: "stroke-red-400/70",
};

const impactStrokeWidths: Record<ImpactType, number> = {
  informational: 1.5,
  degraded: 2,
  critical: 2.5,
};

/** Hex colors for SVG marker fills — must match the Tailwind stroke classes. */
const impactHexColors: Record<ImpactType, string> = {
  informational: "#38bdf8", // sky-400
  degraded: "#fbbf24", // amber-400
  critical: "#f87171", // red-400
};

/**
 * Custom React Flow edge displaying dependency impact type via color + thickness.
 * Transitive edges use dashed stroke. Renders a visible arrowhead marker
 * colored to match the impact type.
 */
export function DependencyEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<DependencyEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const impactType = data?.impactType ?? "informational";
  const isTransitive = data?.transitive ?? false;
  const colorClass = impactColors[impactType];
  const strokeWidth = impactStrokeWidths[impactType];
  const hexColor = selected ? "hsl(var(--primary))" : impactHexColors[impactType];

  // Unique marker ID per edge to avoid color clashes between different impact types
  const markerId = `arrow-${id}`;

  return (
    <>
      {/* SVG marker definition for the arrowhead */}
      <defs>
        <marker
          id={markerId}
          markerWidth="12"
          markerHeight="12"
          refX="10"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M2,2 L10,6 L2,10 L4,6 Z"
            fill={hexColor}
            opacity={selected ? 1 : 0.8}
          />
        </marker>
      </defs>

      <BaseEdge
        id={id}
        path={edgePath}
        className={`${colorClass} ${selected ? "!stroke-primary" : ""}`}
        style={{
          strokeWidth: selected ? strokeWidth + 1 : strokeWidth,
          strokeDasharray: isTransitive ? "6 4" : undefined,
          markerEnd: `url(#${markerId})`,
        }}
      />

      {/* Edge label */}
      {data?.label && (
        <foreignObject
          x={labelX - 40}
          y={labelY - 10}
          width={80}
          height={20}
          className="pointer-events-none overflow-visible"
        >
          <div className="flex justify-center">
            <span className="text-[10px] bg-background/90 border border-border rounded px-1.5 py-0.5 text-muted-foreground whitespace-nowrap">
              {data.label}
            </span>
          </div>
        </foreignObject>
      )}
    </>
  );
}
