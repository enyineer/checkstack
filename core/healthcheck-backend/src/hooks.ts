import { createHook } from "@checkstack/backend-api";
import type { HealthCheckStatus } from "@checkstack/healthcheck-common";

/**
 * Health check hooks for cross-plugin communication and external integrations.
 * These hooks are registered as integration events for webhook subscriptions.
 *
 * `status` / `previousStatus` / `newStatus` carry the canonical
 * `HealthCheckStatus` enum values, so automation triggers built on
 * these hooks can offer the known values for `==` comparisons in the
 * editor.
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
    previousStatus: HealthCheckStatus;
    newStatus: HealthCheckStatus;
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
    previousStatus: HealthCheckStatus;
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
    status: HealthCheckStatus;
    latencyMs: number | undefined;
    result: Record<string, unknown> | undefined;
    timestamp: string;
  }>("healthcheck.check.completed"),

  /**
   * Umbrella variant of `systemDegraded` + `systemHealthy` — fires on
   * **any** aggregated-health transition, carrying both the previous
   * and new statuses. Subscribers (e.g. an automation that wants to
   * react to every state change without subscribing to two hooks
   * and coalescing themselves) prefer this one.
   *
   * Emitted alongside the directional hooks, never instead of them,
   * so existing subscribers keep working unchanged.
   */
  systemHealthChanged: createHook<{
    systemId: string;
    systemName?: string;
    previousStatus: HealthCheckStatus;
    newStatus: HealthCheckStatus;
    healthyChecks: number;
    totalChecks: number;
    timestamp: string;
  }>("healthcheck.system.health_changed"),

  /**
   * Narrow variant of `checkCompleted` — fires only when an individual
   * check run completed with a non-`healthy` status. Carries the
   * latency + raw result so subscribers can branch on collector-
   * specific fields without re-querying. Operators usually prefer
   * this over `checkCompleted` for incident-style automation because
   * a "trigger on any completion, then filter" automation is harder
   * to read at a glance than a typed `check_failed` entry point.
   */
  checkFailed: createHook<{
    systemId: string;
    configurationId: string;
    status: HealthCheckStatus;
    latencyMs: number | undefined;
    result: Record<string, unknown> | undefined;
    timestamp: string;
  }>("healthcheck.check.failed"),

  /**
   * Emitted when the flapping-detector observes ≥ N unhealthy
   * transitions in the policy's configured window. Fires regardless
   * of whether `autoOpenIncidentOnUnhealthy` is enabled — the hook is
   * informational; the auto-incident pipeline still gates on the
   * policy.
   *
   * Re-fires on every additional transition past the threshold while
   * the check stays in a flapping pattern, so automations that want
   * "page once and only once" should debounce on `(systemId,
   * configurationId)`. Carrying the observed transition count + the
   * window length lets subscribers reason about both.
   */
  flappingDetected: createHook<{
    systemId: string;
    configurationId: string;
    transitionCount: number;
    windowMinutes: number;
    timestamp: string;
  }>("healthcheck.flapping_detected"),
} as const;
