import type { PublicStatus } from "@checkstack/status-page-common";

/**
 * Pure status mapping + rollup for the status-page health widgets. The INTERNAL
 * health enum is never exposed; it is mapped onto the public vocabulary here.
 * (Moved here from status-page-backend: the rollup is health-domain logic, so it
 * lives with the plugin that owns health.)
 */

export function mapHealthStatus(
  internal: "healthy" | "degraded" | "unhealthy" | string,
): PublicStatus {
  switch (internal) {
    case "healthy": {
      return "operational";
    }
    case "degraded": {
      return "degraded";
    }
    case "unhealthy": {
      return "major_outage";
    }
    default: {
      return "unknown";
    }
  }
}

const PRECEDENCE: PublicStatus[] = [
  "major_outage",
  "partial_outage",
  "maintenance",
  "degraded",
  "operational",
  "unknown",
];

export function rollupStatus(statuses: PublicStatus[]): PublicStatus {
  if (statuses.length === 0) return "unknown";
  for (const candidate of PRECEDENCE) {
    if (statuses.includes(candidate)) return candidate;
  }
  return "unknown";
}

/**
 * Overall BANNER status: distinguishes a PARTIAL outage (some, not all, known
 * systems down) from a MAJOR one (all known systems down). `unknown` is ignored
 * unless everything is unknown.
 */
export function overallBannerStatus(statuses: PublicStatus[]): PublicStatus {
  const known = statuses.filter((s) => s !== "unknown");
  if (known.length === 0) return "unknown";
  const majors = known.filter((s) => s === "major_outage").length;
  if (majors > 0) {
    return majors === known.length ? "major_outage" : "partial_outage";
  }
  return rollupStatus(known);
}

/**
 * Roll up a system's PER-ENVIRONMENT health-check statuses into a single public
 * status for a status page scoped to specific environments. ONLY the slices for
 * the selected environments are considered (worst-status-wins via the public
 * precedence); a system with no slice in any selected environment resolves to
 * `unknown`. Used by the health widgets when a page publishes an explicit
 * environment set, so a system in both prod and staging shows only its
 * selected-environment health rather than the cross-environment rollup.
 *
 * This considers CHECK statuses only. Incident-forced overrides are whole-system
 * (not environment-scoped), so the caller folds the override IN via worst-wins on
 * top of this result (see `healthPublicStatuses`) - keeping this helper a pure
 * per-environment checks rollup.
 */
export function rollupSelectedEnvironments(args: {
  environments: Record<string, { status: string }>;
  selectedEnvironmentIds: string[];
}): PublicStatus {
  const { environments, selectedEnvironmentIds } = args;
  const statuses: PublicStatus[] = [];
  for (const envId of selectedEnvironmentIds) {
    const slice = environments[envId];
    if (slice) statuses.push(mapHealthStatus(slice.status));
  }
  return rollupStatus(statuses);
}

export function statusBannerTitle(status: PublicStatus): string {
  switch (status) {
    case "operational": {
      return "All systems operational";
    }
    case "degraded": {
      return "Degraded performance";
    }
    case "partial_outage": {
      return "Partial system outage";
    }
    case "major_outage": {
      return "Major system outage";
    }
    case "maintenance": {
      return "Under maintenance";
    }
    case "unknown": {
      return "Status unknown";
    }
  }
}
