import { resolveRoute } from "@checkstack/common";
import { registerMentionRoutes } from "@checkstack/frontend-api";
import {
  INCIDENT_MENTION_TYPE,
  incidentRoutes,
} from "@checkstack/incident-common";

/**
 * Re-exported so existing frontend imports keep working. The constant itself
 * lives in `incident-common` because the backend's status-page widget must
 * declare the SAME value (see `mentionType` on the widget definition).
 */
export { INCIDENT_MENTION_TYPE } from "@checkstack/incident-common";

/**
 * Register the routing half of the incident mention provider.
 *
 * Called at module scope from the plugin entry point so already-written
 * mentions resolve as soon as the plugin loads, independently of whether the
 * search half (which needs an RPC client, and therefore React) has installed
 * yet. See `IncidentMentionRegistrar`.
 */
export function registerIncidentMentions(): void {
  registerMentionRoutes({
    type: INCIDENT_MENTION_TYPE,
    displayName: "Incidents",
    toRoute: ({ id }) =>
      resolveRoute(incidentRoutes.routes.detail, { incidentId: id }),
  });
}
