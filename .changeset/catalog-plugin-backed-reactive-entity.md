---
"@checkstack/catalog-backend": minor
---

Make `catalog-system` and `catalog-group` plugin-backed reactive entities driven through `handle.mutate`.

The catalog `systems` / `groups` tables are now BOTH authoritative AND the
`catalog-system` / `catalog-group` entities' current-state storage — there is
no framework `entity_state` row for a catalog system/group anymore.
`defineEntity` is given plugin `read` accessors
(`EntityService.getManySystemEntityStates` / `getManyGroupEntityStates`) that
project the reactive subsets `{ name, description, metadata }` /
`{ name, metadata }` straight off those tables.

Every reactive-state write now goes through `handle.mutate` / `handle.remove`:
`apply` performs the REAL `systems` / `groups` write (the plugin's own db/tx)
and returns the new state; the framework snapshots `prev` BEFORE the write,
appends the transition log (its own db), and emits `ENTITY_CHANGED` AFTER the
write commits. The Phase-4 `handle.set` mirror calls (and the
`mirrorCatalogSystem` / `mirrorCatalogGroup` helpers) are removed. Covered
sites: create-system, update-system, delete-system (tombstone), create-group,
update-group, delete-group (tombstone), and the `system.update_metadata`
automation action. Create sites pre-generate the id so the handle is keyed on
it and the create's `prev` snapshot reads the not-yet-existing row as absent;
`EntityService.createSystem` / `createGroup` accept an optional pre-generated
`id` (server-owned either way).

The change-derivers (`catalog.created` / `.updated` / `.deleted` +
`catalog.group.created` / `.deleted`) and every cross-plugin `onEntityChanged`
consumer of the `catalog-system` tombstone (incident, dependency, slo,
healthcheck) are unchanged — they consume the same change event, which still
fires from `mutate`. No behavior change for consumers.

BREAKING CHANGES (behavior): none for trigger-event consumers. The only
observable change is internal: catalog current state is read from the
`systems` / `groups` tables instead of `entity_state`, and writes are routed
through the entity handle. The `system.update_metadata` action's race-deleted
("disappeared mid-update") path now drives a no-op entity write (the framework
diffs it as no change) before returning failure, instead of skipping the write
entirely; no event fires either way.
