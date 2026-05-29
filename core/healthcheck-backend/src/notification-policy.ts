import type {
  HealthCheckStatus,
  NotificationPolicy,
} from "@checkstack/healthcheck-common";

/**
 * The kind of transition a system health change represents. Used to
 * decide whether a notification should fire and how its CTA should
 * link back into the UI.
 */
export type TransitionKind =
  /** No actual change (e.g. healthy → healthy). */
  | "none"
  /** Severity increased (healthy → degraded, degraded → unhealthy, ...). */
  | "escalation"
  /** Severity decreased but did not reach healthy (unhealthy → degraded). */
  | "deescalation"
  /** Returned to healthy from any non-healthy state. */
  | "recovery";

const SEVERITY: Record<HealthCheckStatus, number> = {
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
};

/**
 * Classify a transition between two health states. Pure and total over
 * the cartesian product of `HealthCheckStatus` values.
 */
export function classifyTransition(
  previous: HealthCheckStatus,
  next: HealthCheckStatus,
): TransitionKind {
  if (previous === next) return "none";
  if (next === "healthy") return "recovery";
  return SEVERITY[next] > SEVERITY[previous] ? "escalation" : "deescalation";
}

/**
 * Decide whether a transition should produce a notification given the
 * effective per-system policy. Escalations and recoveries always notify;
 * de-escalations are suppressed when the policy opts in.
 */
export function shouldNotifyTransition(
  kind: TransitionKind,
  policy: NotificationPolicy,
): boolean {
  if (kind === "none") return false;
  if (kind === "deescalation" && policy.suppressDeEscalations) return false;
  return true;
}
