
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import type { ImpactType } from "@checkstack/dependency-common";
import { edgeImpactStyle } from "./dependencyEdge.logic";

export interface DependencyEdgeData extends Record<string, unknown> {
  impactType: ImpactType;
  transitive: boolean;
  label?: string | null;
}

export type DependencyEdge = Edge<DependencyEdgeData, "dependency">;

/**
 * Custom React Flow edge displaying dependency impact type via color + thickness.
 * The ENTIRE edge stroke and its arrowhead marker are colored by impact from the
 * same `edgeImpactStyle` mapping, so a whole line reads one impact color even
 * when several edges feed one system's input. Transitive edges use a dashed
 * stroke.
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
  const { stroke, strokeWidth, opacity } = edgeImpactStyle({
    impactType,
    selected: !!selected,
  });

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
          <path d="M2,2 L10,6 L2,10 L4,6 Z" fill={stroke} opacity={opacity} />
        </marker>
      </defs>

      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth,
          strokeOpacity: opacity,
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
