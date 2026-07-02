import {
  evaluateAssertions,
  evaluateJsonPathAssertions,
} from "@checkstack/backend-api";
import type { CollectorAssertion } from "@checkstack/healthcheck-common";
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

/**
 * Evaluate a collector's assertions - plain field assertions AND JSONPath
 * assertions - against its result, in the order they were configured.
 *
 * Plain assertions compare `result[field]` directly (unchanged behaviour).
 * JSONPath assertions parse the SOURCE field (e.g. `body` for the field
 * `body.$`) as JSON when it is a string, extract `assertion.jsonPath`, and
 * apply the operator to the extracted value. Fail-closed: a missing
 * expression, a non-JSON source value, or an invalid/eval-blocked path fails
 * the assertion (with a diagnostic suffix) - it never fails the collector.
 *
 * Returns the failure message of the FIRST failing assertion, or `undefined`
 * when all pass.
 */
export function evaluateCollectorAssertions({
  assertions,
  result,
}: {
  assertions: CollectorAssertion[] | undefined;
  result: Record<string, unknown>;
}): string | undefined {
  if (!assertions?.length) return undefined;

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

  for (const assertion of assertions) {
    if (!isJsonPathAssertion(assertion)) {
      const failed = evaluateAssertions([assertion], result);
      if (failed) return formatFailure({ assertion: failed });
      continue;
    }

    const path = assertion.jsonPath?.trim();
    if (!path) {
      return formatFailure({
        assertion,
        detail: "missing JSONPath expression",
      });
    }

    const sourceField = assertion.field.endsWith(JSONPATH_FIELD_SUFFIX)
      ? assertion.field.slice(0, -JSONPATH_FIELD_SUFFIX.length)
      : assertion.field;
    const source = parseSource(sourceField);
    if (source.error) {
      return formatFailure({ assertion, detail: source.error });
    }

    try {
      const failed = evaluateJsonPathAssertions(
        [
          {
            path,
            operator: assertion.operator,
            value:
              assertion.value === undefined
                ? undefined
                : String(assertion.value),
          },
        ],
        source.json,
        extractJsonPath,
      );
      if (failed) return formatFailure({ assertion });
    } catch (error) {
      // jsonpath-plus rejects malformed paths and (with eval disabled)
      // filter/script expressions by throwing.
      return formatFailure({
        assertion,
        detail: `invalid JSONPath: ${extractErrorMessage(error)}`,
      });
    }
  }

  return undefined;
}
