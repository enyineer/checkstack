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
  // For arrays, check if empty
  if (Array.isArray(val) && val.length === 0) return true;
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
