import { evaluateAssertion } from "@checkstack/backend-api";
import type {
  AssertionOutcome,
  CollectorAssertion,
} from "@checkstack/healthcheck-common";
import {
  computeAssertionKey,
  truncateActual,
} from "@checkstack/healthcheck-common";
import { extractErrorMessage } from "@checkstack/common";
import { JSONPath } from "jsonpath-plus";

/**
 * Suffix the AssertionBuilder appends to a JSONPath field's path: an
 * `x-jsonpath` result field `body` is offered as the assertable field
 * `body.$`, with the actual expression stored in `assertion.jsonPath`.
 */
const JSONPATH_FIELD_SUFFIX = ".$";

/** Whether an assertion targets a JSONPath into a field, not the field itself. */
function isJsonPathAssertion(assertion: CollectorAssertion): boolean {
  return (
    assertion.field.endsWith(JSONPATH_FIELD_SUFFIX) ||
    (typeof assertion.jsonPath === "string" && assertion.jsonPath.trim() !== "")
  );
}

/**
 * Extract a JSONPath from a parsed JSON value. `wrap: false` returns the
 * single matched value directly (or `undefined` for no match), so `exists` /
 * `isEmpty` operate on the value itself, not on a match array. `eval: false`
 * rejects script/filter expressions outright - assertion paths are authored
 * by users and must never evaluate code on the core.
 */
/**
 * Narrow an `unknown` to the input type `JSONPath` accepts. Parsed JSON is
 * always one of these by construction; the guard exists because the shared
 * `evaluateJsonPathAssertions` signature hands the json through as `unknown`.
 */
function isJsonPathInput(
  value: unknown,
): value is string | number | boolean | object | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "object"
  );
}

function extractJsonPath(path: string, json: unknown): unknown {
  if (!isJsonPathInput(json)) return undefined;
  return JSONPath({ path, json, wrap: false, eval: false });
}

/** Human-readable failure string, stored on the run as `_assertionFailed`. */
function formatFailure({
  assertion,
  detail,
}: {
  assertion: CollectorAssertion;
  detail?: string;
}): string {
  const path = assertion.jsonPath?.trim();
  const parts = [
    assertion.field,
    ...(isJsonPathAssertion(assertion) && path ? [path] : []),
    assertion.operator,
    ...(assertion.value === undefined ? [] : [String(assertion.value)]),
  ];
  const base = parts.join(" ");
  return detail ? `${base} (${detail})` : base;
}

/** All outcomes of a collector's assertions plus the legacy failure string. */
export interface CollectorAssertionEvaluation {
  /** One structured outcome per configured assertion, in config order. */
  outcomes: AssertionOutcome[];
  /**
   * The FIRST failing assertion's message, formatted exactly like the legacy
   * `_assertionFailed` string. Undefined when everything passed.
   */
  firstFailureMessage?: string;
}

/**
 * Evaluate ALL of a collector's assertions - plain field assertions AND
 * JSONPath assertions - against its result, in the order they were
 * configured, returning a structured outcome per assertion (pass AND fail;
 * this is what makes assertions analyzable rather than only visible on
 * failure).
 *
 * Plain assertions compare `result[field]` directly (unchanged behaviour).
 * JSONPath assertions parse the SOURCE field (e.g. `body` for the field
 * `body.$`) as JSON when it is a string, extract `assertion.jsonPath`, and
 * apply the operator to the extracted value. Fail-closed: a missing
 * expression, a non-JSON source value, or an invalid/eval-blocked path fails
 * the assertion (with a diagnostic suffix) - it never fails the collector.
 */
