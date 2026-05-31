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
  // The `healthcheck.system.degraded` / `.healthy` / `.health_changed` hooks
  // were removed in Phase 4 (§10.3): the per-system aggregated health is now
  // the reactive `health` entity, whose change deriver fires the
  // `healthcheck.system_degraded` / `_healthy` / `_health_changed` trigger
  // events through Stage-1 routing. The remaining hooks below are KEPT:
  // `assignmentChanged` (config signal) and `checkCompleted` / `checkFailed`
  // (high-frequency raw samples + numeric_state wake source).
  //
  // The `flappingDetected` hook was removed: flapping is now detected in the
  // automation engine by the windowed-count gate on the
  // `healthcheck.system_health_changed` trigger (base raw change event +
  // `filter` + `window: { count, minutes, refire: "once" }`), so healthcheck
  // no longer computes or emits a pre-derived flapping signal.

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
} as const;
