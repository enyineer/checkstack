/**
 * Utility to extract chart metadata from JSON Schema.
 *
 * Parses JSON Schema objects and extracts x-chart-type, x-chart-label,
 * and x-chart-unit metadata for auto-chart rendering.
 *
 * Supports nested schemas under `collectors.*` for per-collector metrics.
 */

import { z } from "zod";
import type {
  ChartType,
  JsonSchemaPropertyCore,
  JsonSchemaBase,
} from "@checkstack/common";

/**
 * JSON Schema property with healthcheck result-specific x-* extensions.
 * Uses the generic core type for proper recursive typing.
 */
export interface ResultSchemaProperty extends JsonSchemaPropertyCore<ResultSchemaProperty> {
  // Result-specific x-* extensions for chart rendering
  "x-chart-type"?: ChartType;
  "x-chart-label"?: string;
  "x-chart-unit"?: string;
  "x-chart-priority"?: number;
  "x-chart-good-direction"?: "up" | "down";
  "x-chart-true-label"?: string;
  "x-chart-false-label"?: string;
  "x-anomaly-direction"?: string;
}

/** Priority assigned to fields without an explicit `x-chart-priority`. */
export const DEFAULT_CHART_PRIORITY = 100;

// Emitted JSON schemas cross a serialization boundary, so the annotation
// values are validated instead of trusted (a collector could ship anything).
const prioritySchema = z.number().finite();
const goodDirectionSchema = z.enum(["up", "down"]);
const booleanLabelSchema = z.string().min(1);
const anomalyDirectionSchema = z.enum(["higher-is-better", "lower-is-better"]);

const anomalyToGoodDirection: Record<
  z.infer<typeof anomalyDirectionSchema>,
  "up" | "down"
> = {
  "higher-is-better": "up",
  "lower-is-better": "down",
};

/**
 * JSON Schema for result schemas with chart metadata.
 */
export type ResultSchema = JsonSchemaBase<ResultSchemaProperty>;

/**
 * Chart field information extracted from JSON Schema.
 */
export interface ChartField {
  /** Field name (simple name for collector fields, path for others) */
  name: string;
  /** Chart type to render */
  chartType: ChartType;
  /** Human-readable label (defaults to name) */
  label: string;
  /** Optional unit suffix (e.g., 'ms', '%') */
  unit?: string;
  /** JSON Schema type (number, string, boolean, etc.) */
  schemaType: string;
  /** Collector ID if this field is from a collector (used for data lookup) */
  collectorId?: string;
  /** Tile sort weight; lower renders earlier. Defaults to 100. */
  priority: number;
  /**
   * Which direction of change is an improvement, for trend coloring. Explicit
   * `x-chart-good-direction` wins; otherwise derived from
   * `x-anomaly-direction`; undefined renders neutral trends.
   */
  goodDirection?: "up" | "down";
  /** Prose label for a boolean field's `true` value (e.g. "successful"). */
  trueLabel?: string;
  /** Prose label for a boolean field's `false` value (e.g. "failing"). */
  falseLabel?: string;
}

/**
 * Extract chart fields from a JSON Schema.
 *
 * Looks for properties with x-chart-type metadata and extracts
 * relevant chart configuration. Supports nested collector schemas.
 *
 * @param schema - JSON Schema object
 * @returns Array of chart fields with metadata
 */
export function extractChartFields(
  schema: Record<string, unknown> | null | undefined,
): ChartField[] {
  if (!schema) return [];

  const typed = schema as ResultSchema;
  if (typed.type !== "object" || !typed.properties) return [];

  const fields: ChartField[] = [];

  for (const [name, prop] of Object.entries(typed.properties)) {
    // Check for nested collector schemas
    if (name === "collectors" && prop.type === "object" && prop.properties) {
      // Traverse each collector's schema
      for (const [collectorId, collectorProp] of Object.entries(
        prop.properties,
      )) {
        if (collectorProp.type === "object" && collectorProp.properties) {
          // Extract fields from the collector's result schema
          const collectorFields = extractFieldsFromProperties(
            collectorProp.properties,
            collectorId,
          );
          fields.push(...collectorFields);
        }
      }
      continue;
    }

    const chartType = prop["x-chart-type"];
    if (!chartType) continue;

    fields.push(extractSingleField(name, prop));
  }

  return fields;
}

/**
 * Extract fields from a nested properties object.
 */
function extractFieldsFromProperties(
  properties: Record<string, ResultSchemaProperty>,
  collectorId: string,
): ChartField[] {
  const fields: ChartField[] = [];

  for (const [fieldName, prop] of Object.entries(properties)) {
    const chartType = prop["x-chart-type"];
    if (!chartType) continue;

    // Use just field name - collectorId is stored separately for data lookup
    // and surfaced via a separate badge in the group header
    const field = extractSingleField(fieldName, prop);
    field.collectorId = collectorId;
    fields.push(field);
  }

  return fields;
}

