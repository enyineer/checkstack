---
"@checkstack/automation-backend": patch
"@checkstack/catalog-backend": patch
"@checkstack/dependency-backend": patch
"@checkstack/healthcheck-backend": patch
"@checkstack/maintenance-backend": patch
"@checkstack/notification-backend": patch
---

Fix producing automation actions that double-prefixed their artifact type. The
action registry qualifies `produces` with the owning plugin id, but several
actions set `produces` to an already-qualified id, so it became
`plugin.plugin.type` (e.g. `automation.automation.analysis`,
`maintenance.maintenance.window`). This stored artifacts under a type that
matched no registered artifact type, and — because the run scope exposes a
produced artifact under its type's local name — broke the documented downstream
reference `artifacts.<actionId>.<name>.<field>` (a `choose`/condition/template
referencing the analysis output, a created incident/maintenance/etc. silently
saw `undefined` and took the wrong branch).

Fixed in `ai_analyze` (`analysis`), the built-in `notify_user`
(`notify_user_result`), and the catalog (`system_record`), maintenance
(`window`), notification (`send_result`), dependency (`edge`), and healthcheck
(`assignment`) actions — each now uses the unqualified local id matching its
artifact-type definition.

BREAKING (beta): any automation that referenced one of these artifacts via the
old double-prefixed scope key (e.g. `artifacts.x['automation.analysis']`) must
switch to the documented form (`artifacts.x.analysis.<field>`). The
double-prefixed key was never the intended/documented path.
