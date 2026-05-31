---
"@checkstack/catalog-backend": minor
---

Make `catalog-system` and `catalog-group` plugin-backed reactive entities via the Model-B entity state machine.

Catalog defines a `catalog-system` entity `{ name, description, metadata }` and a `catalog-group` entity `{ name, metadata }`. The `systems` / `groups` tables are BOTH authoritative AND the entities' current-state storage - there is no framework `entity_state` row for a catalog system/group. `defineEntity` is given plugin `read` accessors (`EntityService.getManySystemEntityStates` / `getManyGroupEntityStates`) that project the reactive subsets straight off those tables, and every reactive-state write goes through `handle.mutate` / `handle.remove`: `apply` performs the REAL `systems` / `groups` write (the plugin's own db/tx) and returns the new state; the framework snapshots `prev` via `read` BEFORE the write, appends the transition log, and emits `ENTITY_CHANGED` AFTER the write commits. Covered sites: create-system, update-system, delete-system (tombstone), create-group, update-group, delete-group (tombstone), and the `system.update_metadata` automation action. Create sites pre-generate the id so the handle is keyed on it and the create's `prev` snapshot reads the not-yet-existing row as absent; `EntityService.createSystem` / `createGroup` accept an optional pre-generated `id` (server-owned either way).

Change -> trigger-event derivers reproduce the existing qualified events (emitting the TRIGGER event ids automations match on, not the dotted hook ids):

- `catalog-system`: create -> `catalog.created`; tombstone -> `catalog.deleted`; field update -> `catalog.updated`.
- `catalog-group`: create -> `catalog.group.created`; tombstone -> `catalog.group.deleted` (a pure group update fires nothing).

Mirrors are diff-suppressed (a save-with-no-diff stays a no-op). The `catalog.system.*` / `catalog.group.*` cross-plugin hooks are removed in the same effort (see the healthcheck/catalog hook-removal changeset); cross-plugin consumers (incident, dependency, slo, healthcheck) read via `onEntityChanged`.

BREAKING CHANGES (behavior): none for trigger-event consumers - the same qualified trigger events still fire via the change derivers, and `onEntityChanged` consumers see the same change event. The only observable change is internal: catalog current state is read from the `systems` / `groups` tables instead of `entity_state`, and writes route through the entity handle. The `system.update_metadata` action's race-deleted ("disappeared mid-update") path now drives a no-op entity write (the framework diffs it as no change) before returning failure, instead of skipping the write entirely; no event fires either way.
