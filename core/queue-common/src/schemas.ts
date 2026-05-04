import { z } from "zod";

/**
 * DTO for queue plugin information
 */
export const QueuePluginDtoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  configVersion: z.number(),
  configSchema: z.record(z.string(), z.unknown()),
});

export type QueuePluginDto = z.infer<typeof QueuePluginDtoSchema>;

/**
 * DTO for current queue configuration
 */
export const QueueConfigurationDtoSchema = z.object({
  pluginId: z.string(),
  config: z.record(z.string(), z.unknown()),
});

export type QueueConfigurationDto = z.infer<typeof QueueConfigurationDtoSchema>;

/**
 * Schema for updating queue configuration
 */
export const UpdateQueueConfigurationSchema = z.object({
  pluginId: z.string().describe("ID of the queue plugin to use"),
  config: z
    .record(z.string(), z.unknown())
    .describe("Plugin-specific configuration"),
});

export type UpdateQueueConfiguration = z.infer<
  typeof UpdateQueueConfigurationSchema
>;

/**
 * Scope of a stats response: `"instance"` if the figures reflect just the
 * local process (in-memory backends), `"cluster"` if they're shared across
 * the deployment (Redis-backed backends).
 */
export const StatsScopeSchema = z.enum(["instance", "cluster"]);
export type StatsScope = z.infer<typeof StatsScopeSchema>;

/**
 * Queue statistics DTO. The `scope` field exists so the UI can warn users
 * when in-memory backends are running with horizontal scaling.
 */
export const QueueStatsDtoSchema = z.object({
  pending: z.number(),
  processing: z.number(),
  completed: z.number(),
  failed: z.number(),
  scope: StatsScopeSchema,
});

export type QueueStatsDto = z.infer<typeof QueueStatsDtoSchema>;

export const JobStateSchema = z.enum([
  "pending",
  "waiting",
  "active",
  "delayed",
  "completed",
  "failed",
]);
export type JobStateDto = z.infer<typeof JobStateSchema>;

export const JobSummaryDtoSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  state: JobStateSchema,
  enqueuedAt: z.coerce.date(),
  startedAt: z.coerce.date().optional(),
  finishedAt: z.coerce.date().optional(),
  attempts: z.number().int().nonnegative(),
  failedReason: z.string().optional(),
  nextRunAt: z.coerce.date().optional(),
  recurring: z.boolean().optional(),
});

export type JobSummaryDto = z.infer<typeof JobSummaryDtoSchema>;

export const ListJobsInputSchema = z.object({
  state: JobStateSchema,
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(200),
});

export type ListJobsInput = z.infer<typeof ListJobsInputSchema>;

export const ListJobsResultSchema = z.object({
  items: z.array(JobSummaryDtoSchema),
  total: z.number().int().nonnegative().nullable(),
  hasMore: z.boolean(),
});

export type ListJobsResultDto = z.infer<typeof ListJobsResultSchema>;

/**
 * Lag severity levels
 */
export const LagSeveritySchema = z.enum(["none", "warning", "critical"]);
export type LagSeverity = z.infer<typeof LagSeveritySchema>;

/**
 * Queue lag thresholds configuration
 */
export const QueueLagThresholdsSchema = z.object({
  warningThreshold: z
    .number()
    .min(1)
    .default(100)
    .describe("Pending job count to trigger warning"),
  criticalThreshold: z
    .number()
    .min(1)
    .default(500)
    .describe("Pending job count to trigger critical alert"),
});

export type QueueLagThresholds = z.infer<typeof QueueLagThresholdsSchema>;

/**
 * Queue lag status response
 */
export const QueueLagStatusSchema = z.object({
  pending: z.number(),
  severity: LagSeveritySchema,
  thresholds: QueueLagThresholdsSchema,
});

export type QueueLagStatus = z.infer<typeof QueueLagStatusSchema>;
