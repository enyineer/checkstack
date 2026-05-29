/**
 * Recursive template rendering for action `config` objects.
 *
 * Action configs are arbitrary JSON: strings, numbers, booleans, arrays,
 * objects. Strings may carry `{{ }}` interpolation that should be
 * rendered against the current scope. This helper walks the object tree
 * and renders every string value in place, leaving non-strings alone.
 *
 * Errors from individual templates surface up — the dispatch engine
 * catches and converts them into a failed step.
 */
import {
  evaluate as evaluateExpression,
  parseCondition,
  parseTemplate,
  render as renderTemplate,
  type FilterRegistry,
  type TemplateContext,
} from "@checkstack/template-engine";

/**
 * Editor-type tags that denote a native-code field. Such fields are
 * passed through verbatim by {@link renderConfig} — their `{{ }}`, if
 * any, is NOT expanded, because script actions read run data from the
 * typed `context` (TS) or injected env vars (shell), not from templates.
 */
const CODE_EDITOR_TYPES = new Set(["shell", "typescript", "javascript"]);

/**
 * Narrow an unknown JSON value to a string-keyed record after a runtime
 * type check. The single cast is the canonical safe-narrowing pattern —
 * JSON schemas arrive as `Record<string, unknown>`, so reading nested
 * shape requires asserting the post-check type.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasCodeEditorType(propSchema: unknown): boolean {
  const types = asRecord(propSchema)["x-editor-types"];
  return (
    Array.isArray(types) &&
    types.some((t) => typeof t === "string" && CODE_EDITOR_TYPES.has(t))
  );
}

/**
 * Render an action's top-level `config`, skipping native-code fields.
 *
 * Identical to {@link renderValue} for every field EXCEPT those whose
 * JSON schema declares an `x-editor-types` of `shell` / `typescript` /
 * `javascript`: those are returned verbatim so any `{{ }}` stays literal.
 * This removes the deprecated "templates inside a code field" path so it
 * can't be used by accident — code fields get run data via `context` /
 * env vars instead. Falls back to {@link renderValue} when the config
 * isn't a plain object or no schema is available.
 */
export function renderConfig(args: {
  config: unknown;
  jsonSchema: Record<string, unknown> | undefined;
  context: TemplateContext;
  filters: FilterRegistry;
}): unknown {
  const { config, jsonSchema, context, filters } = args;
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return renderValue(config, context, filters);
  }
  const properties = asRecord(jsonSchema?.["properties"]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(asRecord(config))) {
    out[key] = hasCodeEditorType(properties[key])
      ? value
      : renderValue(value, context, filters);
  }
  return out;
}

/**
 * Render any value, recursing into objects and arrays. Strings are
 * passed through the template engine; everything else is returned as-is.
 */
export function renderValue(
  value: unknown,
  context: TemplateContext,
  filters: FilterRegistry,
): unknown {
  if (typeof value === "string") {
    return renderString(value, context, filters);
  }
  if (Array.isArray(value)) {
    return value.map((v) => renderValue(v, context, filters));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = renderValue(v, context, filters);
    }
    return out;
  }
  return value;
}

/**
 * Render a single string template. If the string contains no `{{`
 * markers, this is effectively a passthrough (the template engine
 * tokenises trivial cases very cheaply).
 *
 * For pure expressions like `"{{ count + 1 }}"` the renderer returns a
 * stringified value — callers that need the typed primitive should use
 * `renderExpression` instead.
 */
export function renderString(
  template: string,
  context: TemplateContext,
  filters: FilterRegistry,
): string {
  if (!template.includes("{{")) return template;
  return renderTemplate(parseTemplate(template), context, { filters });
}

/**
 * Evaluate an expression and return the raw (un-stringified) value.
 *
 * Use this when the dispatched action's schema expects a typed primitive
 * (e.g. `delay: { seconds: "{{ trigger.payload.retryAfter }}" }` — the
 * action expects a number, not a string).
 */
export function renderExpression(
  source: string,
  context: TemplateContext,
  filters: FilterRegistry,
): unknown {
  return evaluateExpression(parseCondition(source), context, { filters });
}
