import type { AuthUser } from "@checkstack/backend-api";
import { isAccessRuleSatisfied } from "@checkstack/common";
import {
  maintenanceAccess,
  deriveMaintenanceSignals,
  MAINTENANCE_SIGNAL_SOURCE,
} from "@checkstack/maintenance-common";
import {
  principalGrantedRuleIds,
  type SystemSignalsContributor,
} from "@checkstack/ai-backend";
import type { MaintenanceService } from "./service";

/**
 * Minimal slice of {@link MaintenanceService} the contributor needs - the
 * global, durable read of currently-active windows grouped by system. Narrowing
 * to this keeps the contributor unit-testable with a tiny stub.
 */
type ActiveMaintenanceReader = Pick<
  MaintenanceService,
  "getActiveMaintenancesBySystem"
>;

/**
 * Build the maintenance contributor for the cross-plugin `system.issues`
 * aggregator (ai-backend). Per-source access is THIS plugin's responsibility:
 * the originating principal is checked against `maintenance.read` and `{}` is
 * returned when not satisfied - never a throw for "no access". When allowed it
 * reads GLOBALLY from the shared maintenance tables (identical answer on every
 * pod) and runs the SAME deriver the dashboard filler uses, so backend and
 * frontend signals match exactly.
 *
 * Access uses the shared {@link principalGrantedRuleIds}, so a trusted service
 * principal sees every source consistently (matching the RPC middleware).
 */
export function createMaintenanceSignalsContributor({
  service,
}: {
  service: ActiveMaintenanceReader;
}): SystemSignalsContributor {
  return {
    sourceId: MAINTENANCE_SIGNAL_SOURCE,
    read: async ({ principal }: { principal: AuthUser }) => {
      if (
        !isAccessRuleSatisfied(
          principalGrantedRuleIds(principal),
          maintenanceAccess.maintenance.read,
        )
      ) {
        return {};
      }

      const maintenancesBySystem =
        await service.getActiveMaintenancesBySystem();
      return deriveMaintenanceSignals({ maintenancesBySystem });
    },
  };
}
