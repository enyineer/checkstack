import type { PluginMetadata } from "@checkstack/common";
import type { TransportClient } from "./transport-client";
import type { Versioned } from "./config-versioning";
import type { HealthCheckRunForAggregation } from "./health-check";
import type {
  VersionedAggregated,
  AggregatedResultShape,
} from "./aggregated-result";

/**
 * Result from a collector execution.
 */
export interface CollectorResult<TResult> {
  /** Collector-specific result data */
  result: TResult;
  /** Optional error message if collection partially failed */
  error?: string;
}

/**
 * Generic collector strategy interface.
 *
 * Collectors extend health check strategies by providing additional metrics
 * collection capabilities. They receive a connected transport client and
 * produce typed results with chart metadata.
 *
 * @template TClient - Transport client type (e.g., SshTransportClient)
 * @template TConfig - Collector configuration schema
 * @template TResult - Per-execution result type
 * @template TAggregated - Aggregated result for buckets
 */
export interface CollectorStrategy<
  TClient extends TransportClient<unknown, unknown>,
  TConfig = unknown,
  TResult = Record<string, unknown>,
  TAggregated = Record<string, unknown>,
> {
  /** Unique identifier for this collector */
  id: string;

  /** Human-readable name */
  displayName: string;

  /** Optional description */
  description?: string;

  /**
   * PluginMetadata of transport strategies this collector supports.
   * The registry uses this to match collectors to compatible strategies.
   */
  supportedPlugins: PluginMetadata[];

  /**
   * Whether multiple instances of this collector can be added to one config.
   * Default: false (one instance per collector type)
   */
  allowMultiple?: boolean;

  /** Collector configuration schema with versioning */
  config: Versioned<TConfig>;

  /** Per-execution result schema (with x-chart-* metadata) */
  result: Versioned<TResult>;

  /** Aggregated result schema for bucket storage with merge function */
  aggregatedResult: VersionedAggregated<AggregatedResultShape>;

  /**
   * Execute the collector using the provided transport client.
   *
   * @param params.config - Validated collector configuration
   * @param params.client - Connected transport client
   * @param params.pluginId - ID of the transport strategy invoking this collector
   * @returns Collector result with typed metadata
   */
  execute(params: {
    config: TConfig;
    client: TClient;
    pluginId: string;
  }): Promise<CollectorResult<TResult>>;

  /**
   * Incrementally merge new run data into an existing aggregate.
   * Called after each health check run for real-time aggregation.
   *
   * @param existing - Existing aggregated result (undefined for first run in bucket)
   * @param newRun - Data from the new run to merge
   * @returns Updated aggregated result
   */
  mergeResult(
    existing: TAggregated | undefined,
    newRun: HealthCheckRunForAggregation<TResult>,
  ): TAggregated;
}
