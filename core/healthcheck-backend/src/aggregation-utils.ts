import type {
  CollectorRegistry,
  HealthCheckRegistry,
} from "@checkstack/backend-api";

// ===== Percentile Calculation =====

/**
 * Calculate a percentile from a list of values.
 */
export function calculatePercentile(
  values: number[],
  percentile: number,
): number {
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// ===== Status Counting =====

export interface StatusCounts {
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
}

/**
 * Count statuses from a list of runs.
 */
export function countStatuses(
  runs: Array<{ status: "healthy" | "degraded" | "unhealthy" | string }>,
): StatusCounts {
  let healthyCount = 0;
  let degradedCount = 0;
  let unhealthyCount = 0;

  for (const r of runs) {
    switch (r.status) {
      case "healthy": {
        healthyCount++;
        break;
      }
      case "degraded": {
        degradedCount++;
        break;
      }
      case "unhealthy": {
        unhealthyCount++;
        break;
      }
    }
  }

  return { healthyCount, degradedCount, unhealthyCount };
}

// ===== Latency Statistics =====

export interface LatencyStats {
  latencySumMs: number | undefined;
  avgLatencyMs: number | undefined;
  minLatencyMs: number | undefined;
  maxLatencyMs: number | undefined;
  p95LatencyMs: number | undefined;
}

/**
 * Calculate latency statistics from a list of latency values.
 */
export function calculateLatencyStats(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return {
      latencySumMs: undefined,
      avgLatencyMs: undefined,
      minLatencyMs: undefined,
      maxLatencyMs: undefined,
      p95LatencyMs: undefined,
    };
  }

  const sum = latencies.reduce((a, b) => a + b, 0);
  return {
    latencySumMs: sum,
    avgLatencyMs: Math.round(sum / latencies.length),
    minLatencyMs: Math.min(...latencies),
    maxLatencyMs: Math.max(...latencies),
    p95LatencyMs: calculatePercentile(latencies, 95),
  };
}

/**
 * Extract latencies from runs, filtering out undefined values.
 */
export function extractLatencies(
  runs: Array<{ latencyMs?: number }>,
): number[] {
  return runs
    .map((r) => r.latencyMs)
    .filter((l): l is number => l !== undefined);
}

// ===== Collector Aggregation =====

/**
 * Aggregate collector data from runs in a bucket using incremental mergeResult.
 * Groups by collector UUID and calls each collector's mergeResult for each run.
 */
export function aggregateCollectorData(
  runs: Array<{
    status: string;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
  }>,
  collectorRegistry: CollectorRegistry,
): Record<string, unknown> {
  // Track aggregated results by collector UUID
  const aggregatedByUuid = new Map<
    string,
    { collectorId: string; aggregated: Record<string, unknown> }
  >();

  // Process each run incrementally
  for (const run of runs) {
    const collectors = run.metadata?.collectors as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (!collectors) continue;

    for (const [uuid, data] of Object.entries(collectors)) {
      const collectorId = data._collectorId as string | undefined;
      if (!collectorId) continue;

      const registered = collectorRegistry.getCollector(collectorId);
      if (!registered?.collector.mergeResult) continue;

      // Get existing aggregate for this UUID (or undefined for first run)
      const existing = aggregatedByUuid.get(uuid)?.aggregated;

      // Strip internal fields from collector data
      const { _collectorId, _assertionFailed, ...collectorMetadata } = data;

      // Call mergeResult to incrementally aggregate
      const merged = registered.collector.mergeResult(existing, {
        status: run.status as "healthy" | "unhealthy" | "degraded",
        latencyMs: run.latencyMs,
        metadata: collectorMetadata,
      });

      aggregatedByUuid.set(uuid, {
        collectorId,
        aggregated: merged as Record<string, unknown>,
      });
    }
  }

  // Build final result
  const result: Record<string, unknown> = {};
  for (const [uuid, { collectorId, aggregated }] of aggregatedByUuid) {
    result[uuid] = {
      _collectorId: collectorId,
      ...aggregated,
    };
  }

  return result;
}

