import { createSlot } from "@checkstack/frontend-api";

/**
 * Slot for read-only metadata on a health-check configuration's detail/history
 * view. Use for quiet, contextual facts about the configuration — e.g.
 * auth-frontend contributes a "who can change this" access indicator.
 * Extensions receive the configuration id.
 *
 * @example
 * extensions: [{
 *   id: "my-plugin.healthcheck-config-details",
 *   slotId: HealthCheckConfigDetailsSlot.id,
 *   component: ({ configurationId }) => <MyMeta configurationId={configurationId} />,
 * }]
 */
export const HealthCheckConfigDetailsSlot = createSlot<{
  configurationId: string;
}>("plugin.healthcheck.config-details");
