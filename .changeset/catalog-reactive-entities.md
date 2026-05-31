---
"@checkstack/catalog-backend": minor
---

Migrate catalog systems + groups to the reactive `catalog-system` / `catalog-group` entities (reactive automation engine Phase 4, §10.4).

Catalog now defines a `catalog-system` entity `{ name, description, metadata }` and a `catalog-group` entity `{ name, metadata }` through the `automation.entity` extension point and mirrors them at every mutation site (router `createSystem` / `updateSystem` / `deleteSystem` / `createGroup` / `updateGroup` / `deleteGroup`, plus the `system.update_metadata` automation action). Change → trigger-event derivers reproduce the existing qualified events:

- `catalog-system`: create (`prev === null`) → `catalog.created`; tombstone (`next === null`) → `catalog.deleted`; field update → `catalog.updated`. (The deriver emits the qualified TRIGGER event ids — the catalog system triggers use the ids `created`/`updated`/`deleted`, not the dotted hook ids `catalog.system.*`.)
- `catalog-group`: create → `catalog.group.created`; tombstone → `catalog.group.deleted` (there is no `catalog.group.updated` event, so a pure group update fires nothing).

Mirrors are fail-soft and diff-suppressed (a save-with-no-diff stays a no-op, matching the existing "don't fire automations on no-op updates" behavior).

This step KEEPS the `catalog.system.*` / `catalog.group.*` hooks emitting (removed in the final Phase-4 step once incident / dependency / slo consumers move to `onEntityChanged`), so no behavior changes for existing subscribers yet.
