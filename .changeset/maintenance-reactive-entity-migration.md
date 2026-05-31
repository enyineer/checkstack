---
"@checkstack/maintenance-backend": minor
---

Migrate the maintenance domain to the reactive entity state machine (reactive automation engine Phase 4, §10.2).

Maintenance windows now mirror their reactive state into the framework-owned `maintenance` entity (`{ status, systemIds, startAt, endAt }`) at every mutation site (router create/update/addUpdate/close/delete and the automation actions). A registered change-deriver maps `maintenance` entity changes back to the `maintenance.created` / `maintenance.updated` trigger events, so existing automations keep firing via the reactive Stage-1/Stage-2 dispatch pipeline. The `maintenances` table stays the record of truth (behaviour-preserving mirror — no column drops, no query changes).

BREAKING CHANGES:

- Removed the `maintenance.created` and `maintenance.updated` hooks (`createHook`) and their re-export from the plugin entry point. Use the `maintenance` entity's auto-emitted change events (subscribe via the `automation.entity` extension point's `onEntityChanged`, or author automations against the derived `maintenance.created` / `maintenance.updated` trigger events).
- Removed the hook-backed `created` / `updated` automation triggers. The same qualified trigger event ids (`maintenance.created` / `maintenance.updated`) are now produced by the entity change-deriver, so already-authored automations referencing them continue to fire. New automations referencing these events must hand-author the event id (or via GitOps) — they are no longer offered as a picker entry in the automation editor. The trigger payload is now the entity-change shape (`kind`, `id`, `prev`, `next`, `delta`, `changedFields`, plus the new state fields spread at top level: `status`, `systemIds`, `startAt`, `endAt`) rather than the old hook payload (which additionally carried `maintenanceId`, `title`, `description`, and the `updated`/`closed` `action` discriminator).
