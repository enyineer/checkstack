/**
 * Pure display logic for assertion outcomes: the shared operator labels (the
 * AssertionBuilder dropdowns build on the same map, so authoring and analysis
 * always agree) and the row models the run-detail Assertions tab and the
 * drawer's assertion tiles render (see `assertion-display.logic.test.ts`).
 */

import {
  AssertionOutcomeSchema,
  parseAssertionKey,
  type AssertionKeyParts,
  type AssertionOutcome,
} from "@checkstack/healthcheck-common";

/** Human label per assertion operator, shared with the AssertionBuilder. */
export const OPERATOR_LABELS: Record<string, string> = {
  equals: "Equals",
  notEquals: "Not Equals",
  contains: "Contains",
  startsWith: "Starts With",
  endsWith: "Ends With",
  matches: "Matches (Regex)",
  isEmpty: "Is Empty",
  isNotEmpty: "Is Not Empty",
  lessThan: "Less Than",
  lessThanOrEqual: "Less Than or Equal",
  greaterThan: "Greater Than",
  greaterThanOrEqual: "Greater Than or Equal",
  isTrue: "Is True",
  isFalse: "Is False",
  includes: "Includes",
  notIncludes: "Not Includes",
  lengthEquals: "Length Equals",
  lengthGreaterThan: "Length Greater Than",
  lengthLessThan: "Length Less Than",
  exists: "Exists",
  notExists: "Not Exists",
};

/**
 * Sentence-INFIX operator labels for the AssertionBuilder's "must …" rows
 * ("Status Code must **be less than** 500"). Kept beside `OPERATOR_LABELS`
 * so the builder's phrasing and the run-detail Assertions view evolve
 * together - a parity test asserts both maps cover the same operators.
 * Boolean operators get field-specific phrasing in the builder (the
 * collector's `x-chart-true-label`/`x-chart-false-label`); these entries are
 * the fallback.
 */
export const OPERATOR_SENTENCE_LABELS: Record<string, string> = {
  equals: "equal",
  notEquals: "not equal",
  contains: "contain",
  startsWith: "start with",
  endsWith: "end with",
  matches: "match pattern",
  isEmpty: "be empty",
  isNotEmpty: "not be empty",
  lessThan: "be less than",
  lessThanOrEqual: "be at most",
  greaterThan: "be greater than",
  greaterThanOrEqual: "be at least",
  isTrue: "be true",
  isFalse: "be false",
  includes: "include",
  notIncludes: "not include",
  lengthEquals: "have length",
  lengthGreaterThan: "have more entries than",
  lengthLessThan: "have fewer entries than",
  exists: "be present",
  notExists: "be absent",
};

/** Sentence-case operator for inline labels ("statusCode equals 200"). */
export function operatorSentence({ operator }: { operator: string }): string {
  const label = OPERATOR_LABELS[operator];
  if (label === undefined) return operator;
  return label.replace(" (Regex)", "").toLowerCase();
}

/**
 * One-line human identity of an assertion, e.g. `statusCode equals 200` or
 * `body.$ $.status equals ok`. Used as tile labels and row headings.
 */
export function formatAssertionLabel({
  parts,
}: {
  parts: Pick<AssertionKeyParts, "field" | "jsonPath" | "operator" | "value">;
}): string {
  const segments = [
    parts.field,
    ...(parts.jsonPath === undefined ? [] : [parts.jsonPath]),
    operatorSentence({ operator: parts.operator }),
    ...(parts.value === undefined ? [] : [parts.value]),
  ];
  return segments.join(" ");
}

/** Label an assertion series by its canonical key (historical series too). */
export function labelForAssertionKey({ key }: { key: string }): string {
  const parts = parseAssertionKey({ key });
  return parts === undefined ? key : formatAssertionLabel({ parts });
}

/** One row of the run-detail Assertions view. */
export interface AssertionRowModel {
  /** Stable render key. */
  id: string;
  /** e.g. `statusCode equals 200`. */
  label: string;
  passed: boolean;
  expected?: string;
  actual?: string;
  /** Failure detail (diagnostics, expected/got sentences). */
  message?: string;
  /** True for the pre-feature fallback row built from `_assertionFailed`. */
  legacy: boolean;
}

/**
 * Build the assertion rows for one collector entry of a run result. Prefers
 * the structured `_assertions` outcomes; runs recorded before the feature
 * fall back to a single failed row carrying the raw `_assertionFailed`
 * string. Returns an empty array when the entry has no assertion info.
 */
export function buildAssertionRows({
  collectorEntry,
}: {
  collectorEntry: Record<string, unknown>;
}): AssertionRowModel[] {
  const rawOutcomes = collectorEntry._assertions;
  if (Array.isArray(rawOutcomes) && rawOutcomes.length > 0) {
    const rows: AssertionRowModel[] = [];
    for (const [index, raw] of rawOutcomes.entries()) {
      const parsed = AssertionOutcomeSchema.safeParse(raw);
      if (!parsed.success) continue;
      const outcome: AssertionOutcome = parsed.data;
      rows.push({
        id: `${outcome.key}-${index}`,
        label: formatAssertionLabel({ parts: outcome }),
        passed: outcome.passed,
        expected: outcome.value,
        actual: outcome.actual,
        message: outcome.message,
        legacy: false,
      });
    }
    return rows;
  }

  const legacyFailure = collectorEntry._assertionFailed;
  if (typeof legacyFailure === "string" && legacyFailure.length > 0) {
    return [
      {
        id: "legacy-failure",
        label: legacyFailure,
        passed: false,
        legacy: true,
      },
    ];
  }

  return [];
}

/** Per-collector grouping of assertion rows for a run's result. */
export interface AssertionGroup {
  collectorEntryId: string;
  collectorId?: string;
  rows: AssertionRowModel[];
  failCount: number;
}

/** Build all assertion groups for a run result's `metadata.collectors`. */
export function buildAssertionGroups({
  result,
}: {
  result: Record<string, unknown> | undefined;
}): AssertionGroup[] {
  const metadata = result?.metadata as Record<string, unknown> | undefined;
  const collectors = metadata?.collectors as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!collectors) return [];

  const groups: AssertionGroup[] = [];
  for (const [entryId, entry] of Object.entries(collectors)) {
    if (!entry || typeof entry !== "object") continue;
    const rows = buildAssertionRows({ collectorEntry: entry });
    if (rows.length === 0) continue;
    groups.push({
      collectorEntryId: entryId,
      collectorId:
        typeof entry._collectorId === "string" ? entry._collectorId : undefined,
      rows,
      failCount: rows.filter((row) => !row.passed).length,
    });
  }
  return groups;
}