// ===== Bucket Result Merging =====

/**
 * Merge pre-computed aggregated results from multiple buckets.
 * Uses each collector's VersionedAggregated.mergeAggregatedStates for precise re-aggregation.
 * Also merges strategy-level fields using the strategy's mergeAggregatedStates.
 *
 * @param aggregatedResults - Array of aggregatedResult objects from buckets
 * @param collectorRegistry - Registry to look up collector merge functions
 * @param registry - HealthCheckRegistry for strategy-level merging
 * @param strategyId - Strategy ID for strategy-level merging
 * @returns Merged aggregated result, or undefined if no data
 */
export function mergeAggregatedBucketResults(params: {
  aggregatedResults: Array<Record<string, unknown> | undefined>;
  collectorRegistry: CollectorRegistry;
  registry: HealthCheckRegistry;
  strategyId: string;
}): Record<string, unknown> | undefined {
  const { aggregatedResults, collectorRegistry, registry, strategyId } = params;

  // Filter out undefined results
  const validResults = aggregatedResults.filter(
    (r): r is Record<string, unknown> => r !== undefined,
  );

  if (validResults.length === 0) {
    return undefined;
  }

  // If only one result, return it directly
  if (validResults.length === 1) {
    return validResults[0];
  }

  // === Strategy-level field merging ===
  let mergedStrategyFields: Record<string, unknown> = {};

  const registeredStrategy = registry.getStrategy(strategyId);
  if (registeredStrategy?.aggregatedResult) {
    // Extract strategy-level fields (everything except 'collectors')
    const strategyDataSets: Array<Record<string, unknown>> = [];
    for (const result of validResults) {
      const { collectors: _collectors, ...strategyFields } = result;
      if (Object.keys(strategyFields).length > 0) {
        strategyDataSets.push(strategyFields);
      }
    }

    // Merge strategy-level fields using the strategy's mergeAggregatedStates
    if (strategyDataSets.length > 0) {
      let merged: Record<string, unknown> | undefined;
      for (const data of strategyDataSets) {
        merged =
          merged === undefined
            ? data
            : registeredStrategy.aggregatedResult.mergeAggregatedStates(
                merged,
                data,
              );
      }
      if (merged) {
        mergedStrategyFields = merged;
      }
    }
  } else {
    // Strategy not found - preserve strategy fields from first result
    const { collectors: _collectors, ...firstStrategyFields } = validResults[0];
    mergedStrategyFields = firstStrategyFields;
  }

  // === Collector-level field merging ===

  // Extract collectors from each result
  const allCollectors = validResults.map(
    (r) => (r.collectors ?? {}) as Record<string, Record<string, unknown>>,
  );

  // Find all unique collector UUIDs across all results
  const allUuids = new Set<string>();
  for (const collectors of allCollectors) {
    for (const uuid of Object.keys(collectors)) {
      allUuids.add(uuid);
    }
  }

  // Merge each collector's data
  const mergedCollectors: Record<string, Record<string, unknown>> = {};

  for (const uuid of allUuids) {
    // Collect all data for this UUID
    const dataForUuid: Array<Record<string, unknown>> = [];
    let collectorId: string | undefined;

    for (const collectors of allCollectors) {
      const data = collectors[uuid];
      if (data) {
        collectorId = collectorId ?? (data._collectorId as string);
        dataForUuid.push(data);
      }
    }

    if (!collectorId || dataForUuid.length === 0) {
      continue;
    }

    // Get the collector's merge function
    const registered = collectorRegistry.getCollector(collectorId);
    if (!registered?.collector.aggregatedResult) {
      // Can't merge, preserve first data
      mergedCollectors[uuid] = dataForUuid[0];
      continue;
    }

    // Merge all data using mergeAggregatedStates
    // Strip _collectorId before merging
    let merged: Record<string, unknown> | undefined;
    for (const data of dataForUuid) {
      const { _collectorId, ...stateData } = data;
      merged =
        merged === undefined
          ? stateData
          : registered.collector.aggregatedResult.mergeAggregatedStates(
              merged,
              stateData,
            );
    }

    if (merged) {
      mergedCollectors[uuid] = {
        _collectorId: collectorId,
        ...merged,
      };
    }
  }

  // Combine strategy fields and collector fields
  const hasCollectors = Object.keys(mergedCollectors).length > 0;
  const hasStrategyFields = Object.keys(mergedStrategyFields).length > 0;

  if (!hasCollectors && !hasStrategyFields) {
    return undefined;
  }

  return {
    ...mergedStrategyFields,
    ...(hasCollectors ? { collectors: mergedCollectors } : {}),
  };
}

