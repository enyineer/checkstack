---
"@checkstack/healthcheck-backend": minor
"@checkstack/catalog-backend": minor
---

Remove the now-unused healthcheck + catalog entity hooks; rely on the reactive entities + change derivers (reactive automation engine Phase 4, final step of §10.3 / §10.4).

Now that every cross-plugin consumer (slo, dependency, incident, and healthcheck's own catalog-cleanup) reads these domains via `onEntityChanged`, the producers stop emitting the entity-change hooks and the trigger registrations become entity-driven (fired by the entity change deriver via Stage-1 routing, with a no-op `setup` so they stay in the editor's trigger catalog).

- **healthcheck**: stops emitting `healthcheck.system.degraded` / `.healthy` / `.health_changed` from the queue executor (the `health` entity mirror is the single source of truth). Its own `catalog.system.deleted` consumer switched to `onEntityChanged({ kind: "catalog-system" })` on tombstones (work-queue delivery preserved). The directional/umbrella triggers are now entity-driven.
- **catalog**: stops emitting `catalog.system.created` / `.updated` / `.deleted` and `catalog.group.created` / `.deleted` from the router + the `system.update_metadata` action (the `catalog-system` / `catalog-group` mirrors are authoritative). The system triggers are now entity-driven.

CORRECTNESS FIX (also affects the earlier healthcheck/catalog Phase-4 steps in this branch): the change derivers now emit the TRIGGER qualifiedIds that automations actually store in `trigger.event` and that Stage-1 routing matches on (`findEnabledByTriggerEvent`), NOT the dotted hook ids. Healthcheck triggers use underscore ids, so the deriver emits `healthcheck.system_degraded` / `system_healthy` / `system_health_changed` (not `healthcheck.system.degraded`). Catalog system triggers use ids `created`/`updated`/`deleted`, so the deriver emits `catalog.created` / `catalog.updated` / `catalog.deleted` (not `catalog.system.created`). Without this fix the migrated automations would never fire.

BREAKING CHANGES:
- `healthcheck.system.degraded` / `healthcheck.system.healthy` / `healthcheck.system.health_changed` cross-plugin hooks are removed. The reactive `health` entity drives the matching trigger events (`healthcheck.system_degraded` / `_healthy` / `_health_changed`), so existing automations keep firing. Kept healthcheck hooks: `assignment.changed`, `check.completed`, `check.failed`, `flapping_detected`.
- `catalog.system.created` / `.updated` / `.deleted` and `catalog.group.created` / `.deleted` cross-plugin hooks are removed. The reactive `catalog-system` / `catalog-group` entities drive the matching trigger events (`catalog.created` / `.updated` / `.deleted`); cross-plugin cleanup reactors subscribe to the `catalog-system` tombstone via `onEntityChanged`. `catalogHooks` / `healthCheckHooks` remain exported (the removed members are gone) for a stable import surface.
