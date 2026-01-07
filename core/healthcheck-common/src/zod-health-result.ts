import { z } from "zod";

// ============================================================================
// HEALTH RESULT REGISTRY - Typed metadata for chart annotations
// ============================================================================

/**
 * Chart types for auto-generated health check visualizations.
 *
 * Numeric types:
 * - line: Time series line chart for numeric metrics over time
 * - bar: Bar chart for distributions (record of string to number)
 * - counter: Simple count display with trend indicator
 * - gauge: Percentage gauge for rates/percentages (0-100)
 *
 * Non-numeric types:
 * - boolean: Boolean indicator (success/failure, connected/disconnected)
 * - text: Text display for string values
 * - status: Status badge for error/warning states
 */
export type ChartType =
  | "line"
  | "bar"
  | "counter"
  | "gauge"
  | "boolean"
  | "text"
  | "status";

/**
 * Metadata type for health check result schemas.
 * Provides autocompletion for `.meta()` calls on result fields.
 */
export interface HealthResultMeta {
  /** The type of chart to render for this field */
  "x-chart-type"?: ChartType;
  /** Human-readable label for the chart (defaults to field name) */
  "x-chart-label"?: string;
  /** Unit suffix for values (e.g., 'ms', '%', 'req/s') */
  "x-chart-unit"?: string;
}

/**
 * Registry for health result schema metadata.
 * Used by auto-chart components for visualization inference.
 */
export const healthResultRegistry = z.registry<HealthResultMeta>();

// ============================================================================
// TYPED HEALTH RESULT FACTORIES
// ============================================================================

/**
 * Create a health result string field with typed chart metadata.
 *
 * @example
 * ```typescript
 * import { healthResultString } from "@checkmate-monitor/healthcheck-common";
 *
 * const resultSchema = z.object({
 *   role: healthResultString({ "x-chart-type": "text", "x-chart-label": "Role" }),
 * });
 * ```
 */
export function healthResultString(meta: HealthResultMeta) {
  const schema = z.string();
  schema.register(healthResultRegistry, meta);
  return schema;
}

/**
 * Create a health result number field with typed chart metadata.
 */
export function healthResultNumber(meta: HealthResultMeta) {
  const schema = z.number();
  schema.register(healthResultRegistry, meta);
  return schema;
}

/**
 * Create a health result boolean field with typed chart metadata.
 */
export function healthResultBoolean(meta: HealthResultMeta) {
  const schema = z.boolean();
  schema.register(healthResultRegistry, meta);
  return schema;
}
