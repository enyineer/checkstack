export * from "./access";
export * from "./schemas";
export * from "./zod-health-result";
export * from "./strategy-category";
export * from "./slots";

// --- DTOs for API Responses ---

/**
 * Represents a Health Check Strategy available in the system.
 */
import type { StrategyCategory } from "./strategy-category";

export interface HealthCheckStrategyDto {
  id: string;
  displayName: string;
  description?: string;
  category: StrategyCategory;
  // schema is a JSON schema object derived from the Zod schema
  configSchema: Record<string, unknown>;
}

import type { CollectorConfigEntry } from "./schemas";

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
    previousStatus: z.enum(["healthy", "degraded", "unhealthy"]),
    newStatus: z.enum(["healthy", "degraded", "unhealthy"]),
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
