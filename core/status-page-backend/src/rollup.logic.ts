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

/**
 * Overall BANNER status. Like {@link rollupStatus} but distinguishes a PARTIAL
 * outage (some, not all, known systems are down) from a MAJOR one (all known
 * systems down) — the industry-standard banner semantics. `unknown` systems are
 * ignored unless everything is unknown.
 */
export function overallBannerStatus(statuses: PublicStatus[]): PublicStatus {
  const known = statuses.filter((s) => s !== "unknown");
  if (known.length === 0) return "unknown";
  const majors = known.filter((s) => s === "major_outage").length;
  if (majors > 0) return majors === known.length ? "major_outage" : "partial_outage";
  // No hard outages: fall back to the worst of the remaining states.
  return rollupStatus(known);
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
