
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

/**
 * Custom React Flow edge displaying dependency impact type via color + thickness.
 * Transitive edges use dashed stroke.
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

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        className={`${colorClass} ${selected ? "!stroke-primary" : ""}`}
        style={{
          strokeWidth: selected ? strokeWidth + 1 : strokeWidth,
          strokeDasharray: isTransitive ? "6 4" : undefined,
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
