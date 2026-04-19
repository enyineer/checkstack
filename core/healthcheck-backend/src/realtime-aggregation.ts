import type { SafeDatabase, CollectorRegistry } from "@checkstack/backend-api";
import { TDigest } from "tdigest";
import * as schema from "./schema";
import { healthCheckAggregates } from "./schema";
import { eq, and, sql } from "drizzle-orm";

type Db = SafeDatabase<typeof schema>;

/**
 * Get the hour bucket start time for a given timestamp.
 * Floors the timestamp to the nearest hour.
 */
export function getHourBucketStart(timestamp: Date): Date {
  const bucketStart = new Date(timestamp);
  bucketStart.setMinutes(0, 0, 0);
  return bucketStart;
}

/**
 * Serialize a t-digest to an array of numbers for storage.
 * Format: [centroid1_mean, centroid1_n, centroid2_mean, centroid2_n, ...]
 */
export function serializeTDigest(digest: TDigest): number[] {
  const centroids = digest.toArray();
  const result: number[] = [];
  for (const c of centroids) {
    result.push(c.mean, c.n);
  }
  return result;
}

/**
 * Deserialize a t-digest from storage format.
 */
export function deserializeTDigest(state: number[]): TDigest {
  const digest = new TDigest();

  if (state.length === 0) {
    return digest;
  }

  // Reconstruct centroids from pairs of [mean, n]
  const centroids: Array<{ mean: number; n: number }> = [];
  for (let i = 0; i < state.length; i += 2) {
    const mean = state[i];
    const n = state[i + 1];
    if (mean !== undefined && n !== undefined && n > 0) {
      centroids.push({ mean, n });
    }
  }

  if (centroids.length > 0) {
    digest.push_centroid(centroids);
  }

  return digest;
}

interface IncrementHourlyAggregateParams {
  db: Db;
  systemId: string;
  configurationId: string;
  status: "healthy" | "unhealthy" | "degraded";
  latencyMs: number | undefined;
  runTimestamp: Date;
  /** Result from the health check run, containing collector metadata */
  result?: Record<string, unknown>;
  /** Collector registry for aggregating collector data via mergeResult */
  collectorRegistry?: CollectorRegistry;
  /** Source identifier: undefined = local core, string = satellite ID */
  sourceId?: string;
  /** Human-readable source label for display */
  sourceLabel?: string;
}

/**
 * Incrementally updates the current hour's aggregate with a new run.
 * Uses INSERT ... ON CONFLICT DO UPDATE to atomically update counts.
 *
 * This enables real-time aggregation without waiting for the hour to complete,
 * ensuring availability stats and collector metadata are always up-to-date.
 */
