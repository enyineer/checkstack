/**
 * Pure time-bucketing, chunking, grain-selection and retention-cutoff helpers
 * shared by the storage write/read paths and the maintenance jobs. No IO;
 * unit-tested. Mirrors metricstream/logstream's `storage/time.ts` conventions.
 */

import type { BucketGrain, TraceStreamConfig } from "@checkstack/tracestream-common";

/** Floor a timestamp to the start of its minute (UTC-safe; operates on epoch). */
export function floorToMinute(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 60_000) * 60_000);
}

/** Floor a timestamp to the start of its hour. */
export function floorToHour(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);
}

/** Split an array into chunks of at most `size` (size >= 1). */
export function chunk<T>({ items, size }: { items: T[]; size: number }): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Max rows per multi-row insert/upsert statement (bounds statement size). */
export const STORAGE_CHUNK_SIZE = 500;

/** Max rows deleted/rolled per bounded batch (keeps a delete/rollup from locking long). */
export const RETENTION_DELETE_BATCH = 5000;

/** How many distinct op buckets to roll up per transaction. */
export const ROLLUP_BUCKET_BATCH = 500;

/**
 * The rollup boundary: op minute buckets younger than this are still
 * fine-grained (not yet rolled up to hourly), so a read that wants recent
 * detail hits the minute tier and a read older than this hits the hourly tier.
 */
export function rollupBoundary({
  now,
  minuteRetentionHours,
}: {
  now: Date;
  minuteRetentionHours: number;
}): Date {
  return new Date(now.getTime() - minuteRetentionHours * 3_600_000);
}

/**
 * Auto-pick the bucket grain for a `[from, to)` op-bucket read: MINUTE when the
 * whole requested window lies within the minute-retention boundary (so
 * fine-grained minute rows still exist for it), otherwise HOUR. This mirrors the
 * log/metric tiering rule (recent + inside the boundary => fine tier); a window
 * reaching older than `minuteRetentionHours` reads the coarse hourly tier that
 * outlives the minute rows. Pure.
 */
export function pickGrain({
  from,
  now,
  minuteRetentionHours,
}: {
  from: Date;
  now: Date;
  minuteRetentionHours: number;
}): BucketGrain {
  const boundary = rollupBoundary({ now, minuteRetentionHours });
  return from >= boundary ? "minute" : "hour";
}

/**
 * Time cutoffs (exclusive upper bounds) derived from a stream's tiered
 * retention policy. Used by the hot-sweep / rollup / cleanup jobs.
 */
export interface RetentionCutoffs {
  /** In-flight assembly older than this is force-completable (hot window). */
  hotCutoff: Date;
  /** Raw spans of UNRETAINED traces older than this are swept (hotRetentionHours). */
  unretainedSpanCutoff: Date;
  /** Raw spans of RETAINED traces older than this are deleted (retainedTraceRetentionDays). */
  retainedSpanCutoff: Date;
  /** Summaries older than this are deleted (summaryRetentionDays). */
  summaryCutoff: Date;
  /** Op minute buckets older than this are rolled up to hourly, then deleted. */
  minuteCutoff: Date;
  /** Op hourly buckets older than this are deleted (hourlyRetentionDays). */
  hourlyCutoff: Date;
}

/** Compute every retention cutoff from a stream's config. Pure. */
export function computeRetentionCutoffs({
  config,
  now,
}: {
  config: TraceStreamConfig;
  now: Date;
}): RetentionCutoffs {
  const ms = now.getTime();
  return {
    hotCutoff: new Date(ms - config.hotRetentionHours * 3_600_000),
    unretainedSpanCutoff: new Date(ms - config.hotRetentionHours * 3_600_000),
    retainedSpanCutoff: new Date(
      ms - config.retainedTraceRetentionDays * 86_400_000,
    ),
    summaryCutoff: new Date(ms - config.summaryRetentionDays * 86_400_000),
    minuteCutoff: new Date(ms - config.minuteRetentionHours * 3_600_000),
    hourlyCutoff: new Date(ms - config.hourlyRetentionDays * 86_400_000),
  };
}
