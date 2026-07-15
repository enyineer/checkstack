/**
 * Pure mapping between the trace-extraction editor's row-based form state and
 * the `TraceExtractionRules` shape stored in a stream's config. Kept pure so the
 * Settings section stays a thin rendering layer and the round-trip (config ->
 * rows -> config) is unit-tested in isolation.
 *
 * `TraceExtractionRules` is `{ traceId?, spanId? }`, and each field rule is
 * `{ attributePaths?, bodyRegex? }`; every sub-key is OMITTED when empty. The
 * whole object is `undefined` when neither field has any rule - the caller sends
 * `traceExtraction: {}` to CLEAR previously-saved rules (the config merge
 * replaces the key), so an empty edit reliably persists as "no extraction".
 */

import type {
  TraceExtractionFieldRule,
  TraceExtractionRules,
} from "@checkstack/logstream-common";

/** One attribute-path row in a field editor. `id` is a stable React key. */
export interface AttributePathRow {
  id: string;
  path: string;
}

/** The two fields the extraction rules cover, in editor order. */
export const TRACE_EXTRACTION_FIELDS = ["traceId", "spanId"] as const;
export type TraceExtractionField = (typeof TRACE_EXTRACTION_FIELDS)[number];

/** One field's editor state: an ordered list of attribute paths + a body regex. */
export interface FieldRuleFormState {
  attributePaths: AttributePathRow[];
  bodyRegex: string;
}

export interface TraceExtractionFormState {
  traceId: FieldRuleFormState;
  spanId: FieldRuleFormState;
}

/**
 * Seed one field editor from a stored rule. Row ids are derived from the index
 * so the initial render is deterministic (the component mints fresh ids when the
 * operator ADDS a row).
 */
function fieldRuleToForm({
  field,
  rule,
}: {
  field: TraceExtractionField;
  rule: TraceExtractionFieldRule | undefined;
}): FieldRuleFormState {
  return {
    attributePaths: (rule?.attributePaths ?? []).map((path, index) => ({
      id: `${field}-path-${index}`,
      path,
    })),
    bodyRegex: rule?.bodyRegex ?? "",
  };
}

/** Seed the whole editor from stored rules. */
export function traceExtractionToForm(
  rules: TraceExtractionRules | undefined,
): TraceExtractionFormState {
  return {
    traceId: fieldRuleToForm({ field: "traceId", rule: rules?.traceId }),
    spanId: fieldRuleToForm({ field: "spanId", rule: rules?.spanId }),
  };
}

/**
 * Fold one field's rows back into a `TraceExtractionFieldRule`, or `undefined`
 * when nothing is set. Blank paths are dropped and duplicates removed (paths are
 * tried in order; a repeat is dead weight); a blank body regex is omitted. A
 * sub-key is omitted entirely when it has nothing.
 */
function formToFieldRule(
  form: FieldRuleFormState,
): TraceExtractionFieldRule | undefined {
  const seen = new Set<string>();
  const attributePaths: string[] = [];
  for (const row of form.attributePaths) {
    const path = row.path.trim();
    if (path.length === 0 || seen.has(path)) continue;
    seen.add(path);
    attributePaths.push(path);
  }

  const bodyRegex = form.bodyRegex.trim();
  const hasPaths = attributePaths.length > 0;
  const hasRegex = bodyRegex.length > 0;
  if (!hasPaths && !hasRegex) return undefined;

  const rule: TraceExtractionFieldRule = {};
  if (hasPaths) rule.attributePaths = attributePaths;
  if (hasRegex) rule.bodyRegex = bodyRegex;
  return rule;
}

/**
 * Fold the editor rows back into a `TraceExtractionRules`, or `undefined` when
 * neither field is set. A field key is omitted entirely when its rule is empty.
 */
export function formToTraceExtraction(
  form: TraceExtractionFormState,
): TraceExtractionRules | undefined {
  const traceId = formToFieldRule(form.traceId);
  const spanId = formToFieldRule(form.spanId);
  if (!traceId && !spanId) return undefined;

  const rules: TraceExtractionRules = {};
  if (traceId) rules.traceId = traceId;
  if (spanId) rules.spanId = spanId;
  return rules;
}