export async function incrementHourlyAggregate(
  params: IncrementHourlyAggregateParams,
): Promise<void> {
  const {
    db,
    systemId,
    configurationId,
    status,
    latencyMs,
    runTimestamp,
    result,
    collectorRegistry,
    sourceId,
    sourceLabel,
  } = params;

  const bucketStart = getHourBucketStart(runTimestamp);

  // First, try to fetch existing aggregate to merge t-digest state and collector data
  const [existing] = await db
    .select({
      tdigestState: healthCheckAggregates.tdigestState,
      minLatencyMs: healthCheckAggregates.minLatencyMs,
      maxLatencyMs: healthCheckAggregates.maxLatencyMs,
      aggregatedResult: healthCheckAggregates.aggregatedResult,
    })
    .from(healthCheckAggregates)
    .where(
      and(
        eq(healthCheckAggregates.systemId, systemId),
        eq(healthCheckAggregates.configurationId, configurationId),
        eq(healthCheckAggregates.bucketStart, bucketStart),
        eq(healthCheckAggregates.bucketSize, "hourly"),
        sourceId
          ? eq(healthCheckAggregates.sourceId, sourceId)
          : sql`${healthCheckAggregates.sourceId} IS NULL`,
      ),
    )
    .limit(1);

  // Calculate status increments
  const healthyIncrement = status === "healthy" ? 1 : 0;
  const degradedIncrement = status === "degraded" ? 1 : 0;
  const unhealthyIncrement = status === "unhealthy" ? 1 : 0;

  // Calculate latency values if latencyMs is defined
  const latencyUpdate =
    latencyMs === undefined
      ? undefined
      : (() => {
          const latencySumIncr = latencyMs;

          // Calculate min/max
          let min: number;
          let max: number;
          if (existing) {
            min =
              existing.minLatencyMs === null
                ? latencyMs
                : Math.min(existing.minLatencyMs, latencyMs);
            max =
              existing.maxLatencyMs === null
                ? latencyMs
                : Math.max(existing.maxLatencyMs, latencyMs);
          } else {
            min = latencyMs;
            max = latencyMs;
          }

          // Update t-digest for p95 calculation
          const digest =
            existing?.tdigestState && existing.tdigestState.length > 0
              ? deserializeTDigest(existing.tdigestState)
              : new TDigest();

          digest.push(latencyMs);
          const tdigestState = serializeTDigest(digest);
          const p95 = Math.round(digest.percentile(0.95));

          return { latencySumIncr, min, max, tdigestState, p95 };
        })();

  // Build aggregatedResult by incrementally merging collector data
  const aggregatedResult = mergeCollectorResults({
    existingResult: existing?.aggregatedResult,
    status,
    latencyMs,
    result,
    collectorRegistry,
  });

  // Upsert the aggregate
  await db
    .insert(healthCheckAggregates)
    .values({
      configurationId,
      systemId,
      bucketStart,
      bucketSize: "hourly",
      runCount: 1,
      healthyCount: healthyIncrement,
      degradedCount: degradedIncrement,
      unhealthyCount: unhealthyIncrement,
      latencySumMs: latencyMs,
      avgLatencyMs: latencyMs,
      minLatencyMs: latencyUpdate?.min,
      maxLatencyMs: latencyUpdate?.max,
      p95LatencyMs: latencyUpdate?.p95,
      tdigestState: latencyUpdate?.tdigestState,
      aggregatedResult,
      sourceId: sourceId ?? undefined,
      sourceLabel: sourceLabel ?? undefined,
    })
    .onConflictDoUpdate({
      target: [
        healthCheckAggregates.configurationId,
        healthCheckAggregates.systemId,
        healthCheckAggregates.bucketStart,
        healthCheckAggregates.bucketSize,
        healthCheckAggregates.sourceId,
      ],
      set: {
        runCount: sql`${healthCheckAggregates.runCount} + 1`,
        healthyCount: sql`${healthCheckAggregates.healthyCount} + ${healthyIncrement}`,
        degradedCount: sql`${healthCheckAggregates.degradedCount} + ${degradedIncrement}`,
        unhealthyCount: sql`${healthCheckAggregates.unhealthyCount} + ${unhealthyIncrement}`,
        // Only update latency fields if we have latency data
        ...(latencyUpdate === undefined
          ? {}
          : {
              latencySumMs: sql`COALESCE(${healthCheckAggregates.latencySumMs}, 0) + ${latencyUpdate.latencySumIncr}`,
              avgLatencyMs: sql`(COALESCE(${healthCheckAggregates.latencySumMs}, 0) + ${latencyUpdate.latencySumIncr}) / (${healthCheckAggregates.runCount} + 1)`,
              minLatencyMs: latencyUpdate.min,
              maxLatencyMs: latencyUpdate.max,
              p95LatencyMs: latencyUpdate.p95,
              tdigestState: latencyUpdate.tdigestState,
            }),
        // Update aggregatedResult with merged collector data
        ...(aggregatedResult ? { aggregatedResult } : {}),
      },
    });
}

/**
 * Incrementally merge collector results using each collector's mergeResult function.
 * This avoids storing raw data and computes incremental aggregates.
 */
function mergeCollectorResults(params: {
  existingResult: Record<string, unknown> | null;
  status: "healthy" | "unhealthy" | "degraded";
  latencyMs: number | undefined;
  result: Record<string, unknown> | undefined;
  collectorRegistry: CollectorRegistry | undefined;
}): Record<string, unknown> | undefined {
  const { existingResult, status, latencyMs, result, collectorRegistry } =
    params;

  // Extract collectors from run result
  const metadata = result?.metadata as
    | { collectors?: Record<string, Record<string, unknown>> }
    | undefined;
  const runCollectors = metadata?.collectors;

  // If no collector data in this run and no existing data, return undefined
  if (!runCollectors && !existingResult) {
    return undefined;
  }

  // If no collector registry, can't merge - just keep existing
  if (!collectorRegistry) {
    return existingResult ?? undefined;
  }

  // Start with existing collectors or empty object
  const existingCollectors = (existingResult?.collectors ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const mergedCollectors: Record<string, Record<string, unknown>> = {
    ...existingCollectors,
  };

  // Merge each collector from this run
  if (runCollectors) {
    for (const [uuid, collectorData] of Object.entries(runCollectors)) {
      const collectorId = collectorData._collectorId as string | undefined;
      if (!collectorId) continue;

      const registered = collectorRegistry.getCollector(collectorId);
      if (!registered?.collector.mergeResult) continue;

      // Get existing aggregate for this collector UUID
      const existingAggregate = existingCollectors[uuid];

      // Strip internal fields from collector data for the run
      const { _collectorId, _assertionFailed, ...collectorMetadata } =
        collectorData;

      // Call the collector's mergeResult
      const newRun = {
        status,
        latencyMs,
        metadata: collectorMetadata,
      };

      const merged = registered.collector.mergeResult(
        existingAggregate as Record<string, unknown> | undefined,
        newRun,
      );

      mergedCollectors[uuid] = {
        _collectorId: collectorId,
        ...merged,
      };
    }
  }

  return { collectors: mergedCollectors };
}
