import { z } from "zod";

// --- API Request/Response Schemas (Zod) ---

export const HealthCheckStrategyDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  configSchema: z.record(z.string(), z.unknown()),
});

export const HealthCheckConfigurationSchema = z.object({
  id: z.string(),
  name: z.string(),
  strategyId: z.string(),
  config: z.record(z.string(), z.unknown()),
  intervalSeconds: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateHealthCheckConfigurationSchema = z.object({
  name: z.string().min(1),
  strategyId: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  intervalSeconds: z.number().min(1),
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
 * Schema for aggregated health check data buckets.
 * Used for long-term storage and visualization of historical data.
 */
export const AggregatedBucketSchema = z.object({
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
  aggregatedResult: z.record(z.string(), z.unknown()).optional(),
});

export type AggregatedBucket = z.infer<typeof AggregatedBucketSchema>;
