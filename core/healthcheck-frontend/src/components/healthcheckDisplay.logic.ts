/**
 * Pure, DOM-free display helpers for the healthcheck frontend's premium
 * surfaces (system overview, config list, run history, detail drawer).
 *
 * These derive the colorblind-safe status-triad tone and the small numeric
 * figures the cards lead with, kept here so the branch logic can be
 * unit-tested without rendering React or importing `@checkstack/ui`.
 */

import type { HealthCheckStatus } from "@checkstack/healthcheck-common";
import type { StackedBucket } from "@checkstack/ui";

/** The colorblind-safe status-triad stem a check status maps onto. */
export type StatusTone = "ok" | "warn" | "down" | "unknown";

/**
 * Map a health-check run status to its status-triad tone. The triad is the
 * single source of color across every healthcheck surface: `healthy` reads
 * `ok`, `degraded` reads `warn`, `unhealthy` reads `down`.
 */
export function statusToTone({
  status,
}: {
  status: HealthCheckStatus;
}): StatusTone {
  switch (status) {
    case "healthy": {
      return "ok";
    }
    case "degraded": {
      return "warn";
    }
    case "unhealthy": {
      return "down";
    }
    default: {
      return "unknown";
    }
  }
}

/** Human label for a health-check status, used by the leading status pills. */
export function statusToLabel({
  status,
}: {
  status: HealthCheckStatus;
}): string {
  switch (status) {
    case "healthy": {
      return "Healthy";
    }
    case "degraded": {
      return "Degraded";
    }
    case "unhealthy": {
      return "Unhealthy";
    }
    default: {
      return "Unknown";
    }
  }
}

/**
 * Tone for a configuration's run state on the config list: an active check
 * reads `ok`, a paused one reads `unknown` (dormant, not failing).
 */
export function pausedToTone({ paused }: { paused: boolean }): StatusTone {
  return paused ? "unknown" : "ok";
}

/**
 * Count of healthy entries in a recent-status history. Used to lead the
 * system-overview row with an "N/M healthy" figure.
 */
export function countHealthy({
  history,
}: {
  history: HealthCheckStatus[];
}): number {
  return history.filter((status) => status === "healthy").length;
}

/** A timeline bucket's per-status run tallies (the chart's source counts). */
export interface BucketCounts {
  healthyCount: number;
  runCount: number;
  avgLatencyMs?: number;
}

/**
 * Healthy percentage across the already-loaded timeline buckets, rounded to a
 * whole number for the drawer's hero figure. The percentage is healthy runs
 * over total runs (`runCount`), so empty windows contribute nothing and do not
 * dilute the figure. Returns `null` when there is nothing to measure.
 */
export function bucketHealthyPercent({
  buckets,
}: {
  buckets: BucketCounts[];
}): number | null {
  let total = 0;
  let healthy = 0;
  for (const bucket of buckets) {
    total += bucket.runCount;
    healthy += bucket.healthyCount;
  }
  if (total === 0) return null;
  return Math.round((healthy / total) * 100);
}

/**
 * Run-weighted average execution duration (ms) across the loaded buckets,
 * rounded to a whole millisecond for the latency panel's hero figure. Buckets
 * without a recorded `avgLatencyMs` (no measured runs) contribute nothing.
 * Returns `null` when no bucket carries a latency.
 */
export function bucketAvgLatencyMs({
  buckets,
}: {
  buckets: BucketCounts[];
}): number | null {
  let weighted = 0;
  let total = 0;
  for (const bucket of buckets) {
    if (bucket.avgLatencyMs === undefined) continue;
    const runs = bucket.runCount > 0 ? bucket.runCount : 1;
    weighted += bucket.avgLatencyMs * runs;
    total += runs;
  }
  if (total === 0) return null;
  return Math.round(weighted / total);
}

/** A timeline bucket's full per-status tallies plus its time span. */
export interface TimelineBucket {
  bucketStart: string | Date;
  bucketEnd: string | Date;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
}

/**
 * Map aggregated healthcheck buckets onto the chart kit's stacked-timeline
 * shape: healthy → ok, degraded → warn, unhealthy → down, with millisecond
 * epoch bucket bounds.
 */
export function bucketsToStacked({
  buckets,
}: {
  buckets: TimelineBucket[];
}): StackedBucket[] {
  return buckets.map((bucket) => ({
    start: new Date(bucket.bucketStart).getTime(),
    end: new Date(bucket.bucketEnd).getTime(),
    counts: {
      ok: bucket.healthyCount,
      warn: bucket.degradedCount,
      down: bucket.unhealthyCount,
    },
  }));
}

/**
 * Per-tone class sets for the status pill, its dot, and a card's left accent
 * stripe. Spelled out as full literal strings (not interpolated) so Tailwind's
 * JIT keeps them, driven by the colorblind-safe status triad.
 */
export const toneStyles: Record<
  StatusTone,
  { pill: string; dot: string; accent: string }
> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
  },
  down: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
  },
  unknown: {
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
    accent: "bg-status-unknown",
  },
};
