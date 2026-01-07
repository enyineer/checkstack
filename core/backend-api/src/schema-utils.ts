import { z } from "zod";
import { getConfigMeta } from "./zod-config";

/**
 * Adds x-secret, x-color, x-options-resolver, x-depends-on, x-searchable, and x-hidden
 * metadata to JSON Schema based on registry metadata.
 * This is used internally by toJsonSchema.
 * Recursively processes nested objects and arrays.
 */
function addSchemaMetadata(
  zodSchema: z.ZodTypeAny,
  jsonSchema: Record<string, unknown>
): void {
  // Handle arrays - recurse into items
  if (zodSchema instanceof z.ZodArray) {
    const itemsSchema = (zodSchema as z.ZodArray<z.ZodTypeAny>).element;
    const jsonItems = jsonSchema.items as Record<string, unknown> | undefined;
    if (jsonItems) {
      addSchemaMetadata(itemsSchema, jsonItems);
    }
    return;
  }

  // Handle optional - unwrap and recurse
  if (zodSchema instanceof z.ZodOptional) {
    const innerSchema = zodSchema.unwrap() as z.ZodTypeAny;
    addSchemaMetadata(innerSchema, jsonSchema);
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

    // Get metadata from registry
    const meta = getConfigMeta(zodField);
    if (meta) {
      if (meta["x-secret"]) jsonField["x-secret"] = true;
      if (meta["x-color"]) jsonField["x-color"] = true;
      if (meta["x-hidden"]) jsonField["x-hidden"] = true;
      if (meta["x-options-resolver"]) {
        jsonField["x-options-resolver"] = meta["x-options-resolver"];
        if (meta["x-depends-on"])
          jsonField["x-depends-on"] = meta["x-depends-on"];
        if (meta["x-searchable"]) jsonField["x-searchable"] = true;
      }
    }

    // Recurse into nested objects and arrays
    addSchemaMetadata(zodField, jsonField);
  }
}

/**
 * Converts a Zod schema to JSON Schema with automatic registry metadata.
 * Uses Zod v4's native toJSONSchema() method.
 *
 * The registry metadata enables DynamicForm to automatically render
 * specialized input fields (password for secrets, color picker for colors,
 * dropdowns for optionsResolver fields, hidden for auto-populated fields).
 */
export function toJsonSchema(zodSchema: z.ZodTypeAny): Record<string, unknown> {
  // Use Zod's native JSON Schema conversion
  const jsonSchema = zodSchema.toJSONSchema() as Record<string, unknown>;
  addSchemaMetadata(zodSchema, jsonSchema);
  return jsonSchema;
}
