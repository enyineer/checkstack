import { resolveRoute } from "@checkstack/common";
import type {
  SystemSignal,
  SystemSignalsMap,
} from "@checkstack/catalog-common";
import { maintenanceAccess } from "./access";
import { maintenanceRoutes } from "./routes";
import type { MaintenanceWithSystems } from "./schemas";

/**
 * Stable source id for the maintenance dashboard/system-signals contribution.
 * Surfaced as `source` on every emitted signal and used by the dashboard slot
 * to de-duplicate this source's re-reports. MUST match the backend
 * contributor's `sourceId`.
 */
export const MAINTENANCE_SIGNAL_SOURCE = "maintenance";

/**
 * Pure, dependency-free deriver shared by the frontend `SystemSignalsSlot`
 * filler and the backend `system.issues` aggregator contributor. Given the
 * maintenances grouped by systemId (the same shape both the bulk RPC and the
 * backend global query return), it emits one {@link SystemSignal} per
 * IN-PROGRESS window, keyed by systemId.
 *
 * Only `in_progress` windows are surfaced - scheduled (future) windows are not
 * "needs attention now". Systems with no active window are omitted from the
 * result (healthy as far as this source is concerned), so the output is safe to
 * feed straight into the dashboard map / aggregator merge.
 *
 * `systemIds`, when provided, restricts which systems are considered (the
 * frontend filler passes the overview's systems). When omitted, every system
 * present in `maintenancesBySystem` is considered (the backend reads globally).
 */
export function deriveMaintenanceSignals({
  maintenancesBySystem,
  systemIds,
}: {
  maintenancesBySystem: Record<string, MaintenanceWithSystems[]>;
  systemIds?: string[];
}): SystemSignalsMap {
  const result: SystemSignalsMap = {};

  const targetSystemIds = systemIds ?? Object.keys(maintenancesBySystem);

  for (const systemId of targetSystemIds) {
    const active = (maintenancesBySystem[systemId] ?? []).filter(
      (maintenance) => maintenance.status === "in_progress",
    );
    if (active.length === 0) continue;

    result[systemId] = active.map(
      (maintenance): SystemSignal => ({
        source: MAINTENANCE_SIGNAL_SOURCE,
        tone: "info",
        label: "Under maintenance",
        detail: maintenance.title,
        href: resolveRoute(maintenanceRoutes.routes.detail, {
          maintenanceId: maintenance.id,
        }),
        // Detail page is read-gated; render as text for users without it.
        accessRule: maintenanceAccess.maintenance.read,
        since: new Date(maintenance.startAt).toISOString(),
        iconName: "Wrench",
      }),
    );
  }

  return result;
}
