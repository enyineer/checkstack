/**
 * The reactive `incident` entity (reactive automation engine §10.1).
 *
 * Model B PLUGIN-BACKED entity: the `incidents` + `incident_systems` tables
 * are authoritative AND ARE the entity's current-state storage — there is NO
 * framework `entity_state` row for an incident. `defineEntity({ read })` makes
 * that plugin state reactive: every reactive-state write goes through
 * `handle.mutate`, whose `apply()` performs the REAL `incidents`/junction write
 * via the incident service (the plugin's own db/tx) and returns the resulting
 * `{ status, severity, systemIds }`. The framework snapshots `prev` via `read`,
 * appends the transition log (its own db), and emits `ENTITY_CHANGED`. The
 * change → trigger-event deriver reproduces `incident.created` / `.updated` /
 * `.resolved` so automations keep firing.
 */
import { z } from "zod";
import {
  IncidentSeverityEnum,
  IncidentStatusEnum,
} from "@checkstack/incident-common";
import type {
  EntityChangeDeriver,
  EntityChangePayloadMapper,
  EntityHandle,
  EntityMutationOpts,
  EntityRead,
} from "@checkstack/automation-backend";
import {
  withEntityRemove,
  withEntityWrite,
} from "@checkstack/automation-backend";

import type { IncidentService } from "./service";

export const INCIDENT_ENTITY_KIND = "incident";

export const IncidentEntityStateSchema = z.object({
  status: IncidentStatusEnum,
  severity: IncidentSeverityEnum,
  systemIds: z.array(z.string()),
});

export type IncidentEntityState = z.infer<typeof IncidentEntityStateSchema>;

export const INCIDENT_TRIGGER_EVENTS = {
  created: "incident.created",
  updated: "incident.updated",
  resolved: "incident.resolved",
} as const;

function readStatus(state: Record<string, unknown> | null): string | null {
  if (state === null) return null;
  const status = state["status"];
  return typeof status === "string" ? status : null;
}

/**
 * `incident` change → trigger events.
 *
 * - create (`prev === null`) → `incident.created`
 * - transition TO `resolved` (and not already resolved) → `incident.resolved`
 * - any other field change → `incident.updated`
 * - tombstone (`next === null`, from `deleteIncident`) → no event (there is
 *   no `incident.deleted` trigger event)
 *
 * NOTE (deviation): the old `addUpdate`-with-status=resolved path emitted
 * BOTH `incident.updated` and `incident.resolved`; the deriver fires only
 * `incident.resolved` on a resolution (matching the dedicated
 * `resolveIncident` / `resolveAutoIncident` paths, which only emitted
 * `incident.resolved`). A resolution is no longer also surfaced as a generic
 * `incident.updated` — automations meant to react to resolution should use
 * the `incident.resolved` trigger.
 */
export const deriveIncidentTriggerEvents: EntityChangeDeriver = (changed) => {
  if (changed.prev === null && changed.next !== null) {
    return [INCIDENT_TRIGGER_EVENTS.created];
  }
  if (changed.next === null) {
    return [];
  }
  const prevStatus = readStatus(changed.prev);
  const nextStatus = readStatus(changed.next);
  if (nextStatus === "resolved" && prevStatus !== "resolved") {
    return [INCIDENT_TRIGGER_EVENTS.resolved];
  }
  return [INCIDENT_TRIGGER_EVENTS.updated];
};

function readField(
  state: Record<string, unknown> | null,
  field: string,
): unknown {
  return state === null ? undefined : state[field];
}

/**
 * Map an `incident` entity change to the domain-named `trigger.payload` the
 * incident triggers declare via `payloadSchema` (`incidentId`, `systemIds`,
 * `severity`, `status`, `statusChange`). This restores the keys operators read
 * (`trigger.payload.incidentId` etc.) that the generic change shape omits.
 *
 * The reactive `incident` entity state is only `{ status, severity, systemIds }`,
 * so the schemas' descriptive fields (`title`, `description`, `createdAt`,
 * `resolvedAt`) are NOT available from a change and are declared OPTIONAL on
 * those schemas. `statusChange` is populated when the status field changed (the
 * `updated` trigger's hint), so a status flip carries the new status both as
 * `status` and `statusChange`.
 */
export const incidentChangeToPayload: EntityChangePayloadMapper = (changed) => {
  const next = changed.next;
  const statusChanged = changed.changedFields.includes("status");
  const nextStatus = readField(next, "status");
  return {
    incidentId: changed.id,
    systemIds: Array.isArray(readField(next, "systemIds"))
      ? (readField(next, "systemIds") as unknown[])
      : [],
    severity: readField(next, "severity"),
    status: nextStatus,
    ...(statusChanged && typeof nextStatus === "string"
      ? { statusChange: nextStatus }
      : {}),
  };
};

/**
 * Build the PLUGIN-BACKED `read` accessor for the `incident` entity. Routes
 * straight to the service's batched authoritative read — no framework storage.
 */
export function createIncidentEntityRead(
  service: IncidentService,
): EntityRead<IncidentEntityState> {
  return (ids) => service.getManyEntityStates(ids);
}

/**
 * Project a service incident shape onto the reactive `{ status, severity,
 * systemIds }` subset. The router's service writes return the full incident;
 * this is the `apply()` return for `handle.mutate`.
 */
export function toIncidentEntityState(incident: {
  status: IncidentEntityState["status"];
  severity: IncidentEntityState["severity"];
  systemIds: string[];
}): IncidentEntityState {
  return {
    status: incident.status,
    severity: incident.severity,
    systemIds: incident.systemIds,
  };
}

/**
 * Drive a reactive-state incident write through `handle.mutate` (§10.1).
 * `apply` performs the REAL `incidents`/junction write via the service (the
 * plugin's own db/tx) and returns the new reactive state. The framework
 * snapshots `prev`, appends the transition log, and emits `ENTITY_CHANGED`
 * (the deriver turns that into `incident.created/.updated/.resolved`).
 *
 * When no handle is available (tests construct the router without one), the
 * write still runs — the entity reactivity is layered on top, never required
 * for the underlying write to succeed.
 */
export async function writeIncidentEntity(args: {
  handle: EntityHandle<IncidentEntityState> | undefined;
  incidentId: string;
  /**
   * Mutation context (actor / runId). When the write originates inside a
   * dispatch run, pass `opts: { runId }` so a run-resolved secret that lands
   * in the reactive state is masked in the transition rows + `ENTITY_CHANGED`.
   */
  opts?: EntityMutationOpts;
  apply: () => Promise<IncidentEntityState>;
}): Promise<void> {
  const { handle, incidentId, opts, apply } = args;
  await withEntityWrite({ handle, id: incidentId, opts, apply });
}

/**
 * Drive an incident tombstone through `handle.remove` (§10.1). `apply`
 * performs the REAL delete via the service; the framework records the
 * tombstone transition and emits a tombstone change (the deriver fires
 * nothing — there is no `incident.deleted` trigger event). Without a handle,
 * the delete still runs.
 */
export async function removeIncidentEntity(args: {
  handle: EntityHandle<IncidentEntityState> | undefined;
  incidentId: string;
  apply: () => Promise<void>;
}): Promise<void> {
  const { handle, incidentId, apply } = args;
  await withEntityRemove({ handle, id: incidentId, apply });
}
