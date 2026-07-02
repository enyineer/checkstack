---
"@checkstack/backend": minor
"@checkstack/healthcheck-frontend": minor
---

Fix team-scoped access to health-check management and remove redundant create toggles.

- **Health Checks page no longer denies team-scoped users.** The management page gated its body on the GLOBAL `configuration.read` rule (`useAccess`), so a user with only a team grant (a create-capability grant, or a per-config team grant) saw "Access Denied" even though the route guard let them in and the "Create Check" button rendered. The page now resolves the same capability the route uses (`useCanAccessType`), so page and route agree.
- **Health-check history pages reachable by team-scoped managers.** The run-history list and detail/run pages gated their body on the GLOBAL `configuration.manage` rule and their routes carried no `manageCapability`, so a team member who manages a health check via a team grant (no global rule) could not review its run history. The history routes now declare `manageCapability` and the pages resolve the manage capability via `useCanAccessType`.
- **Parent-gated creates are no longer offered as "Resource creation" toggles.** `getResourceKinds` marked a type create-capable whenever any procedure declared `instanceAccess.create`, including parent-gated creates (incident/maintenance "for a system"). Those are authorized via MANAGE on the parent, so a per-type toggle was redundant and misleading. The derivation now excludes a create that carries a `parent` gate; a type with both a parent-less and a parent-gated create is still enumerated.

No schema or migration change. Backend create authorization is unchanged - only the Teams UI enumeration and the frontend page gate.
