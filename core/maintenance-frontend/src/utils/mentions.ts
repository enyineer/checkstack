import { resolveRoute } from "@checkstack/common";
import { registerMentionRoutes } from "@checkstack/frontend-api";
import { maintenanceRoutes } from "@checkstack/maintenance-common";

/**
 * The mention type maintenance windows own.
 *
 * STABLE by contract: it is baked into every mention already written into an
 * update or a description, so changing it orphans them all.
 */
export const MAINTENANCE_MENTION_TYPE = "maintenance";

/**
 * Register the routing half of the maintenance mention provider.
 *
 * Called at module scope from the plugin entry point so already-written
 * mentions resolve as soon as the plugin loads, independently of whether the
 * search half (which needs an RPC client, and therefore React) has installed
 * yet. See `MaintenanceMentionRegistrar`.
 */
export function registerMaintenanceMentions(): void {
  registerMentionRoutes({
    type: MAINTENANCE_MENTION_TYPE,
    displayName: "Maintenances",
    toRoute: ({ id }) =>
      resolveRoute(maintenanceRoutes.routes.detail, { maintenanceId: id }),
  });
}
