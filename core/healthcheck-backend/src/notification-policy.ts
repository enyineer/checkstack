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
 *
 * Accepts the narrowed `Pick` because callers may only have the
 * suppression flag — full policy resolution requires per-check lookups
 * that aren't relevant to this decision.
 */
export function shouldNotifyTransition(
  kind: TransitionKind,
  policy: Pick<NotificationPolicy, "suppressDeEscalations">,
): boolean {
  if (kind === "none") return false;
  if (kind === "deescalation" && policy.suppressDeEscalations) return false;
  return true;
}

/**
 * Decide whether the system-ROLLUP notification should fire for a fanned-out
 * system in a given tick.
 *
 * When a check fans out to environments, each environment that changes status
 * emits its own notification ("system unhealthy in env X"). The post-loop
 * rollup transition ("system unhealthy") then describes the SAME underlying
 * outage, so firing it too produces the duplicate notification pair users see.
 *
 * The rollup change is always driven by the very environment(s) that already
 * notified this tick, so the rollup notification is redundant whenever any
 * environment notified. It is only emitted as a fallback when NO environment
 * notified (e.g. every per-env delivery was suppressed or threw) so a real
 * system status change never goes entirely unannounced.
 *
 * The rollup TRANSITION record and the `SYSTEM_STATUS_CHANGED` signal are
 * emitted regardless — only the user-facing notification is deduplicated.
 */
export function shouldEmitRollupNotification({
  anyEnvironmentNotified,
}: {
  anyEnvironmentNotified: boolean;
}): boolean {
  return !anyEnvironmentNotified;
}
