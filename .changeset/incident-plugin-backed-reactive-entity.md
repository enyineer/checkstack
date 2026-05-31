---
"@checkstack/incident-backend": minor
---

Make `incident` a plugin-backed reactive entity driven through `handle.mutate`.

The `incidents` + `incident_systems` tables are now BOTH authoritative AND the
`incident` entity's current-state storage — there is no framework
`entity_state` row for an incident anymore. `defineEntity` is given a plugin
`read` accessor (`IncidentService.getManyEntityStates`) that projects the
reactive subset `{ status, severity, systemIds }` straight off those tables.

Every reactive-state write now goes through `handle.mutate` / `handle.remove`:
`apply` performs the REAL `incidents` / junction write (the plugin's own
db/tx) and returns the new state; the framework snapshots `prev` BEFORE the
write, appends the transition log (its own db), and emits `ENTITY_CHANGED`
AFTER the write commits. The Phase-4 `handle.set` mirror calls (and the
`mirrorIncidentEntity` helper) are removed. Covered sites: create, update,
add-update, resolve, auto-create, auto-resolve, and delete (tombstone).

The change-deriver (`incident.created` / `.updated` / `.resolved`) and the
catalog `onEntityChanged` system-cleanup consumer are unchanged — they consume
the same change event, which still fires from `mutate`.

BREAKING CHANGES (behavior): the `incident.create` automation ACTION path now
ALSO drives its write through `handle.mutate`, so an action-created incident is
now reactive — it emits `incident.created` and other automations can trigger on
it. Previously the action path created incidents silently (no lifecycle event).
A dedupe REUSE still emits nothing (the open incident is unchanged).
