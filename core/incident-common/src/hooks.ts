import { z } from "zod";

/**
 * Hook id fired on EVERY incident lifecycle change (create, update — including a
 * health override added / changed / cleared —, resolve, delete, and the
 * auto-incident create/resolve paths). The actual `Hook` object is created in
 * `@checkstack/incident-backend` (via `createHook` from
 * `@checkstack/backend-api`); only the id + payload shape live here so backend
 * consumers can reference them WITHOUT depending on `incident-backend`.
 *
 * Unlike the reactive `incident` entity change (whose state is only
 * `{ status, severity, systemIds }`, so an override-only edit is a no-op that
 * emits nothing), this hook fires on override changes too. Consumers (e.g.
 * `@checkstack/slo-backend`) subscribe with `work-queue` delivery to reconcile
 * per-system state — including closing SLO downtime when an override is cleared.
 */
export const INCIDENT_LIFECYCLE_CHANGED_HOOK_ID = "incident.lifecycle.changed";

/**
 * What happened to the incident. Mirrors the `INCIDENT_UPDATED` realtime signal
 * so both are emitted from the same lifecycle sites with the same payload.
 */
export const IncidentLifecycleActionEnum = z.enum([
  "created",
  "updated",
  "resolved",
  "deleted",
]);
export type IncidentLifecycleAction = z.infer<
  typeof IncidentLifecycleActionEnum
>;

export const incidentLifecycleChangedPayloadSchema = z.object({
  /** The incident that changed. */
  incidentId: z.string(),
  /** Systems affected by the incident (the reconcile targets). */
  systemIds: z.array(z.string()),
  /** The lifecycle transition that fired the hook. */
  action: IncidentLifecycleActionEnum,
});

export type IncidentLifecycleChangedPayload = z.infer<
  typeof incidentLifecycleChangedPayloadSchema
>;
