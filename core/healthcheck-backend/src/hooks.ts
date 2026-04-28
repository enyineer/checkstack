import { createHook } from "@checkstack/backend-api";

/**
 * Health check hooks for cross-plugin communication and external integrations.
 * These hooks are registered as integration events for webhook subscriptions.
 */
export const healthCheckHooks = {
  /**
   * Emitted when a system's aggregated health status degrades.
   * This fires when status changes from healthy to degraded/unhealthy,
   * or from degraded to unhealthy.
   */
  systemDegraded: createHook<{
    systemId: string;
    systemName?: string;
    previousStatus: string;
    newStatus: string;
    healthyChecks: number;
    totalChecks: number;
    timestamp: string;
  }>("healthcheck.system.degraded"),

  /**
   * Emitted when a system's aggregated health status recovers to healthy.
   * This fires when status changes from degraded/unhealthy to healthy.
   */
  systemHealthy: createHook<{
    systemId: string;
    systemName?: string;
    previousStatus: string;
    healthyChecks: number;
    totalChecks: number;
    timestamp: string;
  }>("healthcheck.system.healthy"),

  /**
   * Emitted when a health check ↔ system association changes.
   * Subscribers (e.g., satellite-backend) can use this to push
   * updated assignments to connected satellites.
   */
  assignmentChanged: createHook<{
    systemId: string;
    configurationId: string;
  }>("healthcheck.assignment.changed"),

  /**
   * Emitted when a single health check execution finishes.
   * This is used by the anomaly detection engine to run the inline fast detector.
   */
  checkCompleted: createHook<{
    systemId: string;
    configurationId: string;
    status: string;
    latencyMs: number | undefined;
    result: Record<string, unknown> | undefined;
    timestamp: string;
  }>("healthcheck.check.completed"),
} as const;
