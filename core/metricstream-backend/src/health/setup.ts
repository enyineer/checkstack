import type {
  Logger,
  RpcService,
  SafeDatabase,
  HealthCheckRegistry,
  CollectorRegistry,
  RpcClient,
} from "@checkstack/backend-api";
import type { CacheManager } from "@checkstack/cache-api";
import { createCachedScope } from "@checkstack/cache-utils";
import { pluginMetadata } from "@checkstack/metricstream-common";
import type * as schema from "../schema";
import type { Storage } from "../storage";
import { MetricStreamHealthStrategy } from "./strategy";
import { MetricWindowCollector } from "./metric-window-collector";
import {
  createReferencedMetricNameResolver,
  type GetReferencedMetricNames,
} from "./metric-references";

export type { GetReferencedMetricNames } from "./metric-references";

/** Handle returned by {@link registerHealthIntegration}. */
export interface HealthIntegration {
  getReferencedMetricNames: GetReferencedMetricNames;
}

/**
 * Register the `metricstream` health-check strategy and its single
 * `metric-window` collector, plus the reference resolver used to protect
 * referenced metric names from retention.
 *
 * The strategy uses `StrategyCategory.OBSERVABILITY` (the ENUM constant - the v1
 * category regression), config `{ streamId }` via the `metricstreamStreamId`
 * resolver; the collector's config is the FROZEN `MetricWindowCollectorConfig`
 * shape annotated with the metricstream* resolver names. Both carry
 * DTO-conformance tests against the healthcheck DTO schemas.
 *
 * `rpcClient` is OPTIONAL: the referenced-name resolver enumerates health-check
 * configs via the sanctioned cross-plugin RPC client. Without it, referenced
 * protection is a no-op (returns an empty set) and retention simply cannot spare
 * a quiet but still-referenced name; the strategy + collector work regardless.
 */
export function registerHealthIntegration({
  db,
  storage,
  cacheManager,
  rpcClient,
  logger,
  healthCheckRegistry,
  collectorRegistry,
}: {
  rpc: RpcService;
  db: SafeDatabase<typeof schema>;
  storage: Storage;
  cacheManager: CacheManager;
  rpcClient?: RpcClient;
  logger: Logger;
  healthCheckRegistry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
}): HealthIntegration {
  healthCheckRegistry.register(new MetricStreamHealthStrategy({ db, storage }));
  collectorRegistry.register(new MetricWindowCollector());

  const getReferencedMetricNames = createReferencedMetricNameResolver({
    rpcClient,
    cache: createCachedScope({
      cacheManager,
      pluginId: pluginMetadata.pluginId,
      defaultTtlMs: 60_000,
    }),
  });

  if (!rpcClient) {
    logger.warn(
      "metricstream: rpcClient not provided; referenced-metric-name protection disabled (retention cannot spare a quiet referenced metric).",
    );
  }

  logger.debug("metricstream: health integration registered");
  return { getReferencedMetricNames };
}
