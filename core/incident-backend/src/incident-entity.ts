/**
 * The reactive `incident` entity (reactive automation engine §10.1).
 *
 * Behavior-preserving MIRROR: the `incidents` + `incident_systems` tables
 * stay authoritative; the router/action mutation sites mirror the reactive
 * subset `{ status, severity, systemIds }` into the framework entity store
 * keyed by incident id. The change → trigger-event deriver reproduces the
 * existing `incident.created` / `.updated` / `.resolved` qualified events so
 * automations keep firing.
 */
import { z } from "zod";
import {
  IncidentSeverityEnum,
  IncidentStatusEnum,
} from "@checkstack/incident-common";
import type {
  EntityChangeDeriver,
  EntityHandle,
} from "@checkstack/automation-backend";

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

/** Mirror an incident into the `incident` entity (fail-soft). */
export async function mirrorIncidentEntity(args: {
  handle: EntityHandle<IncidentEntityState> | undefined;
  incidentId: string;
  status: IncidentEntityState["status"];
  severity: IncidentEntityState["severity"];
  systemIds: string[];
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { handle, incidentId, status, severity, systemIds, onError } = args;
  if (!handle) return;
  try {
    await handle.set(incidentId, { status, severity, systemIds });
  } catch (error) {
    onError?.(error);
  }
}

/** Tombstone an incident entity (fail-soft). */
export async function removeIncidentEntity(args: {
  handle: EntityHandle<IncidentEntityState> | undefined;
  incidentId: string;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { handle, incidentId, onError } = args;
  if (!handle) return;
  try {
    await handle.remove(incidentId);
  } catch (error) {
    onError?.(error);
  }
}
