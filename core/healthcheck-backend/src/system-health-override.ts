import type {
  HealthCheckStatus,
  SystemHealthStatusResponse,
  SystemHealthOverride,
} from "@checkstack/healthcheck-common";

/**
 * Worst-wins ordering for the derived health vocabulary: a higher rank is a
 * worse status. Mirrors the inline `unhealthy > degraded > healthy` ordering the
 * per-check rollup uses in `service.ts`, extracted so the incident-override fold
 * shares the exact same comparison.
 */
const HEALTH_RANK: Record<HealthCheckStatus, number> = {
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
};

/** Returns whichever status is worse (ties return `a`). */
export function worstHealthStatus(
  a: HealthCheckStatus,
  b: HealthCheckStatus,
): HealthCheckStatus {
  return HEALTH_RANK[b] > HEALTH_RANK[a] ? b : a;
}

/**
 * A non-health-check contribution to a system's health, as consumed by the
 * fold. Kept source-agnostic (`source`/`sourceId`) so the health plugin does not
 * hard-code incident semantics; the incident-backed reader maps its rows into
 * this shape.
 */
export interface SystemHealthOverrideInput {
  /** The status this contributor forces. Never `healthy` in practice. */
  status: HealthCheckStatus;
  /** Contributor kind, e.g. "incident". */
  source: string;
  /** Human-readable reason, e.g. the incident title. */
  reason: string;
  /** Opaque id of the contributing record, e.g. the incident id. */
  sourceId?: string;
}

/**
 * Reads active health overrides for a set of systems. Implemented in the plugin
 * wiring over the incident RPC; injected into the health service so the service
 * stays free of a direct incident dependency and tests can stub it.
 */
export interface SystemHealthOverrideReader {
  getActiveOverrides(
    systemIds: string[],
  ): Promise<Record<string, SystemHealthOverrideInput[]>>;
}

/**
 * Fold a system's active overrides into its health-check-derived status via
 * worst-wins. The overall status becomes the worst of the checks-derived status
 * and every override, so an override that raises a system to `degraded` never
 * masks a health check reporting `unhealthy` (the worse status always wins), and
 * an override applies even when the system has no health checks at all.
 *
 * The worst contributing override (if any) is surfaced on `override` so a UI can
 * explain why a system reads worse than its checks alone. When the overrides are
 * empty the base response is returned unchanged (no `override`).
 */
export function applySystemHealthOverrides({
  base,
  overrides,
}: {
  base: SystemHealthStatusResponse;
  overrides: SystemHealthOverrideInput[];
}): SystemHealthStatusResponse {
  if (overrides.length === 0) return base;

  // The override that reads worst wins the `override` slot; a tie keeps the
  // first (query order), which for incidents is a stable, arbitrary pick.
  let worst = overrides[0]!;
  for (const candidate of overrides) {
    if (HEALTH_RANK[candidate.status] > HEALTH_RANK[worst.status]) {
      worst = candidate;
    }
  }

  const status = worstHealthStatus(base.status, worst.status);
  const override: SystemHealthOverride = {
    status: worst.status,
    source: worst.source,
    reason: worst.reason,
    sourceId: worst.sourceId,
  };

  return { ...base, status, override };
}