// ===== Cross-Tier Aggregation =====

/**
 * A normalized bucket that can come from any tier.
 * Used as the common format for merging and re-aggregating.
 */
export interface NormalizedBucket {
  bucketStart: Date;
  bucketEndMs: number; // bucketStart.getTime() + bucket duration in ms
  runCount: number;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  latencySumMs: number | undefined;
  minLatencyMs: number | undefined;
  maxLatencyMs: number | undefined;
  p95LatencyMs: number | undefined;
  aggregatedResult?: Record<string, unknown>;
  sourceTier: "raw" | "hourly" | "daily";
}

/**
 * Priority order for tiers (lower index = higher priority).
 */
const TIER_PRIORITY: Record<NormalizedBucket["sourceTier"], number> = {
  raw: 0,
  hourly: 1,
  daily: 2,
};

/**
 * Merge buckets from different tiers, preferring most granular data.
 * For overlapping time periods, uses priority: raw > hourly > daily.
 *
 * IMPORTANT: Raw buckets always take precedence over hourly/daily aggregates,
 * even when the aggregate bucket starts earlier. This ensures fresh raw data
 * is never blocked by stale pre-computed aggregates.
 */
export function mergeTieredBuckets(params: {
  rawBuckets: NormalizedBucket[];
  hourlyBuckets: NormalizedBucket[];
  dailyBuckets: NormalizedBucket[];
}): NormalizedBucket[] {
  const { rawBuckets, hourlyBuckets, dailyBuckets } = params;

  if (
    rawBuckets.length === 0 &&
    hourlyBuckets.length === 0 &&
    dailyBuckets.length === 0
  ) {
    return [];
  }

  // Two-pass approach:
  // 1. First, collect all time ranges covered by raw data (highest priority)
  // 2. Then, add hourly/daily buckets only for gaps not covered by raw data

  // Build a sorted list of raw bucket time ranges for efficient lookup
  const rawTimeRanges = rawBuckets
    .map((b) => ({
      start: b.bucketStart.getTime(),
      end: b.bucketEndMs,
    }))
    .toSorted((a, b) => a.start - b.start);

  // Merge overlapping raw time ranges into continuous coverage
  const rawCoverage: Array<{ start: number; end: number }> = [];
  for (const range of rawTimeRanges) {
    if (rawCoverage.length === 0) {
      rawCoverage.push({ ...range });
    } else {
      const last = rawCoverage.at(-1)!;
      // If this range overlaps or is adjacent to the last, extend it
      if (range.start <= last.end) {
        last.end = Math.max(last.end, range.end);
      } else {
        rawCoverage.push({ ...range });
      }
    }
  }

  // Helper: check if a bucket has ANY overlap with raw data
  // Two ranges overlap if: start1 < end2 AND start2 < end1
  const doesBucketOverlapWithRaw = (bucket: NormalizedBucket): boolean => {
    const bucketStart = bucket.bucketStart.getTime();
    const bucketEnd = bucket.bucketEndMs;

    for (const range of rawCoverage) {
      // Check for overlap: ranges overlap if they intersect
      if (bucketStart < range.end && range.start < bucketEnd) {
        return true;
      }
      // Optimization: if raw range starts after bucket ends, no more overlaps possible
      if (range.start >= bucketEnd) {
        break;
      }
    }
    return false;
  };

  // Start with all raw buckets (they always take precedence)
  const result: NormalizedBucket[] = [...rawBuckets];

  // Add hourly buckets that don't overlap with raw data
  for (const bucket of hourlyBuckets) {
    if (!doesBucketOverlapWithRaw(bucket)) {
      result.push(bucket);
    }
  }

  // Add daily buckets that don't overlap with raw or hourly data
  // Build hourly coverage to check against
  const hourlyTimeRanges = hourlyBuckets
    .map((b) => ({
      start: b.bucketStart.getTime(),
      end: b.bucketEndMs,
    }))
    .toSorted((a, b) => a.start - b.start);

  // Helper: check if a bucket has ANY overlap with hourly data
  const doesBucketOverlapWithHourly = (bucket: NormalizedBucket): boolean => {
    const bucketStart = bucket.bucketStart.getTime();
    const bucketEnd = bucket.bucketEndMs;

    for (const range of hourlyTimeRanges) {
      if (bucketStart < range.end && range.start < bucketEnd) {
        return true;
      }
      if (range.start >= bucketEnd) {
        break;
      }
    }
    return false;
  };

  for (const bucket of dailyBuckets) {
    if (
      !doesBucketOverlapWithRaw(bucket) &&
      !doesBucketOverlapWithHourly(bucket)
    ) {
      result.push(bucket);
    }
  }

  // Sort final result by bucket start time
  result.sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());

  return result;
}

