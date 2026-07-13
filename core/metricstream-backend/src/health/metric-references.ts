/**
 * Resolver for the set of metric NAMES a stream's health checks REFERENCE.
 *
 * A metric name asserted on by a `metric-window` collector must never silently
 * vanish: name-registry retention would orphan the check's picker label and
 * reset its `secondsSinceLastSample` staleness fallback. This resolver feeds the
 * protected set to the maintenance job so a quiet-but-referenced name (and its
 * series) is spared retention while a check still points at it (bucket data
 * still ages out normally - only the name/series registry rows survive).
 *
 * It reuses the sanctioned cross-plugin config lookup exactly:
 * `HealthCheckApi.getConfigurations` -> filter to `metricstream.metricstream`
 * configs bound to this stream -> collect `collectors[].config.metricName` from
 * every `metric-window` collector. Cached 60s per stream (the plan's staleness).
 */

import type { RpcClient } from "@checkstack/backend-api";
import type { CachedScope } from "@checkstack/cache-utils";
import { HealthCheckApi } from "@checkstack/healthcheck-common";
import {
  METRICSTREAM_QUALIFIED_STRATEGY_ID,
  METRIC_WINDOW_QUALIFIED_COLLECTOR_ID,
} from "./constants";

/** Resolve (cached) the metric names referenced by a stream's health checks. */
export type GetReferencedMetricNames = (input: {
  streamId: string;
}) => Promise<Set<string>>;

/**
 * Build the cached referenced-metric-name resolver on the trusted cross-plugin
 * RPC client. Enumerates health-check configurations, keeps the metricstream
 * ones bound to `streamId`, and unions every `metricName` their `metric-window`
 * collectors reference. Cached 60s per stream. Returns an empty set when the RPC
 * client is unavailable (no health checks can exist without it).
 */
export function createReferencedMetricNameResolver({
  rpcClient,
  cache,
  cacheTtlMs = 60_000,
}: {
  rpcClient: RpcClient | undefined;
  cache: CachedScope;
  cacheTtlMs?: number;
}): GetReferencedMetricNames {
  if (!rpcClient) {
    return async () => new Set<string>();
  }
  return ({ streamId }) =>
    cache.wrap(
      `referenced-metrics:${streamId}`,
      async () => {
        const client = rpcClient.forPlugin(HealthCheckApi);
        const { configurations } = await client.getConfigurations();
        const referenced = new Set<string>();
        for (const config of configurations) {
          if (config.strategyId !== METRICSTREAM_QUALIFIED_STRATEGY_ID) continue;
          if (readStreamId(config.config) !== streamId) continue;
          for (const collector of config.collectors ?? []) {
            if (collector.collectorId !== METRIC_WINDOW_QUALIFIED_COLLECTOR_ID) {
              continue;
            }
            const metricName = readMetricName(collector.config);
            if (metricName) referenced.add(metricName);
          }
        }
        return referenced;
      },
      { ttlMs: cacheTtlMs },
    );
}

/** Read `streamId` from a stored strategy config record (no cast to any). */
function readStreamId(config: Record<string, unknown>): string | undefined {
  const value = config.streamId;
  return typeof value === "string" ? value : undefined;
}

/** Read `metricName` from a stored collector config record (no cast to any). */
function readMetricName(config: Record<string, unknown>): string | undefined {
  const value = config.metricName;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
