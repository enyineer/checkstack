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
 * An RFC 3339 / ISO 8601 date-time WITH an explicit timezone designator (`Z` or
 * `±HH:MM` / `±HHMM`). Seconds (and sub-seconds) are optional; the offset is
 * NOT. We require the offset because the only alternative - feeding a zone-less
 * string to `new Date()` - interprets it in the RUNTIME's local zone, so the
 * same model string would resolve to different instants on pods in different
 * timezones (this platform runs N pods sharing one DB). Date-only strings
 * (`2026-07-01`) are likewise rejected: they silently mean UTC midnight and
 * throw away the time the operator asked for. The model is told the reference
 * timezone in the system prompt, so it can always produce an offset.
 */
const RFC3339_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})$/;

/** Model-facing hint stamped on every date field's JSON Schema description. */
const DATE_FIELD_HINT =
  "RFC 3339 date-time WITH an explicit timezone offset, e.g. " +
  '"2026-07-01T22:00:00Z" or "2026-07-01T22:00:00+02:00". ' +
  "Zone-less and date-only values are rejected.";

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
        // Tell the model the exact contract right on the field, so it emits an
        // offset the first time instead of learning via a rejected tool call.
        ctx.jsonSchema.description = ctx.jsonSchema.description
          ? `${ctx.jsonSchema.description} ${DATE_FIELD_HINT}`
          : DATE_FIELD_HINT;
      }
    },
  }) as JsonSchemaNode;
  lockAdditionalProperties(modelSchema);

  // Cast: the SDK's `jsonSchema()` wants its JSONSchema7 type; the value above
  // is exactly that JSON Schema object (just typed as our narrower view).
  return jsonSchema<unknown>(modelSchema as Parameters<typeof jsonSchema>[0], {
    validate: (value) => {
      // Enforce the offset contract BEFORE parsing. This must run for
      // `z.coerce.date()` too: Zod's own coercion is `new Date()`, which would
      // happily accept a zone-less string and interpret it server-local - the
      // exact ambiguity we reject. A plain Error (not a ZodError) carries the
      // most readable message back to the model for self-repair.
      const violations = collectDateOffsetIssues(value, input);
      if (violations.length > 0) {
        return { success: false, error: new Error(violations.join(" ")) };
      }
      const result = input.safeParse(coerceDateValues(value, input));
      return result.success
        ? { success: true, value: result.data }
        : { success: false, error: result.error };
    },
  });
}

/**
 * The ONE entry point for handing a Zod schema to the model. Date-bearing
 * schemas get the date-safe + coercing treatment ({@link dateSafeModelSchema});
 * everything else passes through as raw Zod so the SDK handles it natively.
 *
 * Call this at EVERY model-schema boundary (chat tool inputs, agent-runner tool
 * inputs, `generateObject` output) so the gate can never be wired into some
 * branches and forgotten in others.
 */
export function toModelSchema(
  input: z.ZodTypeAny,
): Schema<unknown> | z.ZodTypeAny {
  return schemaContainsDate(input) ? dateSafeModelSchema(input) : input;
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
    // Only convert strings that carry an explicit offset, so the resulting
    // instant is unambiguous regardless of the pod's local timezone. Anything
    // else is left as-is and is rejected upstream by collectDateOffsetIssues
    // (this branch never silently local-interprets a zone-less string).
    return typeof value === "string" && RFC3339_WITH_OFFSET.test(value)
      ? new Date(value)
      : value;
  }
  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(value)) return value;
    const element = (schema as z.ZodArray<z.ZodTypeAny>).element;
    return value.map((item) => coerceDateValues(item, element));
  }
  if (schema instanceof z.ZodUnion) {
    // Coerce against the first option that declares a date; unions of
    // non-overlapping shapes are rare at model boundaries but cheap to support.
    const dateOption = (schema.options as z.ZodTypeAny[]).find((option) =>
      schemaContainsDate(option),
    );
    return dateOption ? coerceDateValues(value, dateOption) : value;
  }
  if (schema instanceof z.ZodRecord) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }
    const valueType = schema.valueType as z.ZodTypeAny;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        coerceDateValues(item, valueType),
      ]),
    );
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
 * Walk a value against its schema and report every date position whose value is
 * NOT an RFC 3339 date-time with an explicit timezone offset (zone-less,
 * date-only, a bare number, or otherwise unparseable). Mirrors
 * {@link coerceDateValues}' traversal so the gate covers exactly the positions
 * the schema declares as dates. Returns one human-readable sentence per
 * violation (consumed by the model for self-repair); an empty array means the
 * value is offset-clean. `undefined`/`null` at optional positions are skipped -
 * a genuinely missing required date is left to the schema's own parse to report.
 */
export function collectDateOffsetIssues(
  value: unknown,
  schema: z.ZodTypeAny,
  path: string = "",
): string[] {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return value === null || value === undefined
      ? []
      : collectDateOffsetIssues(value, schema.unwrap() as z.ZodTypeAny, path);
  }
  if (schema instanceof z.ZodDefault) {
    return value === undefined
      ? []
      : collectDateOffsetIssues(
          value,
          schema.def.innerType as z.ZodTypeAny,
          path,
        );
  }
  if (schema instanceof z.ZodDate) {
    if (value === undefined || value === null) return [];
    const where = path ? `\`${path}\`` : "the date value";
    if (typeof value !== "string") {
      return [
        `${where} must be a ${DATE_FIELD_HINT} (got a ${typeof value}).`,
      ];
    }
    if (!RFC3339_WITH_OFFSET.test(value)) {
      return [`${where} must be a ${DATE_FIELD_HINT} (got "${value}").`];
    }
    if (Number.isNaN(new Date(value).getTime())) {
      return [`${where} is not a valid calendar date-time (got "${value}").`];
    }
    return [];
  }
  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(value)) return [];
    const element = (schema as z.ZodArray<z.ZodTypeAny>).element;
    return value.flatMap((item, i) =>
      collectDateOffsetIssues(item, element, `${path}[${i}]`),
    );
  }
  if (schema instanceof z.ZodUnion) {
    const dateOption = (schema.options as z.ZodTypeAny[]).find((option) =>
      schemaContainsDate(option),
    );
    return dateOption ? collectDateOffsetIssues(value, dateOption, path) : [];
  }
  if (schema instanceof z.ZodRecord) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [];
    }
    const valueType = schema.valueType as z.ZodTypeAny;
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, item]) =>
        collectDateOffsetIssues(
          item,
          valueType,
          path ? `${path}.${key}` : key,
        ),
    );
  }
  if ("shape" in schema) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [];
    }
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const record = value as Record<string, unknown>;
    return Object.entries(shape).flatMap(([key, fieldSchema]) =>
      key in record
        ? collectDateOffsetIssues(
            record[key],
            fieldSchema as z.ZodTypeAny,
            path ? `${path}.${key}` : key,
          )
        : [],
    );
  }
  return [];
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
