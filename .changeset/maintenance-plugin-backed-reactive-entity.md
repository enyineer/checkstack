---
"@checkstack/maintenance-backend": minor
---

Reconvert `maintenance` to a Model-B PLUGIN-BACKED reactive entity.

The `maintenances` + `maintenance_systems` tables are now the entity's
current-state storage directly — there is no framework `entity_state` mirror.
`defineEntity({ read })` makes that plugin state reactive, and every
create / update / add-update / close / delete site drives the REAL service
write through `handle.mutate` / `handle.remove` (the write runs inside `apply`,
committed in the plugin's own transaction). The framework snapshots `prev` via
the new `MaintenanceService.getManyEntityStates` read accessor BEFORE the
write, appends the transition log, and emits `ENTITY_CHANGED`.

Changes:

- New `MaintenanceService.getManyEntityStates` batched read projecting
  `{ status, systemIds, startAt, endAt }` straight off the authoritative
  tables (ISO-serialized timestamps).
- `MaintenanceService.createMaintenance` accepts an optional pre-generated
  `id` so a create can be keyed on a known id and its `prev` snapshot reads the
  not-yet-existing row as absent.
- Router + automation action mutation sites route through the new
  `writeMaintenanceEntity` / `removeMaintenanceEntity` helpers; the Phase-4
  `entityHandle.set` / `entityHandle.remove(id)` mirror is dropped.
- The `maintenance.created` / `maintenance.updated` change-deriver is
  unchanged — Stage-1 routing keeps firing the same qualified trigger events,
  so existing automations are behavior-preserving.

BREAKING CHANGE: the `maintenance` entity is now plugin-backed. It no longer
has a framework `entity_state` row — its current state lives only in the
`maintenances` + `maintenance_systems` tables, read on demand. No
automation-facing surface changes: the entity kind, state shape, and
`maintenance.created` / `maintenance.updated` trigger events are identical.
