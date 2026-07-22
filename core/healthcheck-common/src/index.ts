export * from "./config-secret-markers";
export * from "./assertion-analytics";
export * from "./access";
export * from "./schemas";
export * from "./run-timing-phases";
export * from "./zod-health-result";
export * from "./strategy-category";
export * from "./slots";
export * from "./run-trace-ids";
export * from "./run-queue";
export * from "./health-window";
export * from "./environment-slices";

// --- DTOs for API Responses ---
//
// `HealthCheckStrategyDto` and `CollectorDto` are the single source of truth in
// `./schemas` (inferred from their Zod schemas) and re-exported above.

import type { CollectorConfigEntry } from "./schemas";
import { SystemHealthStatusSchema } from "./schemas";

/**
 * Represents a Health Check Configuration (the check definition/template).
 * NOTE: This is derived from Zod schema but kept as interface for explicit type documentation.
 */
export interface HealthCheckConfiguration {
  id: string;
  name: string;
  strategyId: string;
  config: Record<string, unknown>;
  intervalSeconds: number;
  collectors?: CollectorConfigEntry[];
  paused: boolean;
  /**
   * READ-ONLY, populated only on REDACTED reads: which `x-secret` fields
   * actually have a stored value, so the editor shows the "a secret is stored"
   * hint / Clear only where one exists (a redacted read returns blank for both
   * stored-inline and never-set secrets). `strategy` lists top-level strategy
   * secret keys; `collectors` maps a collector entry id to its populated keys.
   * Absent on writes and on non-redacted internal reads.
   */
  configuredSecrets?: {
    strategy: string[];
    collectors: Record<string, string[]>;
  };
  createdAt: Date;
  updatedAt: Date;
}

// HealthCheckRun and HealthCheckStatus types are now exported from ./schemas

export * from "./rpc-contract";
export * from "./system-signals";
export * from "./plugin-metadata";
export * from "./notifications";
export { healthcheckRoutes } from "./routes";

// =============================================================================
// REALTIME SIGNALS
// =============================================================================

import { createSignal } from "@checkstack/signal-common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

/**
 * Broadcast when a health check run completes.
 * Frontend components listening to this signal can update live activity feeds.
 */
export const HEALTH_CHECK_RUN_COMPLETED = createSignal({
  pluginMetadata,
  event: "run.completed",
  payloadSchema: z.object({
    systemId: z.string(),
    systemName: z.string(),
    configurationId: z.string(),
    configurationName: z.string(),
    status: z.enum(["healthy", "degraded", "unhealthy"]),
    latencyMs: z.number().optional(),
    /**
     * The environment this run was fanned out to, when the run was
     * environment-scoped. Both are omitted for env-less runs (no membership /
     * opt-out), so non-environment-scoped runs are byte-for-byte unchanged.
     */
    environmentId: z.string().optional(),
    environmentName: z.string().optional(),
  }),
});

/**
 * Broadcast when a system's overall health status transitions.
 * Only fires on actual status changes (e.g. healthy → degraded, unhealthy → healthy),
 * NOT on every individual health check run. Use this for coarse-grained reactivity
 * like dashboard badges and dependency map node statuses.
 */
export const SYSTEM_STATUS_CHANGED = createSignal({
  pluginMetadata,
  event: "system.status_changed",
  payloadSchema: z.object({
    systemId: z.string(),
    /**
     * Either side may be `unknown`: a system whose checks have never run has no
     * measured status, so its first result is a genuine `unknown -> healthy`
     * transition that consumers should see. A RUN's own status is never
     * `unknown` - see `run.completed` above.
     */
    previousStatus: SystemHealthStatusSchema,
    newStatus: SystemHealthStatusSchema,
  }),
});

/**
 * Broadcast when the executor FAILED to resolve a system's environments from
 * the catalog at run time and DEGRADED to a single env-less run (fail-open).
 *
 * This is the durable-misconfig / catalog-outage observability signal: a
 * `logger.warn` alone is easy to miss, so this counter-style signal makes the
 * degradation observable (dashboards / alerts can count it). The check still
 * runs (env-less) — this signals that per-environment fan-out was skipped for
 * this tick, NOT that the check failed.
 */
export const ENVIRONMENT_RESOLUTION_FAILED = createSignal({
  pluginMetadata,
  event: "environment.resolution_failed",
  payloadSchema: z.object({
    systemId: z.string(),
    configurationId: z.string(),
    /** The error message that caused the fall-back to an env-less run. */
    error: z.string(),
  }),
});

/**
 * Broadcast whenever a health-check CONFIGURATION or its system ASSIGNMENTS
 * change (create/update/delete/pause/resume, associate/disassociate,
 * create-and-assign) - by ANY path: the UI, the AI assistant (which mutates on
 * the backend, so no frontend mutation runs), GitOps reconcile, or another
 * pod/user. The run-time executor already broadcasts run/status signals, but a
 * freshly created or edited check produces no run for up to an interval, so
 * without this an out-of-band config/assignment change would not reach an open
 * Health Checks list until the first run. The frontend signal auto-invalidator
 * refreshes the `[[healthcheck]]` react-query cache from it.
 */
export const HEALTHCHECK_CONFIG_CHANGED = createSignal({
  pluginMetadata,
  event: "config.changed",
  payloadSchema: z.object({
    /** What changed: a check configuration or a system assignment. */
    entity: z.enum(["configuration", "assignment"]),
    action: z.enum(["created", "updated", "deleted"]),
    /** The affected configuration id, when applicable. */
    configurationId: z.string().optional(),
    /** The affected system id, for assignment changes. */
    systemId: z.string().optional(),
  }),
});
