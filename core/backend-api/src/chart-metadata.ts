/**
 * Chart metadata types for auto-generated health check visualizations.
 *
 * Use Zod's .meta() to annotate result schema fields with chart information.
 * The metadata flows through toJSONSchema() and is rendered by auto-chart components.
 *
 * Uses x- prefixed keys for consistency with platform patterns (x-secret, x-color, x-hidden).
 *
 * @example
 * ```typescript
 * const aggregatedSchema = z.object({
 *   avgResponseTime: z.number().meta({
 *     "x-chart-type": "line",
 *     "x-chart-label": "Avg Response Time",
 *     "x-chart-unit": "ms"
 *   }),
 *   statusCodeCounts: z.record(z.string(), z.number()).meta({
 *     "x-chart-type": "bar",
 *     "x-chart-label": "Status Codes"
 *   }),
 *   connected: z.boolean().meta({
 *     "x-chart-type": "boolean",
 *     "x-chart-label": "Connected"
 *   }),
 * });
 * ```
 */

import type { ChartType } from "@checkstack/common";

/**
 * Chart metadata to attach to Zod schema fields via .meta().
 * Uses x- prefixed keys for consistency with platform patterns.
 */
export interface ChartMeta {
  /** The type of chart to render for this field */
  "x-chart-type": ChartType;
  /** Human-readable label for the chart (defaults to field name) */
  "x-chart-label"?: string;
  /** Unit suffix for values (e.g., 'ms', '%', 'req/s') */
  "x-chart-unit"?: string;
}

/**
 * Type guard to check if metadata contains chart information.
 */
export function isChartMeta(meta: unknown): meta is ChartMeta {
  return (
    typeof meta === "object" &&
    meta !== null &&
    "x-chart-type" in meta &&
    typeof (meta as ChartMeta)["x-chart-type"] === "string"
  );
}
