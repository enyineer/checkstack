---
"@checkstack/automation-backend": minor
"@checkstack/incident-backend": patch
"@checkstack/catalog-backend": patch
"@checkstack/dependency-backend": patch
"@checkstack/maintenance-backend": patch
"@checkstack/slo-backend": patch
"@checkstack/satellite-backend": patch
---

Extract a shared `withEntityWrite` / `withEntityRemove` guard for PLUGIN-BACKED (Model B) reactive entities and refactor the per-domain copies onto it.

Every plugin-backed domain (incident, catalog, dependency, maintenance, slo, satellite) reimplemented the same "no handle wired → run the plugin write directly; handle wired → route through `handle.mutate` / `handle.remove`" guard, varying only in the id-key name. `@checkstack/automation-backend` now exports `withEntityWrite` / `withEntityRemove` (from the entity barrel) and each domain's thin, well-named wrappers (`writeIncidentEntity`, `writeMaintenanceEntity`, satellite's `mirror`, …) delegate to it, so the branch lives in exactly one place. Behavior is unchanged.

`writeHealthEntity` (healthcheck-backend) is intentionally NOT migrated onto the helper — it is genuinely bespoke (closure-captured durable state, distinct rethrow-vs-fail-soft branches, a per-system serializer, and it returns the computed state). SLO keeps its fail-soft `onError` wrapper around the shared guard.