/**
 * Combine multiple buckets into a single bucket.
 * Used when re-aggregating smaller buckets into larger target buckets.
 *
 * Uses automatic merging via each strategy's and collector's
 * VersionedAggregated.mergeAggregatedStates method.
 */
export function combineBuckets(params: {
  buckets: NormalizedBucket[];
  targetBucketStart: Date;
  targetBucketEndMs: number;
  collectorRegistry: CollectorRegistry;
  registry: HealthCheckRegistry;
  strategyId: string;
}): NormalizedBucket {
  const {
    buckets,
    targetBucketStart,
    targetBucketEndMs,
    collectorRegistry,
    registry,
    strategyId,
  } = params;

  if (buckets.length === 0) {
    return {
      bucketStart: targetBucketStart,
      bucketEndMs: targetBucketEndMs,
      runCount: 0,
      healthyCount: 0,
      degradedCount: 0,
      unhealthyCount: 0,
      latencySumMs: undefined,
      minLatencyMs: undefined,
      maxLatencyMs: undefined,
      p95LatencyMs: undefined,
      aggregatedResult: undefined,
      sourceTier: "raw", // Will be overridden below
    };
  }

  // Aggregate counts (additive)
  let runCount = 0;
  let healthyCount = 0;
  let degradedCount = 0;
  let unhealthyCount = 0;
  let latencySumMs = 0;
  let hasLatencyData = false;

  const minValues: number[] = [];
  const maxValues: number[] = [];
  const p95Values: number[] = [];

  // Track which tier the data primarily comes from
  let lowestPriorityTier: NormalizedBucket["sourceTier"] = "raw";

  // Collect aggregatedResults for merging
  const aggregatedResults: Array<Record<string, unknown> | undefined> = [];

  for (const bucket of buckets) {
    runCount += bucket.runCount;
    healthyCount += bucket.healthyCount;
    degradedCount += bucket.degradedCount;
    unhealthyCount += bucket.unhealthyCount;

    if (bucket.latencySumMs !== undefined) {
      latencySumMs += bucket.latencySumMs;
      hasLatencyData = true;
    }

    if (bucket.minLatencyMs !== undefined) {
      minValues.push(bucket.minLatencyMs);
    }
    if (bucket.maxLatencyMs !== undefined) {
      maxValues.push(bucket.maxLatencyMs);
    }
    if (bucket.p95LatencyMs !== undefined) {
      p95Values.push(bucket.p95LatencyMs);
    }

    // Track lowest priority (highest number) tier
    if (TIER_PRIORITY[bucket.sourceTier] > TIER_PRIORITY[lowestPriorityTier]) {
      lowestPriorityTier = bucket.sourceTier;
    }

    aggregatedResults.push(bucket.aggregatedResult);
  }

  // Merge aggregatedResults using registries for precise re-aggregation
  const mergedAggregatedResult = mergeAggregatedBucketResults({
    aggregatedResults,
    collectorRegistry,
    registry,
    strategyId,
  });

  return {
    bucketStart: targetBucketStart,
    bucketEndMs: targetBucketEndMs,
    runCount,
    healthyCount,
    degradedCount,
    unhealthyCount,
    latencySumMs: hasLatencyData ? latencySumMs : undefined,
    minLatencyMs: minValues.length > 0 ? Math.min(...minValues) : undefined,
    maxLatencyMs: maxValues.length > 0 ? Math.max(...maxValues) : undefined,
    // Use max of p95s as conservative upper-bound approximation
    p95LatencyMs: p95Values.length > 0 ? Math.max(...p95Values) : undefined,
    // Automatically merged aggregatedResult
    aggregatedResult: mergedAggregatedResult,
    sourceTier: lowestPriorityTier,
  };
}

