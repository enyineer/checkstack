import { z } from "zod";

// --- API Request/Response Schemas (Zod) ---

export const HealthCheckStrategyDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  configSchema: z.record(z.string(), z.unknown()),
  /** JSON Schema for per-run result metadata (with chart annotations) */
  resultSchema: z.record(z.string(), z.unknown()).optional(),
  /** JSON Schema for aggregated result metadata (with chart annotations) */
  aggregatedResultSchema: z.record(z.string(), z.unknown()).optional(),
});

export type HealthCheckStrategyDto = z.infer<
  typeof HealthCheckStrategyDtoSchema
>;

/**
 * Collector DTO for frontend discovery.
 * ID is fully-qualified: `pluginId.collectorId` (e.g., `collector-hardware.cpu`)
 */
export const CollectorDtoSchema = z.object({
  /** Fully-qualified ID: pluginId.collectorId */
  id: z.string(),
  /** Human-readable name */
  displayName: z.string(),
  /** Optional description */
  description: z.string().optional(),
  /** JSON Schema for collector configuration */
  configSchema: z.record(z.string(), z.unknown()),
  /** JSON Schema for per-run result metadata (with chart annotations) */
  resultSchema: z.record(z.string(), z.unknown()),
  /** Whether multiple instances of this collector are allowed per config */
  allowMultiple: z.boolean(),
});

export type CollectorDto = z.infer<typeof CollectorDtoSchema>;

/**
 * A single collector assertion with field, operator, and optional value.
 */
export const CollectorAssertionSchema = z.object({
  /** Field path to assert on (from collector result schema) */
  field: z.string(),
  /** JSONPath expression for jsonpath-type assertions (e.g., $.status) */
  jsonPath: z.string().optional(),
  /** Comparison operator */
  operator: z.string(),
  /** Expected value (not needed for some operators like exists, isTrue) */
  value: z.unknown().optional(),
});

export type CollectorAssertion = z.infer<typeof CollectorAssertionSchema>;

/**
 * A collector configuration entry within a health check.
 * Each entry includes a unique ID, the collector type ID, its config, and per-collector assertions.
 */
export const CollectorConfigEntrySchema = z.object({
  /** Unique ID for this collector instance (UUID) */
  id: z.string(),
  /** Fully-qualified collector ID (e.g., collector-hardware.cpu) */
  collectorId: z.string(),
  /** Collector-specific configuration */
  config: z.record(z.string(), z.unknown()),
  /** Per-collector assertions (schema derived from collector's resultSchema) */
  assertions: z.array(CollectorAssertionSchema).optional(),
});

export type CollectorConfigEntry = z.infer<typeof CollectorConfigEntrySchema>;

