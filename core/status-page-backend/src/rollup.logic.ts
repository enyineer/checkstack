import type { PublicStatus } from "@checkstack/status-page-common";

/**
 * Pure status mapping + rollup for the public surface. Deterministic and
 * DB-free, so it is unit-tested directly. The INTERNAL health enum is never
 * exposed; it is mapped onto the public vocabulary here.
 */

/** Map the internal health status onto the public vocabulary. */
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

/**
 * Worst-of rollup precedence for the overall banner. Outages dominate; planned
 * maintenance ranks above a soft "degraded" (a degraded reading during a
 * maintenance window is expected) but below a hard outage; `unknown` only wins
 * when there is nothing else to report.
 */
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

/** Human banner title for an overall status. */
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
