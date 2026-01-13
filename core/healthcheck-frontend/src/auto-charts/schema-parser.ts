/**
 * Utility to extract chart metadata from JSON Schema.
 *
 * Parses JSON Schema objects and extracts x-chart-type, x-chart-label,
 * and x-chart-unit metadata for auto-chart rendering.
 *
 * Supports nested schemas under `collectors.*` for per-collector metrics.
 */

import type {
  ChartType,
  JsonSchemaPropertyCore,
  JsonSchemaBase,
} from "@checkstack/common";

/**
 * JSON Schema property with healthcheck result-specific x-* extensions.
 * Uses the generic core type for proper recursive typing.
 */
export interface ResultSchemaProperty
  extends JsonSchemaPropertyCore<ResultSchemaProperty> {
  // Result-specific x-* extensions for chart rendering
  "x-chart-type"?: ChartType;
  "x-chart-label"?: string;
  "x-chart-unit"?: string;
}

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
  schema: Record<string, unknown> | null | undefined
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
        prop.properties
      )) {
        if (collectorProp.type === "object" && collectorProp.properties) {
          // Extract fields from the collector's result schema
          const collectorFields = extractFieldsFromProperties(
            collectorProp.properties,
            collectorId
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
  collectorId: string
): ChartField[] {
  const fields: ChartField[] = [];

  for (const [fieldName, prop] of Object.entries(properties)) {
    const chartType = prop["x-chart-type"];
    if (!chartType) continue;

    // Use just field name - collectorId is stored separately for data lookup
    const field = extractSingleField(fieldName, prop);
    field.collectorId = collectorId;
    // Prefix label with collector ID for clarity
    if (!prop["x-chart-label"]?.includes(collectorId)) {
      field.label = `${collectorId}: ${field.label}`;
    }
    fields.push(field);
  }

  return fields;
}

/**
 * Extract a single field from a property.
 */
function extractSingleField(
  name: string,
  prop: ResultSchemaProperty
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

  return {
    name,
    chartType: prop["x-chart-type"]!,
    label: prop["x-chart-label"] ?? formatFieldName(name),
    unit: prop["x-chart-unit"],
    schemaType,
  };
}

/**
 * Convert camelCase or snake_case field name to human-readable label.
 */
function formatFieldName(name: string): string {
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
 *
 * @param data - The metadata object
 * @param fieldName - Simple field name (no dot notation for collector fields)
 * @param collectorInstanceId - Optional: if provided, looks in collectors[collectorInstanceId]
 */
export function getFieldValue(
  data: Record<string, unknown> | undefined,
  fieldName: string,
  collectorInstanceId?: string
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
        return collectorData[fieldName];
      }
    }
    return undefined;
  }

  // For non-collector fields, try direct lookup first
  const directValue = data[fieldName];
  if (directValue !== undefined) {
    return directValue;
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
          return value;
        }
      }
    }
  }

  return undefined;
}
