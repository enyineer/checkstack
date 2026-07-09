import { createHook, type EventBus, type Logger } from "@checkstack/backend-api";
import {
  INCIDENT_LIFECYCLE_CHANGED_HOOK_ID,
  type IncidentLifecycleChangedPayload,
} from "@checkstack/incident-common";

/**
 * Incident cross-plugin hooks.
 *
 * The `incident.created` / `.updated` / `.resolved` hooks were removed in
 * Phase 4 (§10.1): incidents are now the reactive `incident` entity, whose
 * change deriver fires the matching `incident.created` / `.updated` /
 * `.resolved` trigger events through Stage-1 routing.
 *
 * `lifecycleChanged` is a distinct, lower-level cross-plugin hook: it fires on
 * EVERY incident lifecycle mutation (create, update — including a health
 * override added / changed / cleared —, resolve, delete, and the auto-incident
 * paths), carrying `{ incidentId, systemIds, action }`. Unlike the reactive
 * `incident` entity change (state `{ status, severity, systemIds }`, so an
 * override-only edit emits nothing), this catches override changes, which
 * `@checkstack/slo-backend` needs to open/close incident-forced SLO downtime.
 * The id + payload contract live in `@checkstack/incident-common` so consumers
 * subscribe without depending on this backend.
 */
export const incidentLifecycleChangedHook =
  createHook<IncidentLifecycleChangedPayload>(
    INCIDENT_LIFECYCLE_CHANGED_HOOK_ID,
  );

export const incidentHooks = {
  lifecycleChanged: incidentLifecycleChangedHook,
} as const;

/**
 * Emit `incident.lifecycle.changed` on the distributed event bus. THE single
 * place the hook is fired, so every incident lifecycle path - the RPC router,
 * the bulk paths, AND the automation actions - shares identical guard/failure
 * semantics and can never drift. Best-effort by contract: the incident write is
 * already committed by the time this runs, so a delivery failure must never turn
 * a successful mutation into a client/run error - consumers reconcile on the
 * next lifecycle event. A no-op when no event bus is wired (tests).
 */
export async function emitIncidentLifecycleChanged({
  eventBus,
  logger,
  payload,
}: {
  eventBus: EventBus | undefined;
  logger: Logger;
  payload: IncidentLifecycleChangedPayload;
}): Promise<void> {
  if (!eventBus) return;
  try {
    await eventBus.emit(incidentLifecycleChangedHook, payload);
  } catch (error) {
    logger.warn(
      `Failed to emit incident.lifecycle.changed hook for incident ${payload.incidentId}; consumers will reconcile on the next lifecycle event.`,
      { error },
    );
  }
}
