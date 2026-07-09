import { z } from "zod";
import { SECRET_TEMPLATE_REGEX } from "@checkstack/secrets-common";
import { isSecretSchema } from "@checkstack/backend-api";

/**
 * Interface for resolving secret names to their decrypted values.
 * Promoted out of `@checkstack/gitops-backend`.
 */
export interface SecretStore {
  resolve: (name: string) => Promise<string>;
  /**
   * Resolve many secret names in one batch. Optional — implementations
   * backed by the active backend override this to resolve the active
   * backend id ONCE for the whole batch (instead of the per-name config
   * read `resolve` incurs), returning a `name → value` map keyed by the
   * distinct input names. Throws `Secret not found: NAME` on any absent
   * name, matching `resolve`. Callers that need a batch but face a store
   * without this method fall back to looping `resolve`.
   */
  resolveMany?: (names: string[]) => Promise<Map<string, string>>;
}

/**
 * Result of schema-driven secret resolution.
 */
export interface SecretResolutionResult<T> {
  /** The value with x-secret fields resolved. */
  resolved: T;
  /**
   * Warnings for `${{ secrets.NAME }}` templates found in non-secret
   * fields. These templates are NOT resolved — the field must be
   * annotated with `configString({ "x-secret": true })` for resolution.
   */
  warnings: string[];
}

/**
 * Schema-driven secret resolver.
 *
 * Walks a Zod schema to find fields annotated with
 * `configString({ "x-secret": true })`, then resolves
 * `${{ secrets.NAME }}` templates **only** in those fields. Non-secret
 * fields are returned as-is, preventing accidental leaks into display
 * fields. Templates in non-secret fields are reported as warnings.
 *
 * Supports full-value templates and inline interpolation:
 * - `"${{ secrets.DB_PASS }}"` → `"actual-password"`
 * - `"postgres://u:${{ secrets.PASS }}@host/db"` → interpolated
 */
export async function resolveSecretsBySchema<T = unknown>(params: {
  value: T;
  schema: z.ZodTypeAny;
  secretStore: SecretStore;
}): Promise<SecretResolutionResult<T>> {
  const { value, schema, secretStore } = params;
  const warnings: string[] = [];
  const resolved = await walkAndResolve({
    value,
    schema,
    secretStore,
    warnings,
    path: "",
  });
  return { resolved: resolved as T, warnings };
}

// ─── Recursive Walker ──────────────────────────────────────────────────────

async function walkAndResolve(params: {
  value: unknown;
  schema: z.ZodTypeAny;
  secretStore: SecretStore;
  warnings: string[];
  path: string;
}): Promise<unknown> {
  const { value, secretStore, warnings, path } = params;
  const schema = unwrapZod(params.schema);

  if (value === null || value === undefined) {
    return value;
  }

  // Leaf node: if this schema is marked x-secret, resolve templates.
  if (isSecretSchema(schema)) {
    if (typeof value === "string") {
      return resolveTemplateString({ value, secretStore });
    }
    return value;
  }

  // Non-secret string leaf: check for unresolved templates and warn.
  if (typeof value === "string" && containsSecretTemplate(value)) {
    const fieldPath = path || "(root)";
    warnings.push(
      `Field "${fieldPath}" contains a secret template but is not marked as a secret field. ` +
        `Add configString({ "x-secret": true }) to the schema for this field to enable resolution.`,
    );
    return value;
  }

  // Object: recurse into each property using the schema's shape.
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
        result[key] = await walkAndResolve({
          value: result[key],
          schema: fieldSchema,
          secretStore,
          warnings,
          path: path ? `${path}.${key}` : key,
        });
      }
    }

    return result;
  }

  // Array: recurse into each element using the element schema.
  if (schema instanceof z.ZodArray && Array.isArray(value)) {
    const elementSchema = schema.element as z.ZodTypeAny;
    return Promise.all(
      value.map((item, index) =>
        walkAndResolve({
          value: item,
          schema: elementSchema,
          secretStore,
          warnings,
          path: `${path}[${index}]`,
        }),
      ),
    );
  }

  // Discriminated union: find the matching variant and recurse.
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
    const matchedVariant = options.find((option) => {
      const discField = option.shape[discriminator];
      if (discField instanceof z.ZodLiteral) {
        return discField.value === discriminatorValue;
      }
      return false;
    });

    if (matchedVariant) {
      return walkAndResolve({
        value,
        schema: matchedVariant,
        secretStore,
        warnings,
        path,
      });
    }
  }

  // Union (oneOf/anyOf without discriminator): try each variant.
  if (
    schema instanceof z.ZodUnion &&
    typeof value === "object" &&
    value !== null
  ) {
    const options = schema.options as z.ZodTypeAny[];
    for (const option of options) {
      const parsed = option.safeParse(value);
      if (parsed.success) {
        return walkAndResolve({
          value,
          schema: option,
          secretStore,
          warnings,
          path,
        });
      }
    }
  }

  // No schema match — return value unchanged.
  return value;
}

/** Quick check whether a string contains any `${{ secrets.NAME }}` pattern. */
function containsSecretTemplate(value: string): boolean {
  SECRET_TEMPLATE_REGEX.lastIndex = 0;
  return SECRET_TEMPLATE_REGEX.test(value);
}

// ─── Zod Unwrapping ────────────────────────────────────────────────────────

/** Unwraps Optional, Default, and Nullable wrappers to get the inner schema. */
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

// ─── Template Resolution ───────────────────────────────────────────────────

/**
 * Resolves all `${{ secrets.NAME }}` patterns in a string. Each unique
 * secret name is resolved once (cached per call) to avoid duplicate
 * lookups.
 */
async function resolveTemplateString(params: {
  value: string;
  secretStore: SecretStore;
}): Promise<string> {
  const { value, secretStore } = params;

  const secretNames = new Set<string>();
  SECRET_TEMPLATE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECRET_TEMPLATE_REGEX.exec(value)) !== null) {
    secretNames.add(match[1]);
  }

  if (secretNames.size === 0) {
    return value;
  }

  const resolvedValues = new Map<string, string>();
  for (const name of secretNames) {
    resolvedValues.set(name, await secretStore.resolve(name));
  }

  SECRET_TEMPLATE_REGEX.lastIndex = 0;
  return value.replaceAll(
    SECRET_TEMPLATE_REGEX,
    (_fullMatch, secretName: string) => resolvedValues.get(secretName)!,
  );
}
