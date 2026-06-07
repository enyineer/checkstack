import {
  maintenanceAccess,
  deriveMaintenanceSignals,
  MAINTENANCE_SIGNAL_SOURCE,
} from "@checkstack/maintenance-common";
import {
  createGatedSystemSignalsContributor,
  type SystemAccessResolver,
  type SystemSignalsContributor,
} from "@checkstack/ai-backend";
import type { MaintenanceService } from "./service";

/**
 * Minimal slice of {@link MaintenanceService} the contributor needs - the
 * global, durable read of currently-active windows grouped by system.
 */
type ActiveMaintenanceReader = Pick<
  MaintenanceService,
  "getActiveMaintenancesBySystem"
>;

/**
 * Build the maintenance contributor for the cross-plugin `system.issues`
 * aggregator. Reads active windows globally from the shared maintenance tables
 * (identical answer on every pod) and runs the SAME deriver the dashboard filler
 * uses. The per-source access gate (global `maintenance.read` plus per-system
 * team grants) is applied by {@link createGatedSystemSignalsContributor}.
 */
export function createMaintenanceSignalsContributor({
  service,
  resolver,
}: {
  service: ActiveMaintenanceReader;
  resolver: SystemAccessResolver;
}): SystemSignalsContributor {
  return createGatedSystemSignalsContributor({
    sourceId: MAINTENANCE_SIGNAL_SOURCE,
    accessRule: maintenanceAccess.maintenance.read,
    resolver,
    readSignals: async () =>
      deriveMaintenanceSignals({
        maintenancesBySystem: await service.getActiveMaintenancesBySystem(),
      }),
  });
}