/**
 * Extract a single field from a property.
 */
function extractSingleField(
  name: string,
  prop: ResultSchemaProperty,
): ChartField {
  let schemaType = prop.type ?? "unknown";
  if (prop.type === "array" && prop.items?.type) {
    schemaType = `array<${prop.items.type}>`;
  }
  if (
    prop.additionalProperties &&
    typeof prop.additionalProperties === "object" &&
    prop.additionalProperties.type
  ) {
    schemaType = `record<${prop.additionalProperties.type}>`;
  }

  const parsedPriority = prioritySchema.safeParse(prop["x-chart-priority"]);
  const parsedGoodDirection = goodDirectionSchema.safeParse(
    prop["x-chart-good-direction"],
  );
  const parsedAnomalyDirection = anomalyDirectionSchema.safeParse(
    prop["x-anomaly-direction"],
  );

  let goodDirection: "up" | "down" | undefined;
  if (parsedGoodDirection.success) {
    goodDirection = parsedGoodDirection.data;
  } else if (parsedAnomalyDirection.success) {
    goodDirection = anomalyToGoodDirection[parsedAnomalyDirection.data];
  }

  const parsedTrueLabel = booleanLabelSchema.safeParse(
    prop["x-chart-true-label"],
  );
  const parsedFalseLabel = booleanLabelSchema.safeParse(
    prop["x-chart-false-label"],
  );

  return {
    name,
    chartType: prop["x-chart-type"]!,
    label: prop["x-chart-label"] ?? formatFieldName(name),
    unit: prop["x-chart-unit"],
    schemaType,
    priority: parsedPriority.success
      ? parsedPriority.data
      : DEFAULT_CHART_PRIORITY,
    goodDirection,
    trueLabel: parsedTrueLabel.success ? parsedTrueLabel.data : undefined,
    falseLabel: parsedFalseLabel.success ? parsedFalseLabel.data : undefined,
  };
}

/**
 * Convert camelCase or snake_case field name to human-readable label.
 * Shared with the assertion builder's field extraction (same fallback when a
 * field carries no `x-chart-label`).
 */
export function formatFieldName(name: string): string {
  // Extract just the field name if it's a path
  const baseName = name.includes(".") ? name.split(".").pop()! : name;
  return baseName
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2") // camelCase
    .replaceAll("_", " ") // snake_case
    .replaceAll(/\b\w/g, (c) => c.toUpperCase()); // Capitalize
}

/**
 * Get the value for a field from a data object.
 * For strategy-level fields, also searches inside collectors as fallback.
 * Automatically extracts computed values from aggregated state objects.
 *
 * @param data - The metadata object
 * @param fieldName - Simple field name (no dot notation for collector fields)
 * @param collectorInstanceId - Optional: if provided, looks in collectors[collectorInstanceId]
 */
export function getFieldValue(
  data: Record<string, unknown> | undefined,
  fieldName: string,
  collectorInstanceId?: string,
): unknown {
  if (!data) return undefined;

  // If collectorInstanceId is provided, look in that specific collector's data
  if (collectorInstanceId) {
    const collectors = data.collectors as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (collectors && typeof collectors === "object") {
      const collectorData = collectors[collectorInstanceId];
      if (collectorData && typeof collectorData === "object") {
        return extractComputedValue(collectorData[fieldName]);
      }
    }
    return undefined;
  }

  // For non-collector fields, try direct lookup first
  const directValue = data[fieldName];
  if (directValue !== undefined) {
    return extractComputedValue(directValue);
  }

  // Fallback: search all collectors for the field (for strategy schema fields)
  const collectors = data.collectors as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (collectors && typeof collectors === "object") {
    for (const collectorData of Object.values(collectors)) {
      if (collectorData && typeof collectorData === "object") {
        const value = collectorData[fieldName];
        if (value !== undefined) {
          return extractComputedValue(value);
        }
      }
    }
  }

  return undefined;
}

/**
 * Extract the computed value from an aggregated state object.
 * Uses the required `_type` discriminator field for type detection.
 * Logs errors instead of throwing to avoid breaking the app.
 *
 * @param value - Value from API data (unknown type from JSON parsing)
 */
function extractComputedValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const obj = value as Record<string, unknown>;

  // _type is required for all aggregated state objects
  if (!("_type" in obj)) {
    return value;
  }

  switch (obj._type) {
    case "average": {
      return obj.avg;
    }
    case "rate": {
      return obj.rate;
    }
    case "counter": {
      return obj.count;
    }
    case "minmax": {
      // Default to max for minmax; caller can access min directly if needed
      return obj.max;
    }
    default: {
      return value;
    }
  }
}
