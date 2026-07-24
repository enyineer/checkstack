import type { SystemHealthStatus } from "@checkstack/healthcheck-common";

/** The badge to render, or `null` for no badge. */
export interface HealthBadgeModel {
  /** Maps onto `StatusBadge`'s tone: `warn` (degraded) or `error` (unhealthy). */
  tone: "warn" | "error";
  label: string;
}

/**
 * Decide the health badge for a system's rolled-up status.
 *
 * The badge flags PROBLEM states only:
 * - `unhealthy` -> `error` ("Unhealthy")
 * - `degraded`  -> `warn`  ("Degraded")
 *
 * `healthy` and `unknown` produce NO badge (return `null`). `unknown` means the
 * system is UNMEASURED - it has no checks, or none have run yet - which is "no
 * signal", not a fault. Rendering it as a badge would (before this) fall through
 * to the "Degraded" label and cry wolf on every check-less system, exactly the
 * false "Degraded" this guards against. `undefined` (still loading) also yields
 * no badge.
 *
 * When an incident forced the status, `overrideReason` is appended so hover /
 * assistive tech can explain WHY a system reads this way; it never changes the
 * tone.
 */
export function resolveHealthBadge({
  status,
  overrideReason,
}: {
  status: SystemHealthStatus | undefined;
  overrideReason?: string;
}): HealthBadgeModel | null {
  if (!status || status === "healthy" || status === "unknown") {
    return null;
  }

  const baseLabel = status === "unhealthy" ? "Unhealthy" : "Degraded";
  const label = overrideReason
    ? `${baseLabel} - forced by incident: ${overrideReason}`
    : baseLabel;

  return {
    tone: status === "unhealthy" ? "error" : "warn",
    label,
  };
}
