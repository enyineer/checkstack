---
"@checkstack/catalog-backend": minor
---

feat(catalog): system triggers + update_metadata action for the Automation Platform

Ships the catalog chunk of Phase 9:

- Triggers: `catalog.created`, `catalog.updated`, `catalog.deleted`
  — named consistently with the other plugin lifecycle triggers
  (incident.created, dependency.created, maintenance.created, …).
  Each carries `contextKey: (p) => p.systemId` so `wait_for_trigger`
  can resume the right run.
- Action: `catalog.update_metadata` — sets or merges metadata on a
  system (`strategy: "merge" | "replace"`). Default is `merge` so
  untouched keys survive. Returns a `catalog.system_record` artifact
  (`systemId`, `systemName`, `metadata`).

New hook: `catalogHooks.systemUpdated` (`{ systemId, systemName,
changedFields }`). Emitted from both the `updateSystem` RPC handler
and the `update_metadata` automation action so downstream automations
and caches see both code paths. Emission is skipped when no tracked
field changed (no-op saves don't spam subscribers).

The `system.health_changed`, `system.set_maintenance`, and
`system.clear_maintenance` items in the original Phase 9 plan move to
the **healthcheck** and **maintenance** chunks respectively, where the
underlying data and RPCs live.
