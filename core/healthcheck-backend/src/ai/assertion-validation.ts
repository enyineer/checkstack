import {
  NumericOperators,
  StringOperators,
  BooleanOperators,
  ArrayOperators,
  DynamicOperators,
} from "@checkstack/backend-api";
import type { CollectorConfigEntry } from "@checkstack/healthcheck-common";

/**
 * Validate the `field`/`operator` of every collector assertion against the
 * collector's RESULT schema and the canonical operator vocabulary.
 *
 * WHY this exists: `CollectorAssertionSchema` types `field` and `operator` as
 * free-form `z.string()`, and `validateConfiguration` does not check them, so a
 * model that guesses (e.g. `field: "status", operator: "eq"` instead of
 * `field: "statusCode", operator: "equals"`) produces a config that saves but
 * renders as EMPTY dropdowns in the editor (the values are not in the options
 * derived from the result schema + operator set). This validator rejects such
 * assertions at propose/update time with a precise, self-correcting error that
 * lists the assertable fields and valid operators, so the model fixes it.
 *
 * The operator vocabulary is the SAME canonical set the runtime evaluator and
 * the editor's AssertionBuilder use (`@checkstack/backend-api` assertion enums).
 */

/** A structured validation issue, mirroring `validateConfiguration` errors. */
export interface AssertionIssue {
  path: Array<string | number>;
  message: string;
}

/** Every valid operator across all field types (for the "unknown operator" check). */
const ALL_OPERATORS: ReadonlySet<string> = new Set<string>([
  ...NumericOperators.options,
  ...StringOperators.options,
  ...BooleanOperators.options,
  ...ArrayOperators.options,
  ...DynamicOperators.options,
]);

/** Operators valid for a given JSON Schema `type` (boolean is value-less). */
const OPERATORS_BY_JSON_TYPE: Record<string, readonly string[]> = {
  number: NumericOperators.options,
  integer: NumericOperators.options,
  string: StringOperators.options,
  boolean: BooleanOperators.options,
  array: ArrayOperators.options,
};

const DYNAMIC_OPERATORS: ReadonlySet<string> = new Set<string>(
  DynamicOperators.options,
);

/** Extract the top-level `properties` record from a JSON-Schema-ish object. */
function extractProperties(
  resultSchema: Record<string, unknown> | undefined,
): Record<string, { type?: unknown }> {
  if (!resultSchema) return {};
  const properties = resultSchema.properties;
  if (typeof properties !== "object" || properties === null) return {};
  return properties as Record<string, { type?: unknown }>;
}

/** Sorted, comma-joined operator list for an error message. */
function listOperators(operators: ReadonlySet<string> | readonly string[]): string {
  return [...operators].toSorted().join(", ");
}

/**
 * Validate every assertion on every collector. `resultSchemasById` maps a
 * collector id to its result JSON Schema (from the collector DTO registry).
 * Returns one issue per problem; an empty array means all assertions are valid.
 */
export function validateCollectorAssertions({
  collectors,
  resultSchemasById,
}: {
  collectors: CollectorConfigEntry[] | undefined;
  resultSchemasById: ReadonlyMap<string, Record<string, unknown>>;
}): AssertionIssue[] {
  const issues: AssertionIssue[] = [];
  if (!collectors) return issues;

  for (const [collectorIndex, entry] of collectors.entries()) {
    const assertions = entry.assertions;
    if (!assertions?.length) continue;

    const properties = extractProperties(resultSchemasById.get(entry.collectorId));
    const fieldNames = Object.keys(properties);

    for (const [assertionIndex, assertion] of assertions.entries()) {
      const at: Array<string | number> = [
        "collectors",
        collectorIndex,
        "assertions",
        assertionIndex,
      ];
      const isJsonPath =
        typeof assertion.jsonPath === "string" && assertion.jsonPath.length > 0;

      // Every assertion's operator must be a known operator.
      if (!ALL_OPERATORS.has(assertion.operator)) {
        issues.push({
          path: [...at, "operator"],
          message: `Unknown operator "${assertion.operator}". Valid operators: ${listOperators(ALL_OPERATORS)}.`,
        });
        continue;
      }

      // JSONPath assertions assert against an arbitrary path, not a result-schema
      // field, so only the operator vocabulary applies (the dynamic set).
      if (isJsonPath) {
        if (!DYNAMIC_OPERATORS.has(assertion.operator)) {
          issues.push({
            path: [...at, "operator"],
            message: `Operator "${assertion.operator}" is not valid for a JSONPath assertion. Valid: ${listOperators(DYNAMIC_OPERATORS)}.`,
          });
        }
        continue;
      }

      // Field-based assertion: the field must exist in the collector's result
      // schema (when we know the schema). Empty schema -> skip (cannot validate).
      if (fieldNames.length > 0 && !fieldNames.includes(assertion.field)) {
        issues.push({
          path: [...at, "field"],
          message: `Unknown assertable field "${assertion.field}" for collector "${entry.collectorId}". Assertable fields: ${fieldNames.join(", ") || "(none)"}. For an arbitrary path, set jsonPath instead.`,
        });
        continue;
      }

      // The operator must be valid for the field's JSON type.
      const prop = properties[assertion.field];
      const jsonType = prop && typeof prop.type === "string" ? prop.type : undefined;
      const allowed = jsonType ? OPERATORS_BY_JSON_TYPE[jsonType] : undefined;
      if (allowed && !allowed.includes(assertion.operator)) {
        issues.push({
          path: [...at, "operator"],
          message: `Operator "${assertion.operator}" is not valid for ${jsonType} field "${assertion.field}". Valid: ${allowed.join(", ")}.`,
        });
      }
    }
  }

  return issues;
}