export const HealthCheckConfigurationSchema = z.object({
  id: z.string(),
  name: z.string(),
  strategyId: z.string(),
  config: z.record(z.string(), z.unknown()),
  intervalSeconds: z.number(),
  /** Optional collector configurations */
  collectors: z.array(CollectorConfigEntrySchema).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type HealthCheckConfiguration = z.infer<
  typeof HealthCheckConfigurationSchema
>;

export const CreateHealthCheckConfigurationSchema = z.object({
  name: z.string().min(1),
  strategyId: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  intervalSeconds: z.number().min(1),
  /** Optional collector configurations */
  collectors: z.array(CollectorConfigEntrySchema).optional(),
});

export type CreateHealthCheckConfiguration = z.infer<
  typeof CreateHealthCheckConfigurationSchema
>;

export const UpdateHealthCheckConfigurationSchema =
  CreateHealthCheckConfigurationSchema.partial();

export type UpdateHealthCheckConfiguration = z.infer<
  typeof UpdateHealthCheckConfigurationSchema
>;

/**
 * Health check status enum - same as database enum.
 */
export const HealthCheckStatusSchema = z.enum([
  "healthy",
  "unhealthy",
  "degraded",
]);

export type HealthCheckStatus = z.infer<typeof HealthCheckStatusSchema>;

// --- State Threshold Schemas ---

/**
 * Consecutive mode: evaluates based on sequential identical results.
 * Good for stable systems where transient failures are rare.
 */
export const ConsecutiveThresholdsSchema = z.object({
  mode: z.literal("consecutive"),
  /** Minimum consecutive successes to transition to healthy */
  healthy: z.object({
    minSuccessCount: z.number().int().min(1).default(1),
  }),
  /** Minimum consecutive failures to transition to degraded */
  degraded: z.object({
    minFailureCount: z.number().int().min(1).default(2),
  }),
  /** Minimum consecutive failures to transition to unhealthy */
  unhealthy: z.object({
    minFailureCount: z.number().int().min(1).default(5),
  }),
});

export type ConsecutiveThresholds = z.infer<typeof ConsecutiveThresholdsSchema>;

/**
 * Window mode: evaluates based on failure count within a sliding window.
 * Better for flickering systems where failures are intermittent.
 */
export const WindowThresholdsSchema = z.object({
  mode: z.literal("window"),
  /** Number of recent runs to evaluate */
  windowSize: z.number().int().min(3).max(100).default(10),
  /** Minimum failures in window to transition to degraded */
  degraded: z.object({
    minFailureCount: z.number().int().min(1).default(3),
  }),
  /** Minimum failures in window to transition to unhealthy */
  unhealthy: z.object({
    minFailureCount: z.number().int().min(1).default(7),
  }),
});

export type WindowThresholds = z.infer<typeof WindowThresholdsSchema>;

/**
 * Discriminated union of threshold modes
 */
export const StateThresholdsSchema = z.discriminatedUnion("mode", [
  ConsecutiveThresholdsSchema,
  WindowThresholdsSchema,
]);

export type StateThresholds = z.infer<typeof StateThresholdsSchema>;

/**
 * Default thresholds for backward compatibility
 */
export const DEFAULT_STATE_THRESHOLDS: StateThresholds = {
  mode: "consecutive",
  healthy: { minSuccessCount: 1 },
  degraded: { minFailureCount: 2 },
  unhealthy: { minFailureCount: 5 },
};

export const AssociateHealthCheckSchema = z.object({
  configurationId: z.string().uuid(),
  enabled: z.boolean().default(true),
  stateThresholds: StateThresholdsSchema.optional(),
});

export type AssociateHealthCheck = z.infer<typeof AssociateHealthCheckSchema>;

export const GetHealthCheckHistoryQuerySchema = z.object({
  systemId: z.string().uuid().optional(),
  configurationId: z.string().uuid().optional(),
  limit: z.number().optional(),
});

export const HealthCheckRunSchema = z.object({
  id: z.string(),
  configurationId: z.string(),
  systemId: z.string(),
  status: HealthCheckStatusSchema,
  result: z.record(z.string(), z.unknown()),
  timestamp: z.date(),
  latencyMs: z.number().optional(),
});

export type HealthCheckRun = z.infer<typeof HealthCheckRunSchema>;

/**
 * Schema for the result object stored in HealthCheckRun.result.
 * Mirrors the HealthCheckResult type from backend-api but is available to frontend.
 *
 * Structure:
 * - status: The health status from the strategy execution
 * - latencyMs: Execution time in milliseconds
 * - message: Human-readable status message
 * - metadata: Strategy-specific fields (e.g., statusCode, contentType for HTTP)
 */
export const StoredHealthCheckResultSchema = z.object({
  status: HealthCheckStatusSchema,
  latencyMs: z.number().optional(),
  message: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type StoredHealthCheckResult = z.infer<
  typeof StoredHealthCheckResultSchema
>;

/**
 * Public schema for health check runs without sensitive result data.
 * Used by public endpoints accessible to anonymous/authenticated users.
 */
export const HealthCheckRunPublicSchema = z.object({
  id: z.string(),
  configurationId: z.string(),
  systemId: z.string(),
  status: HealthCheckStatusSchema,
  timestamp: z.date(),
  latencyMs: z.number().optional(),
});

export type HealthCheckRunPublic = z.infer<typeof HealthCheckRunPublicSchema>;

// --- Retention Configuration ---

/**
 * Retention configuration for health check data.
 * Defines how long raw runs and aggregates are kept.
 */
export const RetentionConfigSchema = z.object({
  /** Days to keep raw run data before aggregating (default: 7) */
  rawRetentionDays: z.number().int().min(1).max(30).default(7),
  /** Days to keep hourly aggregates before rolling to daily (default: 30) */
  hourlyRetentionDays: z.number().int().min(7).max(90).default(30),
  /** Days to keep daily aggregates before deleting (default: 365) */
  dailyRetentionDays: z.number().int().min(30).max(1095).default(365),
});

export type RetentionConfig = z.infer<typeof RetentionConfigSchema>;

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  rawRetentionDays: 7,
  hourlyRetentionDays: 30,
  dailyRetentionDays: 365,
};

// --- Aggregated Bucket Schema ---

/**
 * Base schema for aggregated health check data buckets.
 * Contains core metrics only (no strategy-specific data).
 * Used by getAggregatedHistory endpoint (healthCheckStatusRead access).
 */
export const AggregatedBucketBaseSchema = z.object({
  bucketStart: z.date(),
  bucketSize: z.enum(["hourly", "daily"]),
  runCount: z.number(),
  healthyCount: z.number(),
  degradedCount: z.number(),
  unhealthyCount: z.number(),
  successRate: z.number(),
  avgLatencyMs: z.number().optional(),
  minLatencyMs: z.number().optional(),
  maxLatencyMs: z.number().optional(),
  p95LatencyMs: z.number().optional(),
});

export type AggregatedBucketBase = z.infer<typeof AggregatedBucketBaseSchema>;

/**
 * Extended schema with strategy-specific aggregated result.
 * Used by getDetailedAggregatedHistory endpoint (healthCheckDetailsRead access).
 */
export const AggregatedBucketSchema = AggregatedBucketBaseSchema.extend({
  aggregatedResult: z.record(z.string(), z.unknown()).optional(),
});

export type AggregatedBucket = z.infer<typeof AggregatedBucketSchema>;
