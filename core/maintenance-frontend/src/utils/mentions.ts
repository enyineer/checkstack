import { resolveRoute } from "@checkstack/common";
import { registerMentionRoutes } from "@checkstack/frontend-api";
import {
  MAINTENANCE_MENTION_TYPE,
  maintenanceRoutes,
} from "@checkstack/maintenance-common";

/**
 * Re-exported so existing frontend imports keep working. The constant itself
 * lives in `maintenance-common` because the backend's status-page widget must
 * declare the SAME value (see `mentionType` on the widget definition).
 */
export { MAINTENANCE_MENTION_TYPE } from "@checkstack/maintenance-common";

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
