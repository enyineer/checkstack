import { jsonSchema, type Schema } from "ai";
import { z } from "zod";

/** The slice of a JSON Schema node this module reads/writes. */
interface JsonSchemaNode {
  type?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode | JsonSchemaNode[];
  additionalProperties?: unknown;
}

/**
 * The single model-boundary date handler. The AI SDK builds the model-facing
 * JSON Schema from a raw Zod schema via Zod v4's `toJSONSchema()` with the
 * default `unrepresentable: "throw"`, which throws "Date cannot be represented
 * in JSON Schema" for `z.date()` AND `z.coerce.date()`. A single date field in
 * any tool input or `generateObject` output would therefore crash the model
 * call (for the chat, before the model is even invoked).
 *
 * For date-bearing schemas we hand the SDK a ready-made schema (so it never
 * runs the throwing converter) plus our own validator:
 *  - the model-facing schema renders dates as `{ type: "string", format:
 *    "date-time" }` (their wire shape) - matching the SDK's own options
 *    (draft-7 / input) so non-date parts are byte-identical to before;
 *  - the validator coerces the ISO strings the model emits back into real
 *    `Date`s before parsing with the ORIGINAL schema, so refinements and the
 *    downstream RPC client (which expects `Date`s) keep working.
 *
 * Apply this at EVERY model-schema boundary (gated by {@link schemaContainsDate})
 * so individual tool / agent definitions never have to special-case dates - the
 * thing that would otherwise regress one tool at a time. Non-date schemas are
 * left as raw Zod so the SDK handles them exactly as it always has.
 */
export function dateSafeModelSchema(input: z.ZodTypeAny): Schema<unknown> {
  // Cast: bridges Zod's own JSONSchema type to the node shape this module
  // mutates. It is the same JSON Schema object, just a narrower view.
  const modelSchema = z.toJSONSchema(input, {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
    override: (ctx) => {
      if (ctx.zodSchema instanceof z.ZodDate) {
        ctx.jsonSchema.type = "string";
        ctx.jsonSchema.format = "date-time";
      }
    },
  }) as JsonSchemaNode;
  lockAdditionalProperties(modelSchema);

  // Cast: the SDK's `jsonSchema()` wants its JSONSchema7 type; the value above
  // is exactly that JSON Schema object (just typed as our narrower view).
  return jsonSchema<unknown>(modelSchema as Parameters<typeof jsonSchema>[0], {
    validate: (value) => {
      const result = input.safeParse(coerceDateValues(value, input));
      return result.success
        ? { success: true, value: result.data }
        : { success: false, error: result.error };
    },
  });
}

/**
 * Does any node of this schema declare a `Date`? Only such inputs need the
 * special handling above; everything else stays on the SDK's native path.
 */
export function schemaContainsDate(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodDate) return true;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return schemaContainsDate(schema.unwrap() as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodDefault) {
    return schemaContainsDate(schema.def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodArray) {
    return schemaContainsDate(
      (schema as z.ZodArray<z.ZodTypeAny>).element,
    );
  }
  if (schema instanceof z.ZodUnion) {
    return (schema.options as z.ZodTypeAny[]).some((option) =>
      schemaContainsDate(option),
    );
  }
  if (schema instanceof z.ZodRecord) {
    return schemaContainsDate(schema.valueType as z.ZodTypeAny);
  }
  if ("shape" in schema) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    return Object.values(shape).some((field) =>
      schemaContainsDate(field as z.ZodTypeAny),
    );
  }
  return false;
}

/**
 * Convert the ISO date strings the model sends into `Date`s at the positions
 * the schema declares as dates. Schema-guided (never touches a plain string
 * field) and value-level (the original schema still validates), so refinements,
 * metadata and unrecognized shapes are preserved untouched.
 */
export function coerceDateValues(
  value: unknown,
  schema: z.ZodTypeAny,
): unknown {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return value === null || value === undefined
      ? value
      : coerceDateValues(value, schema.unwrap() as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodDefault) {
    return value === undefined
      ? value
      : coerceDateValues(value, schema.def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodDate) {
    return typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : value;
  }
  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(value)) return value;
    const element = (schema as z.ZodArray<z.ZodTypeAny>).element;
    return value.map((item) => coerceDateValues(item, element));
  }
  if ("shape" in schema) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const out: Record<string, unknown> = {
      ...(value as Record<string, unknown>),
    };
    for (const [key, fieldSchema] of Object.entries(shape)) {
      if (key in out) {
        out[key] = coerceDateValues(out[key], fieldSchema as z.ZodTypeAny);
      }
    }
    return out;
  }
  return value;
}

/**
 * Stamp `additionalProperties: false` on every fixed-property object node,
 * mirroring what the SDK's zod adapter does so strict providers (e.g. OpenAI)
 * accept the schema. Records already carry an `additionalProperties` schema, so
 * they are left untouched.
 */
function lockAdditionalProperties(node: JsonSchemaNode): void {
  if (typeof node !== "object" || node === null) return;
  if (node.properties && node.additionalProperties === undefined) {
    node.additionalProperties = false;
  }
  if (node.properties) {
    for (const child of Object.values(node.properties)) {
      if (typeof child === "object") lockAdditionalProperties(child);
    }
  }
  if (node.items && typeof node.items === "object") {
    const items = node.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (typeof item === "object") lockAdditionalProperties(item);
      }
    } else {
      lockAdditionalProperties(items);
    }
  }
}
