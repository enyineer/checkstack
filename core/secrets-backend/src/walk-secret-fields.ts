import { z } from "zod";
import { isSecretSchema, getSecretId } from "@checkstack/backend-api";

/** The information the walk hands a visitor for each `x-secret` string leaf. */
export interface SecretFieldVisit {
  /** Dot/bracket walk path, for diagnostics (`"auth.password"`, `"hosts[0]"`). */
  path: string;
  /**
   * The field's stable extraction id (`x-secret-id`), or `undefined` for a
   * plain `configString({ "x-secret": true })`. Extraction-channel callers key
   * the internal secret by this - never by `path`.
   */
  secretId: string | undefined;
  /** The current string value at this leaf. */
  value: string;
}

/**
 * Generic schema-driven walk over `x-secret`-annotated string fields.
 *
 * This is the shared machinery behind both the runtime secret resolution
 * (`resolveSecretsBySchema`) and the connection-credential consolidation
 * (extract inline values to internal secrets / inflate references). It
 * walks a value against its Zod schema exactly like the resolver does
 * (objects, arrays, optional/default/nullable, discriminated + plain
 * unions) and invokes `visit` for every `x-secret` STRING leaf, replacing
 * that leaf with whatever `visit` returns.
 *
 * `visit` is async and receives the field path (for diagnostics) and the
 * current string value. Non-secret fields are returned unchanged — so this
 * never touches non-credential config, which is the whole point of acting
 * only on `x-secret` fields.
 */
export async function walkSecretFields(params: {
  value: unknown;
  schema: z.ZodTypeAny;
  visit: (input: SecretFieldVisit) => Promise<string>;
}): Promise<unknown> {
  return walk({
    value: params.value,
    schema: params.schema,
    visit: params.visit,
    path: "",
  });
}

async function walk(params: {
  value: unknown;
  schema: z.ZodTypeAny;
  visit: (input: SecretFieldVisit) => Promise<string>;
  path: string;
}): Promise<unknown> {
  const { value, visit, path } = params;
  const schema = unwrapZod(params.schema);

  if (value === null || value === undefined) {
    return value;
  }

  // x-secret string leaf: hand it to the visitor.
  if (isSecretSchema(schema)) {
    if (typeof value === "string") {
      return visit({
        path: path || "(root)",
        secretId: getSecretId(schema),
        value,
      });
    }
    return value;
  }

  if (
    schema instanceof z.ZodObject &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const result: Record<string, unknown> = {
      ...(value as Record<string, unknown>),
    };
    for (const [key, fieldSchema] of Object.entries(shape)) {
      if (key in result) {
        result[key] = await walk({
          value: result[key],
          schema: fieldSchema,
          visit,
          path: path ? `${path}.${key}` : key,
        });
      }
    }
    return result;
  }

  if (schema instanceof z.ZodArray && Array.isArray(value)) {
    const elementSchema = schema.element as z.ZodTypeAny;
    return Promise.all(
      value.map((item, index) =>
        walk({
          value: item,
          schema: elementSchema,
          visit,
          path: `${path}[${index}]`,
        }),
      ),
    );
  }

  if (
    schema instanceof z.ZodDiscriminatedUnion &&
    typeof value === "object" &&
    value !== null
  ) {
    const discriminator = (schema.def as { discriminator: string })
      .discriminator;
    const discriminatorValue = (value as Record<string, unknown>)[
      discriminator
    ];
    const options = schema.options as z.ZodObject<z.ZodRawShape>[];
    const matched = options.find((option) => {
      const discField = option.shape[discriminator];
      return discField instanceof z.ZodLiteral
        ? discField.value === discriminatorValue
        : false;
    });
    if (matched) {
      return walk({ value, schema: matched, visit, path });
    }
  }

  if (
    schema instanceof z.ZodUnion &&
    typeof value === "object" &&
    value !== null
  ) {
    const options = schema.options as z.ZodTypeAny[];
    for (const option of options) {
      if (option.safeParse(value).success) {
        return walk({ value, schema: option, visit, path });
      }
    }
  }

  return value;
}

function unwrapZod(schema: z.ZodTypeAny): z.ZodTypeAny {
  let unwrapped = schema;
  // Loop so multi-level wrappers (e.g. `.optional().default({})`,
  // `.default().nullable()`) are fully peeled. A single fixed-order pass leaves
  // an inner wrapper on some combos, which would make a secret-bearing CONTAINER
  // (object/array/union) miss its `instanceof` check and skip extraction -
  // leaving the inline secret plaintext at rest. Mirrors the looping unwrap in
  // zod-config / config-secret-channel so all walkers agree on field identity.
  for (;;) {
    if (unwrapped instanceof z.ZodOptional || unwrapped instanceof z.ZodNullable) {
      unwrapped = unwrapped.unwrap() as z.ZodTypeAny;
      continue;
    }
    if (unwrapped instanceof z.ZodDefault) {
      unwrapped = unwrapped.def.innerType as z.ZodTypeAny;
      continue;
    }
    return unwrapped;
  }
}
