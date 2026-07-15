import { createSlot } from "@checkstack/frontend-api";
import type { HealthCheckRun } from "./schemas";

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

/**
 * Slot on the run detail panel (single-run view) for other plugins to add
 * per-run actions or context - e.g. tracestream-frontend contributes a
 * "View trace" jump when a collector recorded a `traceId` for the run (use
 * `extractRunTraceIds` from this package to read them). Fillers MUST
 * self-hide (render null) when they have nothing to offer for the run; the
 * host mounts every filler for every run.
 *
 * The `run` context value is the panel's already-loaded run (referentially
 * stable - straight from the query cache).
 *
 * @example
 * extensions: [
 *   createSlotExtension(RunDetailExtrasSlot, {
 *     id: "my-plugin.run-detail-extras",
 *     component: ({ run }) => <MyRunAction run={run} />,
 *   }),
 * ]
 */
export const RunDetailExtrasSlot = createSlot<{
  /** The run shown in the detail panel (already loaded by the host). */
  run: HealthCheckRun;
}>("plugin.healthcheck.run-detail-extras");
