import type { MaintenanceWithSystems } from "@checkstack/maintenance-common";

/**
 * Pure, DOM-free helpers for the dashboard's "planned maintenances" section.
 *
 * The dashboard only surfaces windows that have NOT started yet - i.e.
 * `scheduled` rows. In-progress windows are already announced as per-system
 * signals via {@link MaintenanceSignalsFiller}, so including them here would
 * duplicate. Kept here so the filter + sort branches are testable without
 * rendering the component.
 */

/** The maximum number of rows the dashboard section surfaces. Keeps the
 *  overview calm even when a team has queued many future windows. */
export const MAX_DASHBOARD_MAINTENANCES = 5;

/**
 * Select the maintenances the dashboard should announce: `scheduled` windows
 * (not yet started, regardless of end time), sorted by start time ascending
 * (soonest first) and capped to a small number.
 *
 * `in_progress` windows are intentionally excluded - they are already surfaced
 * as per-system signals by {@link MaintenanceSignalsFiller}, and showing them
 * here too would duplicate.
 *
 * `now` is injected so tests are deterministic; callers should pass
 * `new Date()` (or a realtime clock) in production.
 */
export function selectUpcomingMaintenances({
  maintenances,
  limit = MAX_DASHBOARD_MAINTENANCES,
}: {
  maintenances: MaintenanceWithSystems[];
  now: Date;
  limit?: number;
}): MaintenanceWithSystems[] {
  return maintenances
    .filter((m) => m.status === "scheduled")
    .toSorted((a, b) => {
      const aStart = new Date(a.startAt).getTime();
      const bStart = new Date(b.startAt).getTime();
      if (aStart !== bStart) return aStart - bStart;
      // Stable tiebreak: id, so two windows starting together don't shuffle.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, limit);
}
