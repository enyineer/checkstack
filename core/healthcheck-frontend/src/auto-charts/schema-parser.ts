/**
 * Utility to extract chart metadata from JSON Schema.
 *
 * Parses JSON Schema objects and extracts x-chart-type, x-chart-label,
 * and x-chart-unit metadata for auto-chart rendering.
 */

/**
 * Available chart types for auto-generated visualizations.
 * Mirrors the backend ChartType but defined locally since frontend
 * cannot import from backend-api.
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
 * Chart field information extracted from JSON Schema.
 */
export interface ChartField {
  /** Field name in the schema */
  name: string;
  /** Chart type to render */
  chartType: ChartType;
  /** Human-readable label (defaults to name) */
  label: string;
  /** Optional unit suffix (e.g., 'ms', '%') */
  unit?: string;
  /** JSON Schema type (number, string, boolean, etc.) */
  schemaType: string;
}

/**
 * JSON Schema property with potential chart metadata.
 */
interface JsonSchemaProperty {
  type?: string;
  "x-chart-type"?: ChartType;
  "x-chart-label"?: string;
  "x-chart-unit"?: string;
  items?: JsonSchemaProperty;
  additionalProperties?: JsonSchemaProperty;
}

/**
 * JSON Schema object structure.
 */
interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
}

/**
 * Extract chart fields from a JSON Schema.
 *
 * Looks for properties with x-chart-type metadata and extracts
 * relevant chart configuration.
 *
 * @param schema - JSON Schema object
 * @returns Array of chart fields with metadata
 */
export function extractChartFields(
  schema: Record<string, unknown> | null | undefined
): ChartField[] {
  if (!schema) return [];

  const typed = schema as JsonSchema;
  if (typed.type !== "object" || !typed.properties) return [];

  const fields: ChartField[] = [];

  for (const [name, prop] of Object.entries(typed.properties)) {
    const chartType = prop["x-chart-type"];
    if (!chartType) continue;

    // Determine the underlying schema type
    let schemaType = prop.type ?? "unknown";
    if (prop.type === "array" && prop.items?.type) {
      schemaType = `array<${prop.items.type}>`;
    }
    if (prop.additionalProperties?.type) {
      schemaType = `record<${prop.additionalProperties.type}>`;
    }

    fields.push({
      name,
      chartType,
      label: prop["x-chart-label"] ?? formatFieldName(name),
      unit: prop["x-chart-unit"],
      schemaType,
    });
  }

  return fields;
}

/**
 * Convert camelCase or snake_case field name to human-readable label.
 */
function formatFieldName(name: string): string {
  return name
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2") // camelCase
    .replaceAll("_", " ") // snake_case
    .replaceAll(/\b\w/g, (c) => c.toUpperCase()); // Capitalize
}

/**
 * Get the value for a field from a data object.
 */
export function getFieldValue(
  data: Record<string, unknown> | undefined,
  fieldName: string
): unknown {
  if (!data) return undefined;
  return data[fieldName];
}
