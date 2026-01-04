import { Versioned } from "./config-versioning";

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
 * Raw run data for aggregation (passed to aggregateMetadata function).
 */
export interface HealthCheckRunForAggregation<
  TResultMetadata = Record<string, unknown>
> {
  status: "healthy" | "unhealthy" | "degraded";
  latencyMs?: number;
  metadata?: TResultMetadata;
}

/**
 * Health check strategy definition with typed config and result.
 * @template TConfig - Configuration type for this strategy
 * @template TResult - Per-run result type
 * @template TAggregatedResult - Aggregated result type for buckets
 */
export interface HealthCheckStrategy<
  TConfig = unknown,
  TResult = Record<string, unknown>,
  TAggregatedResult = Record<string, unknown>
> {
  id: string;
  displayName: string;
  description?: string;

  /** Configuration schema with versioning and migrations */
  config: Versioned<TConfig>;

  /** Optional result schema with versioning and migrations */
  result?: Versioned<TResult>;

  /** Aggregated result schema for long-term bucket storage */
  aggregatedResult: Versioned<TAggregatedResult>;

  execute(config: TConfig): Promise<HealthCheckResult<TResult>>;

  /**
   * Aggregate results from multiple runs into a summary for bucket storage.
   * Called during retention processing when raw data is aggregated.
   * Core metrics (counts, latency) are auto-calculated by platform.
   * This function only handles strategy-specific result aggregation.
   */
  aggregateResult(
    runs: HealthCheckRunForAggregation<TResult>[]
  ): TAggregatedResult;
}

export interface HealthCheckRegistry {
  register(strategy: HealthCheckStrategy<unknown, unknown, unknown>): void;
  getStrategy(
    id: string
  ): HealthCheckStrategy<unknown, unknown, unknown> | undefined;
  getStrategies(): HealthCheckStrategy<unknown, unknown, unknown>[];
}
