import { z } from "zod";
import type { HealthResultMeta } from "@checkstack/common";

// ============================================================================
// HEALTH RESULT REGISTRY - Typed metadata for chart annotations
// ============================================================================

/**
 * Registry for health result schema metadata.
 * Used by auto-chart components for visualization inference.
 */
export const healthResultRegistry = z.registry<HealthResultMeta>();

// ============================================================================
// BRANDED TYPES FOR COMPILE-TIME ENFORCEMENT
// ============================================================================

/**
 * Unique symbol for branding health result fields.
 * This enables compile-time enforcement that developers use factory functions.
 */
declare const HealthResultBrand: unique symbol;

/**
 * A branded Zod schema type that marks it as a health result field.
 * Only schemas created via factory functions (healthResultNumber, healthResultString, etc.)
 * carry this brand.
 */
export type HealthResultField<T extends z.ZodTypeAny> = T & {
  [HealthResultBrand]: true;
};

/**
 * Allowed field types in a health result schema.
 * Supports direct fields, optional fields, and fields with defaults.
 */
export type HealthResultFieldType =
  | HealthResultField<z.ZodTypeAny>
  | z.ZodOptional<HealthResultField<z.ZodTypeAny>>
  | z.ZodDefault<HealthResultField<z.ZodTypeAny>>
  | z.ZodNullable<HealthResultField<z.ZodTypeAny>>;

/**
 * Constraint for health result schema shapes.
 * All fields must use factory functions (healthResultNumber, healthResultString, etc.)
 *
 * @example
 * ```typescript
 * // ✅ Valid - uses factory functions
 * const validSchema = z.object({
 *   value: healthResultNumber({ "x-chart-type": "line" }),
 *   error: healthResultString({ "x-chart-type": "status" }).optional(),
 * });
 *
 * // ❌ Invalid - uses raw z.number()
 * const invalidSchema = z.object({
 *   value: z.number(), // Type error!
 * });
 * ```
 */
export type HealthResultShape = Record<string, HealthResultFieldType>;

// ============================================================================
// HEALTH RESULT SCHEMA BUILDER
// ============================================================================

/**
 * Create a health result schema that enforces the use of factory functions.
 *
 * This builder ensures all fields use healthResultNumber(), healthResultString(),
 * healthResultBoolean(), or healthResultJSONPath() - raw Zod schemas like z.number()
 * will cause a compile-time error.
 *
 * @example
 * ```typescript
 * // ✅ Valid - all fields use factory functions
 * const schema = healthResultSchema({
 *   responseTime: healthResultNumber({ "x-chart-type": "line", "x-chart-label": "Response Time" }),
 *   error: healthResultString({ "x-chart-type": "status" }).optional(),
 * });
 *
 * // ❌ Invalid - raw z.number() causes type error
 * const schema = healthResultSchema({
 *   value: z.number(), // Type error: not assignable to HealthResultFieldType
 * });
 * ```
 */
export function healthResultSchema<T extends HealthResultShape>(
  shape: T,
): z.ZodObject<T> {
  return z.object(shape);
}

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
export function healthResultString(
  meta: ChartMeta,
): HealthResultField<z.ZodString> {
  const schema = z.string();
  schema.register(healthResultRegistry, meta);
  return schema as HealthResultField<z.ZodString>;
}

/**
 * Create a health result number field with typed chart metadata.
 */
export function healthResultNumber(
  meta: ChartMeta,
): HealthResultField<z.ZodNumber> {
  const schema = z.number();
  schema.register(healthResultRegistry, meta);
  return schema as HealthResultField<z.ZodNumber>;
}

/**
 * Create a health result boolean field with typed chart metadata.
 */
export function healthResultBoolean(
  meta: ChartMeta,
): HealthResultField<z.ZodBoolean> {
  const schema = z.boolean();
  schema.register(healthResultRegistry, meta);
  return schema as HealthResultField<z.ZodBoolean>;
}

/**
 * Create a health result array field with typed chart metadata.
 * For arrays of strings (e.g., DNS resolved values, list of hosts).
 *
 * @example
 * ```typescript
 * const resultSchema = healthResultSchema({
 *   resolvedValues: healthResultArray({ "x-chart-type": "text", "x-chart-label": "Values" }),
 * });
 * ```
 */
export function healthResultArray(
  meta: ChartMeta,
): HealthResultField<z.ZodArray<z.ZodString>> {
  const schema = z.array(z.string());
  schema.register(healthResultRegistry, meta);
  return schema as HealthResultField<z.ZodArray<z.ZodString>>;
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
export function healthResultJSONPath(
  meta: ChartMeta,
): HealthResultField<z.ZodString> {
  const schema = z.string();
  schema.register(healthResultRegistry, { ...meta, "x-jsonpath": true });
  return schema as HealthResultField<z.ZodString>;
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
  schema: z.ZodTypeAny,
): HealthResultMeta | undefined {
  return healthResultRegistry.get(unwrapSchema(schema));
}

// ============================================================================
// EPHEMERAL FIELD STRIPPING - For storage optimization
// ============================================================================

/**
 * Strip ephemeral fields from a result object before database storage.
 *
 * Ephemeral fields (marked with x-ephemeral: true) are used during health check
 * execution for assertions but should not be persisted to save storage space.
 * Common example: HTTP response bodies used for JSONPath assertions.
 *
 * @param result - The full result object from collector execution
 * @param schema - The Zod schema with health result metadata
 * @returns A new object with ephemeral fields removed
 *
 * @example
 * ```typescript
 * const stripped = stripEphemeralFields(collectorResult.result, collector.result.schema);
 * // The 'body' field (marked with x-ephemeral) is removed before storage
 * ```
 */
export function stripEphemeralFields<T extends Record<string, unknown>>(
  result: T,
  schema: z.ZodTypeAny,
): Partial<T> {
  // Handle ZodObject schemas
  if (!(schema instanceof z.ZodObject)) {
    return result;
  }

  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const stripped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(result)) {
    const fieldSchema = shape[key];
    if (!fieldSchema) {
      // Keep unknown fields (e.g., _collectorId, _assertionFailed)
      stripped[key] = value;
      continue;
    }

    const meta = getHealthResultMeta(fieldSchema);
    if (meta?.["x-ephemeral"]) {
      // Skip ephemeral fields
      continue;
    }

    stripped[key] = value;
  }

  return stripped as Partial<T>;
}
