import type {
  CatalogHealthStatus,
  CatalogHealthStatuses,
} from "@checkstack/catalog-common";
import type { HealthFilter } from "./browseState.logic";

/**
 * Pure, DOM-free health-rollup logic for the catalog browse view.
 *
 * The group rollup and the health filter are BOTH derived from the per-system
 * status DATA the `CatalogBrowseHealthSlot` filler reports (a
 * `CatalogHealthStatuses` map) — NEVER from rendered badge output. This matters
 * because a healthy system emits no badge (see `SystemHealthBadge`), so the only
 * way to know a group is "all healthy" is to read every member's reported status
 * from the data path. A system absent from the map is `"unknown"`, never healthy.
 */

/** The resolved rollup for one group section's header. */
export interface GroupHealthRollup {
  /** Worst status among members, or `"unknown"` when no member has data. */
  worst: CatalogHealthStatus | "unknown";
  /** Count of degraded members. */
  degraded: number;
  /** Count of unhealthy members. */
  unhealthy: number;
  /** `true` when every member reported `"healthy"` (derived from data, not badges). */
  allHealthy: boolean;
  /**
   * `true` when at least one member has a reported status. When `false` the
   * group header shows counts only (no health source / unfilled slot).
   */
  hasData: boolean;
}

/** Severity ranking: higher = worse. `unknown` ranks below `healthy` (no signal). */
const SEVERITY: Record<CatalogHealthStatus | "unknown", number> = {
  unknown: 0,
  healthy: 1,
  degraded: 2,
  unhealthy: 3,
};

/**
 * Resolve a single system's effective health from the reported map. A system the
 * filler did not report is `"unknown"` (NOT healthy).
 */
export function resolveSystemHealth({
  systemId,
  statuses,
}: {
  systemId: string;
  statuses: CatalogHealthStatuses | undefined;
}): CatalogHealthStatus | "unknown" {
  return statuses?.[systemId] ?? "unknown";
}

/**
 * Compute the rollup for a group from its member ids and the reported statuses.
 *
 * - `worst` is the worst member status by severity (unhealthy > degraded >
 *   healthy > unknown). When no member has data, `worst` is `"unknown"`.
 * - `allHealthy` is true only when there is at least one member, every member has
 *   a reported status, and every reported status is `"healthy"`. Derived purely
 *   from the data map.
 */
export function computeGroupRollup({
  memberIds,
  statuses,
}: {
  memberIds: string[];
  statuses: CatalogHealthStatuses | undefined;
}): GroupHealthRollup {
  let degraded = 0;
  let unhealthy = 0;
  let worst: CatalogHealthStatus | "unknown" = "unknown";
  let reportedCount = 0;
  let healthyCount = 0;

  for (const id of memberIds) {
    const status = resolveSystemHealth({ systemId: id, statuses });
    if (status !== "unknown") reportedCount += 1;
    if (status === "healthy") healthyCount += 1;
    if (status === "degraded") degraded += 1;
    if (status === "unhealthy") unhealthy += 1;
    if (SEVERITY[status] > SEVERITY[worst]) worst = status;
  }

  const hasData = reportedCount > 0;
  const allHealthy =
    memberIds.length > 0 &&
    reportedCount === memberIds.length &&
    healthyCount === memberIds.length;

  return { worst, degraded, unhealthy, allHealthy, hasData };
}

/**
 * The visual tone a group section's accent stripe + chrome adopt, drawn from
 * the colorblind-safe status triad (plus a neutral `unknown` for "no signal").
 * Purely presentational, derived from the same rollup DATA the header pill uses
 * so position+hue and the inline pill never disagree.
 */
export type SectionTone = "ok" | "warn" | "down" | "unknown";

/**
 * Resolve a group section's accent tone from its health rollup. Mirrors the
 * `HealthRollupBadge` precedence so the left stripe and the pill always agree:
 *
 * - no reported data -> `unknown` (neutral, the header shows counts only)
 * - every member healthy -> `ok`
 * - any unhealthy member -> `down` (worst wins over degraded)
 * - any degraded member -> `warn`
 * - otherwise (mixed healthy + unknown, no failures) -> `unknown`
 */
export function resolveSectionTone(rollup: GroupHealthRollup): SectionTone {
  if (!rollup.hasData) return "unknown";
  if (rollup.allHealthy) return "ok";
  if (rollup.unhealthy > 0) return "down";
  if (rollup.degraded > 0) return "warn";
  return "unknown";
}

/**
 * Does a system pass the health filter? Derived from the reported status map.
 *
 * - `null` (unconstrained) matches everything.
 * - `"healthy" | "degraded" | "unhealthy"` match the system's reported status.
 * - `"unknown"` matches systems with no reported status (no health source / no
 *   checks wired) — so an absent entry is `"unknown"`, never silently healthy.
 *
 * When `statuses` is undefined entirely (slot unfilled), every system resolves to
 * `"unknown"`; the page disables the control in that case, but the predicate
 * still behaves correctly if a selection lingers in the URL.
 */
export function matchesHealth({
  systemId,
  health,
  statuses,
}: {
  systemId: string;
  health: HealthFilter | null;
  statuses: CatalogHealthStatuses | undefined;
}): boolean {
  if (health === null) return true;
  return resolveSystemHealth({ systemId, statuses }) === health;
}
