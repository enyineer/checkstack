import { z } from "zod";
import { isSecretSchema } from "@checkstack/backend-api";

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
  visit: (input: { path: string; value: string }) => Promise<string>;
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
  visit: (input: { path: string; value: string }) => Promise<string>;
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
      return visit({ path: path || "(root)", value });
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
  if (unwrapped instanceof z.ZodOptional) {
    unwrapped = unwrapped.unwrap() as z.ZodTypeAny;
  }
  if (unwrapped instanceof z.ZodDefault) {
    unwrapped = unwrapped.def.innerType as z.ZodTypeAny;
  }
  if (unwrapped instanceof z.ZodNullable) {
    unwrapped = unwrapped.unwrap() as z.ZodTypeAny;
  }
  return unwrapped;
}
