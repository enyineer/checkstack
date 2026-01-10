/**
 * Utility to extract chart metadata from JSON Schema.
 *
 * Parses JSON Schema objects and extracts x-chart-type, x-chart-label,
 * and x-chart-unit metadata for auto-chart rendering.
 *
 * Supports nested schemas under `collectors.*` for per-collector metrics.
 */

import type { ChartType } from "@checkstack/healthcheck-common";
import type {
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
  /** Field path (supports dot notation for nested fields like "collectors.request.responseTimeMs") */
  name: string;
  /** Chart type to render */
  chartType: ChartType;
  /** Human-readable label (defaults to name) */
  label: string;
  /** Optional unit suffix (e.g., 'ms', '%') */
  unit?: string;
  /** JSON Schema type (number, string, boolean, etc.) */
  schemaType: string;
  /** Collector ID if this field is from a collector */
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
            `collectors.${collectorId}`,
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
  pathPrefix: string,
  collectorId: string
): ChartField[] {
  const fields: ChartField[] = [];

  for (const [fieldName, prop] of Object.entries(properties)) {
    const chartType = prop["x-chart-type"];
    if (!chartType) continue;

    const fullPath = `${pathPrefix}.${fieldName}`;
    const field = extractSingleField(fullPath, prop);
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
 * Supports dot-notation paths like "collectors.request.responseTimeMs".
 */
export function getFieldValue(
  data: Record<string, unknown> | undefined,
  fieldName: string
): unknown {
  if (!data) return undefined;

  // Simple case: no dot notation
  if (!fieldName.includes(".")) {
    return data[fieldName];
  }

  // Dot notation: traverse the path
  const parts = fieldName.split(".");
  let current: unknown = data;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
