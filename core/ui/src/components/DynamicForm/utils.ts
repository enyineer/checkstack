import type { JsonSchema } from "./types";

/**
 * Cleans a description string by removing textarea markers.
 * Returns undefined if the description is empty or just "textarea".
 */
export const getCleanDescription = (
  description?: string
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
  schema: JsonSchema
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
