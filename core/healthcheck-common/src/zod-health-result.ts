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
 * - pie: Pie chart for category distributions (record of string to number)
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
  | "pie"
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
  /** Whether this field supports JSONPath assertions */
  "x-jsonpath"?: boolean;
}

/**
 * Registry for health result schema metadata.
 * Used by auto-chart components for visualization inference.
 */
export const healthResultRegistry = z.registry<HealthResultMeta>();

// ============================================================================
// TYPED HEALTH RESULT FACTORIES
// ============================================================================

/** Chart metadata (excludes x-jsonpath, use healthResultJSONPath for that) */
type ChartMeta = Omit<HealthResultMeta, "x-jsonpath">;

/**
 * Create a health result string field with typed chart metadata.
 *
 * @example
 * ```typescript
 * import { healthResultString } from "@checkstack/healthcheck-common";
 *
 * const resultSchema = z.object({
 *   role: healthResultString({ "x-chart-type": "text", "x-chart-label": "Role" }),
 * });
 * ```
 */
export function healthResultString(meta: ChartMeta) {
  const schema = z.string();
  schema.register(healthResultRegistry, meta);
  return schema;
}

/**
 * Create a health result number field with typed chart metadata.
 */
export function healthResultNumber(meta: ChartMeta) {
  const schema = z.number();
  schema.register(healthResultRegistry, meta);
  return schema;
}

/**
 * Create a health result boolean field with typed chart metadata.
 */
export function healthResultBoolean(meta: ChartMeta) {
  const schema = z.boolean();
  schema.register(healthResultRegistry, meta);
  return schema;
}

/**
 * Create a health result string field with JSONPath assertion support.
 * The UI will show a JSONPath input field for this result.
 *
 * @example
 * ```typescript
 * import { healthResultJSONPath } from "@checkstack/healthcheck-common";
 *
 * const resultSchema = z.object({
 *   body: healthResultJSONPath(),
 * });
 * ```
 */
export function healthResultJSONPath(meta: ChartMeta) {
  const schema = z.string();
  schema.register(healthResultRegistry, { ...meta, "x-jsonpath": true });
  return schema;
}

// ============================================================================
// METADATA RETRIEVAL - For toJsonSchema integration
// ============================================================================

/**
 * Unwraps a Zod schema to get the inner schema, handling:
 * - ZodOptional
 * - ZodDefault
 * - ZodNullable
 */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let unwrapped = schema;

  if (unwrapped instanceof z.ZodOptional) {
    unwrapped = unwrapped.unwrap() as z.ZodTypeAny;
  }

  if (unwrapped instanceof z.ZodDefault) {
    unwrapped = unwrapped.def.innerType as z.ZodTypeAny;
  }

  if (unwrapped instanceof z.ZodNullable) {
    unwrapped = unwrapped.unwrap() as z.ZodTypeAny;
  }

  return unwrapped;
}

/**
 * Get health result metadata for a schema.
 * Automatically unwraps Optional/Default/Nullable wrappers.
 */
export function getHealthResultMeta(
  schema: z.ZodTypeAny
): HealthResultMeta | undefined {
  return healthResultRegistry.get(unwrapSchema(schema));
}
