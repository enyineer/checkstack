import { z } from "zod";
import { isSecretSchema, isColorSchema } from "./branded-types";

/**
 * Adds x-secret and x-color metadata to JSON Schema for branded Zod fields.
 * This is used internally by toJsonSchema.
 */
function addSchemaMetadata(
  zodSchema: z.ZodTypeAny,
  jsonSchema: Record<string, unknown>
): void {
  // Type guard to check if this is an object schema
  if (!("shape" in zodSchema)) return;

  const objectSchema = zodSchema as z.ZodObject<z.ZodRawShape>;
  const properties = jsonSchema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (!properties) return;

  for (const [key, fieldSchema] of Object.entries(objectSchema.shape)) {
    if (isSecretSchema(fieldSchema as z.ZodTypeAny) && properties[key]) {
      properties[key]["x-secret"] = true;
    }
    if (isColorSchema(fieldSchema as z.ZodTypeAny) && properties[key]) {
      properties[key]["x-color"] = true;
    }
  }
}

/**
 * Converts a Zod schema to JSON Schema with automatic branded metadata.
 * Uses Zod v4's native toJSONSchema() method.
 *
 * The branded metadata enables DynamicForm to automatically render
 * specialized input fields (password for secrets, color picker for colors).
 */
export function toJsonSchema(zodSchema: z.ZodTypeAny): Record<string, unknown> {
  // Use Zod's native JSON Schema conversion
  const jsonSchema = zodSchema.toJSONSchema() as Record<string, unknown>;
  addSchemaMetadata(zodSchema, jsonSchema);
  return jsonSchema;
}
