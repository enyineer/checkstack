/**
 * Assertion analytics contract: the structured per-assertion outcomes stored
 * on each run (`_assertions` inside a collector's result entry) and the
 * per-bucket pass/fail counts stored under the platform-owned `assertions`
 * key of an aggregate's `aggregatedResult`.
 *
 * The assertion KEY is its semantic identity: a canonical JSON tuple of
 * `[field, jsonPath, operator, value]`. Editing any of those starts a NEW
 * series (the old one stops accruing); two identical assertions collapse into
 * one series. The key is parseable back into its parts, so historical series
 * stay displayable even after the configuring assertion was edited away.
 */

import { z } from "zod";

/**
 * Top-level key inside `aggregatedResult` that carries the per-assertion
 * stats. A SIBLING of `collectors`, not nested inside it, so the strategy /
 * collector aggregated-state mergers never see (and can never mangle) it.
 */
export const ASSERTIONS_AGG_KEY = "assertions";

/** Cap on the stored stringified actual value of an assertion outcome. */
export const ASSERTION_ACTUAL_MAX_LENGTH = 200;

/** One assertion's evaluated outcome on a single run. */
export const AssertionOutcomeSchema = z.object({
  /** Canonical identity key (see `computeAssertionKey`). */
  key: z.string(),
  field: z.string(),
  jsonPath: z.string().optional(),
  operator: z.string(),
  /** Expected value as a string (absent for value-less operators). */
  value: z.string().optional(),
  passed: z.boolean(),
  /** Observed value, stringified and truncated (absent when unavailable). */
  actual: z.string().optional(),
  /** Human-readable failure detail (absent when passed). */
  message: z.string().optional(),
});

export type AssertionOutcome = z.infer<typeof AssertionOutcomeSchema>;

/** Pass/fail tallies for one assertion series within one bucket. */
export const AssertionCountsSchema = z.object({
  passCount: z.number().int().min(0),
  failCount: z.number().int().min(0),
});

export type AssertionCounts = z.infer<typeof AssertionCountsSchema>;

/**
 * Per-bucket assertion stats: collector entry uuid -> assertion key ->
 * counts. Stored under `aggregatedResult[ASSERTIONS_AGG_KEY]`.
 */
export const BucketAssertionStatsSchema = z.record(
  z.string(),
  z.record(z.string(), AssertionCountsSchema),
);

export type BucketAssertionStats = z.infer<typeof BucketAssertionStatsSchema>;

/** The identity parts an assertion key encodes. */
export interface AssertionKeyParts {
  field: string;
  jsonPath?: string;
  operator: string;
  value?: string;
}

const keyTupleSchema = z.tuple([
  z.string(),
  z.string().nullable(),
  z.string(),
  z.string().nullable(),
]);

/**
 * Canonical, stable identity for an assertion: a JSON tuple of
 * `[field, jsonPath, operator, value]`. Whitespace-only JSONPaths read as
 * absent; the expected value is stringified the same way the failure
 * formatter does.
 */
export function computeAssertionKey({
  assertion,
}: {
  assertion: {
    field: string;
    jsonPath?: string;
    operator: string;
    value?: unknown;
  };
}): string {
  const path = assertion.jsonPath?.trim();
  return JSON.stringify([
    assertion.field,
    path || null,
    assertion.operator,
    assertion.value === undefined ? null : String(assertion.value),
  ]);
}

/**
 * Parse an assertion key back into its identity parts, for display of
 * historical series whose configuring assertion no longer exists. Returns
 * undefined for malformed keys.
 */
export function parseAssertionKey({
  key,
}: {
  key: string;
}): AssertionKeyParts | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(key);
  } catch {
    return undefined;
  }
  const parsed = keyTupleSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const [field, jsonPath, operator, value] = parsed.data;
  return {
    field,
    jsonPath: jsonPath ?? undefined,
    operator,
    value: value ?? undefined,
  };
}

/** Stringify + truncate an observed value for storage on the run. */
export function truncateActual({ value }: { value: unknown }): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  if (text.length <= ASSERTION_ACTUAL_MAX_LENGTH) return text;
  return `${text.slice(0, ASSERTION_ACTUAL_MAX_LENGTH - 1)}…`;
}

/**
 * Fold one run's outcomes for one collector entry into a stats record.
 * Returns a NEW record; inputs are not mutated.
 */
export function foldOutcomesIntoStats({
  stats,
  collectorEntryId,
  outcomes,
}: {
  stats: BucketAssertionStats | undefined;
  collectorEntryId: string;
  outcomes: ReadonlyArray<AssertionOutcome>;
}): BucketAssertionStats {
  const next: BucketAssertionStats = { ...stats };
  const entry = { ...next[collectorEntryId] };
  for (const outcome of outcomes) {
    const counts = entry[outcome.key] ?? { passCount: 0, failCount: 0 };
    entry[outcome.key] = {
      passCount: counts.passCount + (outcome.passed ? 1 : 0),
      failCount: counts.failCount + (outcome.passed ? 0 : 1),
    };
  }
  next[collectorEntryId] = entry;
  return next;
}

/**
 * Additively merge two stats records (bucket re-merge / daily rollup).
 * Returns a NEW record; inputs are not mutated.
 */
export function mergeAssertionStats({
  a,
  b,
}: {
  a: BucketAssertionStats | undefined;
  b: BucketAssertionStats | undefined;
}): BucketAssertionStats | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const merged: BucketAssertionStats = { ...a };
  for (const [entryId, keyCounts] of Object.entries(b)) {
    const entry = { ...merged[entryId] };
    for (const [key, counts] of Object.entries(keyCounts)) {
      const existing = entry[key] ?? { passCount: 0, failCount: 0 };
      entry[key] = {
        passCount: existing.passCount + counts.passCount,
        failCount: existing.failCount + counts.failCount,
      };
    }
    merged[entryId] = entry;
  }
  return merged;
}

/**
 * Read the assertion stats out of an `aggregatedResult`, validated. Returns
 * undefined when absent or malformed (pre-feature buckets).
 */
export function readAssertionStats({
  aggregatedResult,
}: {
  aggregatedResult: Record<string, unknown> | undefined;
}): BucketAssertionStats | undefined {
  const raw = aggregatedResult?.[ASSERTIONS_AGG_KEY];
  if (raw === undefined) return undefined;
  const parsed = BucketAssertionStatsSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
