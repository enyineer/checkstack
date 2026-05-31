---
"@checkstack/incident-backend": minor
---

Make `incident` a plugin-backed reactive entity via the Model-B entity state machine.

The `incidents` + `incident_systems` tables are BOTH authoritative AND the `incident` entity's current-state storage - there is no framework `entity_state` row for an incident. `defineEntity` is given a plugin `read` accessor (`IncidentService.getManyEntityStates`) that projects the reactive subset `{ status, severity, systemIds }` straight off those tables, and every reactive-state write goes through `handle.mutate` / `handle.remove`: `apply` performs the REAL `incidents` / junction write (the plugin's own db/tx) and returns the new state; the framework snapshots `prev` via `read` BEFORE the write, appends the transition log (its own db), and emits `ENTITY_CHANGED` AFTER the write commits. Covered sites: create, update, add-update, resolve, auto-create, auto-resolve, and delete (tombstone), plus the `incident.create` / `incident.resolve` automation actions.

A change -> trigger-event deriver reproduces the existing qualified events so automations keep firing:

- create (`prev === null`) -> `incident.created`
- transition to `resolved` -> `incident.resolved`
- any other field change -> `incident.updated`
- delete (tombstone) -> no event (there is no `incident.deleted` trigger)

The old `incident.created` / `incident.updated` / `incident.resolved` change hooks are removed in favor of these reactive change events; the catalog `system.deleted` consumer switched from `onHook(catalogHooks.systemDeleted)` to `onEntityChanged({ kind: "catalog-system" })` filtered to tombstones, keeping `work-queue` delivery (association cleanup must run once per cluster).

BREAKING CHANGES:
- The `incident.created` / `incident.updated` / `incident.resolved` cross-plugin hooks (the `createHook` descriptors) are removed. Incident lifecycle is now the reactive `incident` entity; the matching trigger events still fire (via the entity change deriver), so existing automations on `incident.created/.updated/.resolved` and external event-routing (e.g. the Jira integration's `incident.created` event type) keep working. No in-repo plugin subscribed to the removed hooks via `onHook`.
- The `addUpdate`-with-status=resolved path previously emitted BOTH `incident.updated` and `incident.resolved`; it now fires only `incident.resolved` (the deriver classifies a transition-to-resolved as a resolution). Automations meant to react to a resolution should use the `incident.resolved` trigger, not `incident.updated`.
- NARROWING: `incident.updated` now fires only on a change to the REACTIVE state (`status`, `severity`, or affected `systemIds`). A comment-only `addUpdate` (no status change) no longer fires `incident.updated` (the posted message is not reactive entity state). Re-author any automation that needed to react to a comment-only update against a different signal.
- The `incident.create` automation ACTION path now drives its write through `handle.mutate`, so an action-created incident is now reactive - it emits `incident.created` and other automations can trigger on it. Previously the action path created incidents silently (no lifecycle event). A dedupe REUSE still emits nothing (the open incident is unchanged).
