import { createHook } from "@checkmate-monitor/backend-api";

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
} as const;
