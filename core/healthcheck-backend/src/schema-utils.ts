/**
 * Schema utilities for health check JSON Schema conversion.
 *
 * Extends the base toJsonSchema to also include chart metadata from the
 * healthResultRegistry for auto-chart rendering.
 */

import { z, toJsonSchema } from "@checkstack/backend-api";
import { getHealthResultMeta } from "@checkstack/healthcheck-common";

/**
 * Adds health result chart metadata to JSON Schema properties.
 * Recursively processes nested objects and arrays.
 */
function addHealthResultMeta(
  zodSchema: z.ZodTypeAny,
  jsonSchema: Record<string, unknown>
): void {
  // Handle arrays - recurse into items
  if (zodSchema instanceof z.ZodArray) {
    const itemsSchema = (zodSchema as z.ZodArray<z.ZodTypeAny>).element;
    const jsonItems = jsonSchema.items as Record<string, unknown> | undefined;
    if (jsonItems) {
      addHealthResultMeta(itemsSchema, jsonItems);
    }
    return;
  }

  // Handle optional - unwrap and recurse
  if (zodSchema instanceof z.ZodOptional) {
    const innerSchema = zodSchema.unwrap() as z.ZodTypeAny;
    addHealthResultMeta(innerSchema, jsonSchema);
    return;
  }

  // Type guard to check if this is an object schema
  if (!("shape" in zodSchema)) return;

  const objectSchema = zodSchema as z.ZodObject<z.ZodRawShape>;
  const properties = jsonSchema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (!properties) return;

  for (const [key, fieldSchema] of Object.entries(objectSchema.shape)) {
    const zodField = fieldSchema as z.ZodTypeAny;
    const jsonField = properties[key];

    if (!jsonField) continue;

    // Get health result metadata from registry (x-chart-type, etc.)
    const healthMeta = getHealthResultMeta(zodField);
    if (healthMeta) {
      if (healthMeta["x-chart-type"])
        jsonField["x-chart-type"] = healthMeta["x-chart-type"];
      if (healthMeta["x-chart-label"])
        jsonField["x-chart-label"] = healthMeta["x-chart-label"];
      if (healthMeta["x-chart-unit"])
        jsonField["x-chart-unit"] = healthMeta["x-chart-unit"];
      if (healthMeta["x-jsonpath"])
        jsonField["x-jsonpath"] = healthMeta["x-jsonpath"];
    }

    // Recurse into nested objects and arrays
    addHealthResultMeta(zodField, jsonField);
  }
}

/**
 * Converts a Zod schema to JSON Schema with chart metadata.
 *
 * This extends the base toJsonSchema to also include health check
 * chart metadata (x-chart-type, x-chart-label, x-chart-unit) from
 * the healthResultRegistry for auto-chart rendering.
 */
export function toJsonSchemaWithChartMeta(
  zodSchema: z.ZodTypeAny
): Record<string, unknown> {
  // Use the base toJsonSchema which handles config metadata
  const jsonSchema = toJsonSchema(zodSchema);
  // Add health result chart metadata
  addHealthResultMeta(zodSchema, jsonSchema);
  return jsonSchema;
}