export function evaluateCollectorAssertionOutcomes({
  assertions,
  result,
}: {
  assertions: CollectorAssertion[] | undefined;
  result: Record<string, unknown>;
}): CollectorAssertionEvaluation {
  if (!assertions?.length) return { outcomes: [] };

  // Parse each JSON source field at most once, not once per assertion.
  const parsedSources = new Map<string, { json?: unknown; error?: string }>();
  const parseSource = (sourceField: string) => {
    const cached = parsedSources.get(sourceField);
    if (cached) return cached;

    const raw = result[sourceField];
    let entry: { json?: unknown; error?: string };
    if (raw === undefined || raw === null) {
      entry = { error: `field "${sourceField}" has no value` };
    } else if (typeof raw === "string") {
      try {
        entry = { json: JSON.parse(raw) };
      } catch {
        entry = { error: `field "${sourceField}" is not valid JSON` };
      }
    } else {
      // Already-structured value (object/array/number) - use as-is.
      entry = { json: raw };
    }
    parsedSources.set(sourceField, entry);
    return entry;
  };

  const outcomes: AssertionOutcome[] = [];
  let firstFailureMessage: string | undefined;

  const baseOutcome = (assertion: CollectorAssertion) => ({
    key: computeAssertionKey({ assertion }),
    field: assertion.field,
    jsonPath: assertion.jsonPath?.trim() || undefined,
    operator: assertion.operator,
    value:
      assertion.value === undefined ? undefined : String(assertion.value),
  });

  const recordFailure = ({
    assertion,
    actual,
    message,
    legacyMessage,
  }: {
    assertion: CollectorAssertion;
    actual?: unknown;
    message: string;
    legacyMessage: string;
  }) => {
    outcomes.push({
      ...baseOutcome(assertion),
      passed: false,
      actual: actual === undefined ? undefined : truncateActual({ value: actual }),
      message,
    });
    if (firstFailureMessage === undefined) firstFailureMessage = legacyMessage;
  };

  for (const assertion of assertions) {
    if (!isJsonPathAssertion(assertion)) {
      const evaluated = evaluateAssertion(assertion, result);
      if (evaluated.passed) {
        outcomes.push({
          ...baseOutcome(assertion),
          passed: true,
          actual:
            evaluated.actual === undefined
              ? undefined
              : truncateActual({ value: evaluated.actual }),
        });
      } else {
        recordFailure({
          assertion,
          actual: evaluated.actual,
          message: evaluated.message ?? formatFailure({ assertion }),
          legacyMessage: formatFailure({ assertion }),
        });
      }
      continue;
    }

    const path = assertion.jsonPath?.trim();
    if (!path) {
      recordFailure({
        assertion,
        message: "missing JSONPath expression",
        legacyMessage: formatFailure({
          assertion,
          detail: "missing JSONPath expression",
        }),
      });
      continue;
    }

    const sourceField = assertion.field.endsWith(JSONPATH_FIELD_SUFFIX)
      ? assertion.field.slice(0, -JSONPATH_FIELD_SUFFIX.length)
      : assertion.field;
    const source = parseSource(sourceField);
    if (source.error) {
      recordFailure({
        assertion,
        message: source.error,
        legacyMessage: formatFailure({ assertion, detail: source.error }),
      });
      continue;
    }

    try {
      // Extract once, then reuse the shared operator engine on a synthetic
      // one-field record so the outcome carries the observed value.
      const extracted = extractJsonPath(path, source.json);
      const evaluated = evaluateAssertion(
        {
          field: "__jsonpath__",
          operator: assertion.operator,
          value:
            assertion.value === undefined
              ? undefined
              : String(assertion.value),
        },
        { __jsonpath__: extracted },
      );
      if (evaluated.passed) {
        outcomes.push({
          ...baseOutcome(assertion),
          passed: true,
          actual:
            extracted === undefined
              ? undefined
              : truncateActual({ value: extracted }),
        });
      } else {
        recordFailure({
          assertion,
          actual: extracted,
          message: evaluated.message ?? formatFailure({ assertion }),
          legacyMessage: formatFailure({ assertion }),
        });
      }
    } catch (error) {
      // jsonpath-plus rejects malformed paths and (with eval disabled)
      // filter/script expressions by throwing.
      const detail = `invalid JSONPath: ${extractErrorMessage(error)}`;
      recordFailure({
        assertion,
        message: detail,
        legacyMessage: formatFailure({ assertion, detail }),
      });
    }
  }

  return { outcomes, firstFailureMessage };
}

/**
 * Legacy single-string view of {@link evaluateCollectorAssertionOutcomes}:
 * the failure message of the FIRST failing assertion, or `undefined` when all
 * pass. Kept for callers that only need the `_assertionFailed` string.
 */
export function evaluateCollectorAssertions({
  assertions,
  result,
}: {
  assertions: CollectorAssertion[] | undefined;
  result: Record<string, unknown>;
}): string | undefined {
  return evaluateCollectorAssertionOutcomes({ assertions, result })
    .firstFailureMessage;
}
