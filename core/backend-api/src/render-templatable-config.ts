import { z } from "zod";
import {
  renderTemplatePreview,
  type TemplateContext,
} from "@checkstack/template-engine";

import { getConfigMeta } from "./zod-config";

// Re-export the canonical preview helper so backend consumers can render a
// single templatable value (editor-preview / diagnostics) without reaching
// into `@checkstack/template-engine` directly. The frontend imports it from
// the template engine. Both share one implementation, so previews never
// diverge from the run-time render.
export { renderTemplatePreview } from "@checkstack/template-engine";

/**
 * Shared per-environment templating pass for collector / strategy config.
 *
 * Walks a validated config object against its zod schema and, for each STRING
 * field marked `x-templatable`, renders its value through the template engine
 * against the supplied `context` (`{ environment, check, system }`). Every
 * other field is passed through verbatim, so a literal `{{` in a
 * non-templatable field is never touched.
 *
 * This pass runs PER ENVIRONMENT in the executor, AFTER the secret-render pass
 * and BEFORE the strategy client build / collector execute, so each resolved
 * environment gets its own rendered config (see the queue-executor fan-out
 * loop). The two syntaxes are lexically distinct and resolved in separate
 * ordered stages:
 *
 *   - `${{ secrets.NAME }}` — resolved FIRST by the secrets resolver, in
 *     `x-secret` / `x-secret-env` fields only.
 *   - `{{ environment.* }}` / `{{ check.* }}` / `{{ system.* }}` — resolved
 *     SECOND by this pass, in `x-templatable` fields only.
 *
 * A field marked both `x-secret`(-env) and `x-templatable` is a load-time
 * config error (see {@link assertNoSecretTemplatableConflict}), so the two
 * passes always touch disjoint fields.
 */

/** Strip Optional / Default / Nullable wrappers to reach the inner schema. */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  // Loop because wrappers can nest (e.g. `.optional().default()`).
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      current = current.def.innerType as z.ZodTypeAny;
      continue;
    }
    return current;
  }
}

/**
 * Recursively walk a value against its zod schema, rendering `x-templatable`
 * string fields. Returns a NEW value; the input is never mutated.
 */
function walk({
  value,
  schema,
  context,
}: {
  value: unknown;
  schema: z.ZodTypeAny;
  context: TemplateContext;
}): unknown {
  const inner = unwrap(schema);

  // Array — render each element against the element schema.
  if (inner instanceof z.ZodArray) {
    if (!Array.isArray(value)) return value;
    const element = (inner as z.ZodArray<z.ZodTypeAny>).element;
    return value.map((item) => walk({ value: item, schema: element, context }));
  }

  // Object — render each known property against its field schema.
  if (inner instanceof z.ZodObject) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
    const source = value as Record<string, unknown>;
    const next: Record<string, unknown> = { ...source };
    for (const [key, fieldSchema] of Object.entries(shape)) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      next[key] = walk({
        value: source[key],
        schema: fieldSchema as z.ZodTypeAny,
        context,
      });
    }
    return next;
  }

  // Leaf string — render only when the field is marked templatable. The meta
  // lives on the ORIGINAL (possibly-wrapped) schema, so look it up on `schema`
  // (getConfigMeta unwraps internally).
  if (typeof value === "string" && getConfigMeta(schema)?.["x-templatable"]) {
    return renderTemplatePreview({ value, context });
  }

  return value;
}

/**
 * Render every `x-templatable` string field in `config` against `context`.
 * Returns a new config object; non-templatable fields are passed through
 * verbatim.
 */
export function renderTemplatableConfig({
  config,
  schema,
  context,
}: {
  config: unknown;
  schema: z.ZodType<unknown>;
  context: TemplateContext;
}): unknown {
  return walk({ value: config, schema: schema as z.ZodTypeAny, context });
}

/**
 * Load-time guard: a config field MUST NOT carry both a secret marker
 * (`x-secret` or `x-secret-env`) and `x-templatable`. They are resolved in
 * separate ordered passes (secrets first, templating second) and must never
 * combine. Throws on the first conflicting field, naming its path.
 *
 * Call this once per registered collector / strategy config schema at plugin
 * load time so a misconfigured field fails fast instead of silently skipping
 * one of the two passes at run time.
 */
export function assertNoSecretTemplatableConflict({
  schema,
  schemaName,
}: {
  schema: z.ZodType<unknown>;
  schemaName: string;
}): void {
  const conflict = findSecretTemplatableConflict({
    schema: schema as z.ZodTypeAny,
    path: "",
  });
  if (conflict) {
    throw new Error(
      `Config schema "${schemaName}" field "${conflict}" is marked both ` +
        `as a secret (x-secret / x-secret-env) and x-templatable. Secrets ` +
        `and templating are resolved in separate passes and must not be ` +
        `combined on the same field.`,
    );
  }
}

function findSecretTemplatableConflict({
  schema,
  path,
}: {
  schema: z.ZodTypeAny;
  path: string;
}): string | undefined {
  const inner = unwrap(schema);

  if (inner instanceof z.ZodArray) {
    return findSecretTemplatableConflict({
      schema: (inner as z.ZodArray<z.ZodTypeAny>).element,
      path: `${path}[]`,
    });
  }

  if (inner instanceof z.ZodObject) {
    const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const fieldPath = path ? `${path}.${key}` : key;
      const meta = getConfigMeta(fieldSchema as z.ZodTypeAny);
      const isSecret =
        meta?.["x-secret"] === true || meta?.["x-secret-env"] === true;
      if (isSecret && meta?.["x-templatable"] === true) {
        return fieldPath;
      }
      const nested = findSecretTemplatableConflict({
        schema: fieldSchema as z.ZodTypeAny,
        path: fieldPath,
      });
      if (nested) return nested;
    }
    return undefined;
  }

  return undefined;
}
