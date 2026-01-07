import { z } from "zod";
import {
  isSecretSchema,
  isColorSchema,
  getOptionsResolverMetadata,
  isHiddenSchema,
} from "./branded-types";

/**
 * Adds x-secret, x-color, x-options-resolver, x-depends-on, and x-hidden
 * metadata to JSON Schema for branded Zod fields.
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

    // Secret field
    if (isSecretSchema(zodField)) {
      jsonField["x-secret"] = true;
    }

    // Color field
    if (isColorSchema(zodField)) {
      jsonField["x-color"] = true;
    }

    // Hidden field
    if (isHiddenSchema(zodField)) {
      jsonField["x-hidden"] = true;
    }

    // Options resolver field
    const resolverMeta = getOptionsResolverMetadata(zodField);
    if (resolverMeta) {
      jsonField["x-options-resolver"] = resolverMeta.resolver;
      if (resolverMeta.dependsOn) {
        jsonField["x-depends-on"] = resolverMeta.dependsOn;
      }
      if (resolverMeta.searchable) {
        jsonField["x-searchable"] = true;
      }
    }

    // Recurse into nested objects and arrays
    addSchemaMetadata(zodField, jsonField);
  }
}

/**
 * Converts a Zod schema to JSON Schema with automatic branded metadata.
 * Uses Zod v4's native toJSONSchema() method.
 *
 * The branded metadata enables DynamicForm to automatically render
 * specialized input fields (password for secrets, color picker for colors,
 * dropdowns for optionsResolver fields, hidden for auto-populated fields).
 */
export function toJsonSchema(zodSchema: z.ZodTypeAny): Record<string, unknown> {
  // Use Zod's native JSON Schema conversion
  const jsonSchema = zodSchema.toJSONSchema() as Record<string, unknown>;
  addSchemaMetadata(zodSchema, jsonSchema);
  return jsonSchema;
}
