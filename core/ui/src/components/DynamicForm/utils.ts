import type { JsonSchema, JsonSchemaProperty } from "./types";

/**
 * Cleans a description string by removing textarea markers.
 * Returns undefined if the description is empty or just "textarea".
 */
export const getCleanDescription = (
  description?: string,
): string | undefined => {
  if (!description || description === "textarea") return;
  const cleaned = description.replace("[textarea]", "").trim();
  if (!cleaned) return;
  return cleaned;
};

/**
 * Extracts default values from a JSON schema recursively.
 */
export const extractDefaults = (
  schema: JsonSchema,
): Record<string, unknown> => {
  const defaults: Record<string, unknown> = {};

  if (!schema.properties) return defaults;

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (propSchema.default !== undefined) {
      defaults[key] = propSchema.default;
    } else if (propSchema.type === "object" && propSchema.properties) {
      // Recursively extract defaults for nested objects
      defaults[key] = extractDefaults(propSchema as JsonSchema);
    } else if (propSchema.type === "array") {
      // Arrays default to empty array
      defaults[key] = [];
    }
  }

  return defaults;
};

/**
 * Check if a value is considered "empty" for validation purposes.
 * Used to determine if required fields are filled.
 */
export function isValueEmpty(
  val: unknown,
  propSchema: JsonSchemaProperty,
): boolean {
  if (val === undefined || val === null) return true;
  if (typeof val === "string" && val.trim() === "") return true;
  // For arrays, only consider empty if schema requires minimum items
  if (Array.isArray(val) && val.length === 0) {
    const minItems = (propSchema as JsonSchemaProperty & { minItems?: number }).minItems;
    if (minItems !== undefined && minItems > 0) return true;
    // Empty arrays are valid by default (e.g., optional mappings lists)
    return false;
  }
  // For objects (nested schemas), recursively check required fields
  if (propSchema.type === "object" && propSchema.properties) {
    const objVal = val as Record<string, unknown>;
    const requiredKeys = propSchema.required ?? [];
    for (const key of requiredKeys) {
      const nestedPropSchema = propSchema.properties[key];
      if (nestedPropSchema && isValueEmpty(objVal[key], nestedPropSchema)) {
        return true;
      }
    }
  }
  return false;
}

/** Sentinel value used to represent "None" selection in Select components */
export const NONE_SENTINEL = "__none__";

/**
 * Converts a select value to the actual form value.
 * Handles the "None" sentinel value by returning undefined.
 */
export function parseSelectValue(val: string): string | undefined {
  return val === NONE_SENTINEL ? undefined : val;
}

// =============================================================================
// Multi-Type Editor Utilities
// =============================================================================

import type { KeyValuePair } from "./KeyValueEditor";
import type { EditorType } from "@checkstack/common";

// Re-export for local consumers
export type { EditorType } from "@checkstack/common";

/**
 * Serialize key-value pairs to URL-encoded string format.
 * Example: [{ key: "a", value: "1" }] -> "a=1"
 */
export function serializeFormData(pairs: KeyValuePair[]): string {
  const filtered = pairs.filter((p) => p.key.trim() !== "");
  if (filtered.length === 0) return "";
  return filtered
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
}

/**
 * Parse URL-encoded string to key-value pairs.
 * Example: "a=1&b=2" -> [{ key: "a", value: "1" }, { key: "b", value: "2" }]
 */
export function parseFormData(str: string): KeyValuePair[] {
  if (!str || str.trim() === "") return [];

  return str.split("&").map((pair) => {
    const [key, ...valueParts] = pair.split("=");
    return {
      key: decodeURIComponent(key || ""),
      value: decodeURIComponent(valueParts.join("=") || ""),
    };
  });
}

/**
 * Detect the most likely editor type from a string value.
 * Used to auto-select the initial editor type when loading existing data.
 */
export function detectEditorType(
  value: string | undefined,
  availableTypes: EditorType[],
): EditorType {
  // If no value, prefer "none" if available, otherwise first type
  if (!value || value.trim() === "") {
    if (availableTypes.includes("none")) return "none";
    return availableTypes[0] ?? "raw";
  }

  // Try to detect JSON
  if (availableTypes.includes("json")) {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        JSON.parse(value);
        return "json";
      } catch {
        // Not valid JSON, continue checking
      }
    }
  }

  // Try to detect formdata (URL-encoded key=value pairs)
  // Simple heuristic: contains = and optionally &, no newlines
  if (
    availableTypes.includes("formdata") &&
    value.includes("=") &&
    !value.includes("\n")
  ) {
    const parts = value.split("&");
    const looksLikeFormData = parts.every((p) => p.includes("="));
    if (looksLikeFormData) {
      return "formdata";
    }
  }

  // Default to raw if available
  if (availableTypes.includes("raw")) return "raw";

  // Fallback to first available type
  return availableTypes[0] ?? "raw";
}

/**
 * Human-readable labels for editor types
 */
export const EDITOR_TYPE_LABELS: Record<EditorType, string> = {
  none: "None",
  raw: "Plain Text",
  json: "JSON",
  yaml: "YAML",
  xml: "XML",
  markdown: "Markdown",
  formdata: "Form Data",
  javascript: "JavaScript",
  typescript: "TypeScript",
  shell: "Shell",
};