/**
 * Re-aggregate a list of normalized buckets into target-sized buckets.
 * Groups source buckets by target bucket boundaries and combines them.
 *
 * Uses automatic merging of aggregatedResult via each strategy's and
 * collector's VersionedAggregated.mergeAggregatedStates method.
 *
 * @param rangeEnd - The end of the query range. The last bucket will extend
 *   to this time to ensure data is visually represented up to the query end.
 */
export function reaggregateBuckets(params: {
  sourceBuckets: NormalizedBucket[];
  targetIntervalMs: number;
  rangeStart: Date;
  rangeEnd: Date;
  collectorRegistry: CollectorRegistry;
  registry: HealthCheckRegistry;
  strategyId: string;
}): NormalizedBucket[] {
  const {
    sourceBuckets,
    targetIntervalMs,
    rangeStart,
    rangeEnd,
    collectorRegistry,
    registry,
    strategyId,
  } = params;

  if (sourceBuckets.length === 0) {
    return [];
  }

  const rangeStartMs = rangeStart.getTime();
  const rangeEndMs = rangeEnd.getTime();

  // Group source buckets by target bucket index
  const bucketGroups = new Map<number, NormalizedBucket[]>();

  for (const bucket of sourceBuckets) {
    const offsetMs = bucket.bucketStart.getTime() - rangeStartMs;
    const targetIndex = Math.floor(offsetMs / targetIntervalMs);

    if (!bucketGroups.has(targetIndex)) {
      bucketGroups.set(targetIndex, []);
    }
    bucketGroups.get(targetIndex)!.push(bucket);
  }

  // Combine each group into a single target bucket
  const result: NormalizedBucket[] = [];

  // Find the maximum bucket index to identify the last bucket
  const maxIndex = Math.max(...bucketGroups.keys());

  for (const [index, buckets] of bucketGroups) {
    const targetBucketStart = new Date(rangeStartMs + index * targetIntervalMs);
    const intervalEndMs = targetBucketStart.getTime() + targetIntervalMs;

    // For the last bucket, extend to rangeEnd to capture all trailing data
    const targetBucketEndMs =
      index === maxIndex ? Math.max(intervalEndMs, rangeEndMs) : intervalEndMs;

    result.push(
      combineBuckets({
        buckets,
        targetBucketStart,
        targetBucketEndMs,
        collectorRegistry,
        registry,
        strategyId,
      }),
    );
  }

  // Sort by bucket start time
  result.sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime());

  return result;
}
