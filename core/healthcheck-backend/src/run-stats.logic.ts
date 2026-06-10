import {
  countStatuses,
  calculateLatencyStats,
  extractLatencies,
} from "./aggregation-utils";

/**
 * Pure summarizer behind the `healthcheck.runStats` AI tool. Turns raw runs in a
 * window into a COMPACT report — window totals + a small, capped time series of
 * buckets — so the assistant can answer "how often / how much downtime / uptime
 * over the last N days" without pulling thousands of rows into its context.
 *
 * Bucketing is uniform over [startDate, endDate): the window is split into at
 * most `maxBuckets` equal intervals; each run lands in `floor((t - start) /
 * interval)`. Buckets with no runs are omitted (the model reads the bucket's
 * own `start`/`end`, so gaps are unambiguous and we don't pad the context with
 * empty rows). Deterministic and DB-free, so it is unit-tested directly.
 */

/** One input run (only the fields stats need). */
export interface StatRun {
  timestamp: Date;
  status: string;
  latencyMs?: number;
}

export interface RunStatsBucket {
  start: string;
  end: string;
  runCount: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  /** Percent of runs that were healthy, 0-100, rounded to 1 decimal. */
  uptimePct: number;
  avgLatencyMs?: number;
  p95LatencyMs?: number;
}

export interface RunStatsTotal {
  runCount: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  uptimePct: number;
  avgLatencyMs?: number;
  minLatencyMs?: number;
  maxLatencyMs?: number;
  p95LatencyMs?: number;
}

export interface RunStats {
  window: { start: string; end: string };
  bucketIntervalSeconds: number;
  total: RunStatsTotal;
  buckets: RunStatsBucket[];
}

/** Healthy / (total) as a 0-100 percentage, 1 decimal. 0 runs -> 0. */
function uptimePct({
  healthy,
  runCount,
}: {
  healthy: number;
  runCount: number;
}): number {
  if (runCount === 0) return 0;
  return Math.round((healthy / runCount) * 1000) / 10;
}

export function summarizeRuns({
  runs,
  startDate,
  endDate,
  maxBuckets,
}: {
  runs: StatRun[];
  startDate: Date;
  endDate: Date;
  maxBuckets: number;
}): RunStats {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const rangeMs = Math.max(1, endMs - startMs);
  const buckets = Math.max(1, Math.min(maxBuckets, Math.ceil(maxBuckets)));
  // At least 1s per bucket; never more buckets than the range allows.
  const intervalMs = Math.max(1000, Math.ceil(rangeMs / buckets));

  // Window totals (over ALL runs, so p95 is exact, not derived from buckets).
  const totalCounts = countStatuses(runs);
  const totalLatency = calculateLatencyStats(extractLatencies(runs));
  const total: RunStatsTotal = {
    runCount: runs.length,
    healthy: totalCounts.healthyCount,
    degraded: totalCounts.degradedCount,
    unhealthy: totalCounts.unhealthyCount,
    uptimePct: uptimePct({ healthy: totalCounts.healthyCount, runCount: runs.length }),
    avgLatencyMs: totalLatency.avgLatencyMs,
    minLatencyMs: totalLatency.minLatencyMs,
    maxLatencyMs: totalLatency.maxLatencyMs,
    p95LatencyMs: totalLatency.p95LatencyMs,
  };

  // Group runs into bucket indices.
  const byBucket = new Map<number, StatRun[]>();
  for (const run of runs) {
    const offset = run.timestamp.getTime() - startMs;
    if (offset < 0 || offset > rangeMs) continue; // outside the window
    const idx = Math.min(buckets - 1, Math.floor(offset / intervalMs));
    const list = byBucket.get(idx) ?? [];
    list.push(run);
    byBucket.set(idx, list);
  }

  const bucketRows: RunStatsBucket[] = [...byBucket.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([idx, bucketRuns]) => {
      const counts = countStatuses(bucketRuns);
      const latency = calculateLatencyStats(extractLatencies(bucketRuns));
      const bStartMs = startMs + idx * intervalMs;
      const bEndMs = Math.min(endMs, bStartMs + intervalMs);
      return {
        start: new Date(bStartMs).toISOString(),
        end: new Date(bEndMs).toISOString(),
        runCount: bucketRuns.length,
        healthy: counts.healthyCount,
        degraded: counts.degradedCount,
        unhealthy: counts.unhealthyCount,
        uptimePct: uptimePct({
          healthy: counts.healthyCount,
          runCount: bucketRuns.length,
        }),
        ...(latency.avgLatencyMs === undefined
          ? {}
          : { avgLatencyMs: latency.avgLatencyMs }),
        ...(latency.p95LatencyMs === undefined
          ? {}
          : { p95LatencyMs: latency.p95LatencyMs }),
      };
    });

  return {
    window: { start: startDate.toISOString(), end: endDate.toISOString() },
    bucketIntervalSeconds: Math.round(intervalMs / 1000),
    total,
    buckets: bucketRows,
  };
}
