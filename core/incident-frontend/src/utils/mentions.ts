import { resolveRoute } from "@checkstack/common";
import { registerMentionRoutes } from "@checkstack/frontend-api";
import { incidentRoutes } from "@checkstack/incident-common";

/**
 * The mention type incidents own.
 *
 * STABLE by contract: it is baked into every mention already written into an
 * update or a description, so changing it orphans them all.
 */
export const INCIDENT_MENTION_TYPE = "incident";

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
