import { Versioned } from "./config-versioning";
import type { TransportClient } from "./transport-client";
import type {
  VersionedAggregated,
  AggregatedResultShape,
} from "./aggregated-result";

/**
 * Health check result with typed metadata.
 * TMetadata is defined by each strategy's resultMetadata schema.
 */
export interface HealthCheckResult<TMetadata = Record<string, unknown>> {
  status: "healthy" | "unhealthy" | "degraded";
  latencyMs?: number;
  message?: string;
  metadata?: TMetadata;
}

/**
 * Raw run data for aggregation (passed to mergeResult function).
 */
export interface HealthCheckRunForAggregation<
  TResultMetadata = Record<string, unknown>,
> {
  status: "healthy" | "unhealthy" | "degraded";
  latencyMs?: number;
  metadata?: TResultMetadata;
}

/**
 * Connected transport client with cleanup capability.
 */
export interface ConnectedClient<
  TClient extends TransportClient<unknown, unknown>,
> {
  /** The connected transport client */
  client: TClient;
  /** Close the connection and release resources */
  close(): void;
}

/**
 * Health check strategy definition with typed config and transport client.
 *
 * Strategies provide a `createClient` function that establishes a connection
 * and returns a transport client. The platform executor handles running
 * collectors and basic health check logic (connectivity test, latency measurement).
 *
 * @template TConfig - Configuration type for this strategy
 * @template TClient - Transport client type (e.g., SshTransportClient)
 * @template TResult - Per-run result type (for aggregation)
 * @template TAggregatedFields - Aggregated field definitions for VersionedAggregated
 */
export interface HealthCheckStrategy<
  TConfig = unknown,
  TClient extends TransportClient<unknown, unknown> = TransportClient<
    unknown,
    unknown
  >,
  TResult = Record<string, unknown>,
  TAggregatedFields extends AggregatedResultShape = AggregatedResultShape,
> {
  id: string;
  displayName: string;
  description?: string;

  /** Configuration schema with versioning and migrations */
  config: Versioned<TConfig>;

  /** Optional result schema with versioning and migrations */
  result?: Versioned<TResult>;

  /** Aggregated result schema for long-term bucket storage with automatic merging */
  aggregatedResult: VersionedAggregated<TAggregatedFields>;

  /**
   * Create a connected transport client from the configuration.
   * The platform will use this client to execute collectors.
   *
   * @param config - Validated strategy configuration
   * @returns Connected client wrapper with close() method
   * @throws Error if connection fails (will be caught by executor)
   */
  createClient(config: TConfig): Promise<ConnectedClient<TClient>>;

  /**
   * Incrementally merge new run data into an existing aggregate.
   * Called after each health check run for real-time aggregation.
   * Core metrics (counts, latency) are auto-calculated by platform.
   * This function only handles strategy-specific result aggregation.
   *
   * @param existing - Existing aggregated result (undefined for first run in bucket)
   * @param newRun - Data from the new run to merge
   * @returns Updated aggregated result
   */
  mergeResult(
    existing: Record<string, unknown> | undefined,
    newRun: HealthCheckRunForAggregation<TResult>,
  ): Record<string, unknown>;
}

/**
 * A registered strategy with its owning plugin metadata and qualified ID.
 */
export interface RegisteredStrategy {
  strategy: HealthCheckStrategy<
    unknown,
    TransportClient<unknown, unknown>,
    unknown,
    AggregatedResultShape
  >;
  ownerPluginId: string;
  qualifiedId: string;
}

export interface HealthCheckRegistry {
  register(
    strategy: HealthCheckStrategy<
      unknown,
      TransportClient<unknown, unknown>,
      unknown,
      AggregatedResultShape
    >,
  ): void;
  getStrategy(
    id: string,
  ):
    | HealthCheckStrategy<
        unknown,
        TransportClient<unknown, unknown>,
        unknown,
        AggregatedResultShape
      >
    | undefined;
  getStrategies(): HealthCheckStrategy<
    unknown,
    TransportClient<unknown, unknown>,
    unknown,
    AggregatedResultShape
  >[];
  /**
   * Get all registered strategies with their metadata (qualified ID, owner plugin).
   */
  getStrategiesWithMeta(): RegisteredStrategy[];
}
