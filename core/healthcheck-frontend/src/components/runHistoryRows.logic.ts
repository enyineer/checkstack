/**
 * Pure row-model logic for the run-history master list: merges raw runs with
 * the retention divider and pre-cutoff aggregate buckets into one ordered row
 * list (see `runHistoryRows.logic.test.ts`).
 *
 * Raw runs older than the configured `rawRetentionDays` no longer exist — only
 * hourly/daily aggregates do. Instead of an unexplained empty list when the
 * user pages into the past, the list ends (on its LAST page) with an explicit
 * "Aggregated before <date>" divider followed by the aggregate buckets.
 */

import type { AggregatedBucket } from "@checkstack/healthcheck-common";

/** One row of the run-history master list. */
export type RunHistoryRow<TRun> =
  | { kind: "run"; run: TRun }
  | { kind: "retentionDivider"; cutoff: Date }
  | { kind: "aggregate"; bucket: AggregatedBucket };

/** The instant before which raw runs have been aggregated away. */
export function rawRetentionCutoff({
  rawRetentionDays,
  now,
}: {
  rawRetentionDays: number;
  now: Date;
}): Date {
  return new Date(now.getTime() - rawRetentionDays * 86_400_000);
}

/** Whether the pagination is on its last raw page (or has no raw pages). */
export function isLastRawPage({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}): boolean {
  return totalPages === 0 || page >= totalPages;
}

/**
 * Whether the aggregate query should run at all: only when the selected range
 * reaches past the retention cutoff AND the list is on its last raw page
 * (aggregate rows are appended after the newest-to-oldest raw runs).
 */
export function shouldQueryAggregates({
  rangeStart,
  cutoff,
  page,
  totalPages,
}: {
  rangeStart: Date;
  cutoff: Date;
  page: number;
  totalPages: number;
}): boolean {
  return (
    rangeStart.getTime() < cutoff.getTime() && isLastRawPage({ page, totalPages })
  );
}

/**
 * Build the ordered row list: raw runs first (as given, newest first), then —
 * on the last raw page only — the retention divider and the pre-cutoff
 * aggregate buckets, newest first. Buckets overlapping or after the cutoff are
 * dropped (their span is still covered by raw runs).
 */
export function buildRunHistoryRows<TRun>({
  runs,
  buckets,
  cutoff,
  isLastPage,
}: {
  runs: ReadonlyArray<TRun>;
  buckets: ReadonlyArray<AggregatedBucket>;
  cutoff: Date;
  isLastPage: boolean;
}): RunHistoryRow<TRun>[] {
  const rows: RunHistoryRow<TRun>[] = runs.map((run) => ({
    kind: "run",
    run,
  }));

  if (!isLastPage) return rows;

  const aggregates = buckets
    .filter((b) => new Date(b.bucketEnd).getTime() <= cutoff.getTime())
    .toSorted(
      (a, b) =>
        new Date(b.bucketStart).getTime() - new Date(a.bucketStart).getTime(),
    );
  if (aggregates.length === 0) return rows;

  rows.push({ kind: "retentionDivider", cutoff });
  for (const bucket of aggregates) {
    rows.push({ kind: "aggregate", bucket });
  }
  return rows;
}
