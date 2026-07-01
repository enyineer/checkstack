/**
 * Pure, DOM-free helpers for coloring a dependency-map edge by its impact type.
 *
 * The whole edge (stroke) and its arrowhead marker are driven from the SAME
 * mapping here so they always read one impact color by construction. The hex
 * values MUST stay in lock-step with the Impact legend swatches in
 * `DependencyMapPage.tsx` (sky-400 / amber-400 / red-400). These return only
 * plain values (hex strings and numbers), never DOM, so they stay free of any
 * `@checkstack/ui` runtime dependency and are trivially unit-tested, mirroring
 * the sibling `statusPill.logic.ts`.
 */

import type { ImpactType } from "@checkstack/dependency-common";

/**
 * Hex colors per impact type, used for BOTH the edge stroke and the SVG marker
 * fill. Must match the Tailwind swatch base colors in the Impact legend.
 */
export const impactHexColors: Record<ImpactType, string> = {
  informational: "#38bdf8", // sky-400
  degraded: "#fbbf24", // amber-400
  critical: "#f87171", // red-400
};

/** Base stroke widths per impact type (thicker = higher impact). */
export const impactStrokeWidths: Record<ImpactType, number> = {
  informational: 1.5,
  degraded: 2,
  critical: 2.5,
};

/** Color used to highlight a selected edge, regardless of impact. */
export const selectedEdgeStroke = "hsl(var(--primary))";

/** Resolved style values for an edge (and its arrowhead) at a given state. */
export interface EdgeImpactStyle {
  stroke: string;
  strokeWidth: number;
  opacity: number;
}

/**
 * Resolve the stroke color, width, and opacity for a dependency edge. Applied
 * inline to BOTH the arrowhead marker and the edge path so the whole edge reads
 * a single impact color. Inline styles beat @xyflow/react's default
 * `.react-flow__edge-path` stroke rule, so this fully colors the line without a
 * Tailwind `!important` override.
 *
 * A selected edge switches to the primary color and gets +1 width and full
 * opacity to stand out.
 */
export function edgeImpactStyle({
  impactType,
  selected,
}: {
  impactType: ImpactType;
  selected: boolean;
}): EdgeImpactStyle {
  const baseWidth = impactStrokeWidths[impactType];
  return {
    stroke: selected ? selectedEdgeStroke : impactHexColors[impactType],
    strokeWidth: selected ? baseWidth + 1 : baseWidth,
    opacity: selected ? 1 : 0.8,
  };
}
