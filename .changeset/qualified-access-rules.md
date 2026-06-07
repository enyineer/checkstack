---
"@checkstack/common": minor
"@checkstack/auth-common": patch
"@checkstack/auth-backend": patch
"@checkstack/auth-frontend": patch
"@checkstack/frontend-api": patch
"@checkstack/frontend": patch
"@checkstack/backend": patch
"@checkstack/notification-backend": patch
"@checkstack/ui": patch
"@checkstack/cache-memory-common": patch
"@checkstack/queue-bullmq-common": patch
"@checkstack/queue-memory-common": patch
"@checkstack/ai-common": patch
"@checkstack/announcement-common": patch
"@checkstack/anomaly-common": patch
"@checkstack/api-docs-common": patch
"@checkstack/automation-common": patch
"@checkstack/cache-common": patch
"@checkstack/catalog-common": patch
"@checkstack/dependency-common": patch
"@checkstack/gitops-common": patch
"@checkstack/healthcheck-common": patch
"@checkstack/incident-common": patch
"@checkstack/integration-common": patch
"@checkstack/maintenance-common": patch
"@checkstack/notification-common": patch
"@checkstack/pluginmanager-common": patch
"@checkstack/queue-common": patch
"@checkstack/satellite-common": patch
"@checkstack/script-packages-common": patch
"@checkstack/secrets-common": patch
"@checkstack/slo-common": patch
"@checkstack/incident-frontend": patch
"@checkstack/maintenance-frontend": patch
"@checkstack/slo-frontend": patch
---

Fix frontend access checks to use FULLY-QUALIFIED access-rule ids, and resolve
the anonymous role on the frontend.

Granted access-rule ids are stored fully-qualified as `{pluginId}.{ruleId}` (e.g.
`incident.incident.read`) so two plugins defining the same short rule id never
collide. The frontend, however, was checking the UNqualified id (`incident.read`)
via `isAccessRuleSatisfied`, so every check failed for any user without the `*`
(admin) grant - masked in development because dev-auth grants `*`. This silently
broke ALL non-admin frontend gating (route guards, sidebar entries, and
`useAccess`-based button/link gating).

- **`@checkstack/common`**: `AccessRule` now carries a REQUIRED owning `pluginId`;
  `access()` / `accessPair()` require and stamp it; `isAccessRuleSatisfied`
  qualifies the rule (`{pluginId}.{id}`, plus the manage->read escalation) and
  matches ONLY the qualified form. There is intentionally NO unqualified fallback
  - matching a bare id would let one plugin's grant satisfy another plugin's
  identically-named rule (a cross-plugin privilege-escalation flaw). Every plugin
  that defines access rules now passes its own `pluginId`.
- **`@checkstack/backend`**: `pluginManager.getAllAccessRules()` no longer strips
  the `pluginId` field (the rule `id` is already fully-qualified for the DB sync).
- **Route guard** (`@checkstack/frontend` / `@checkstack/frontend-api`) now
  checks the FULL rule object (so it qualifies and escalates), not a bare id.
- **Anonymous role on the frontend**: the `accessRules` procedure is now
  `public`, returning the configurable anonymous role's grants to unauthenticated
  callers; `useAccessRules` fetches them for guests instead of returning an empty
  set. So anonymous UI now reflects exactly what the anonymous role is allowed -
  which an admin can change (`isPublic` is only the seeded default).
- Incident / maintenance / SLO detail routes are now read-gated (their read rule
  is an `isPublic` default, so the anonymous role holds it unless an admin
  revokes it); their dashboard status signals carry that rule and render as a
  link only when the viewer may open it.

**BREAKING (`@checkstack/common`):** `AccessRule.pluginId` is now REQUIRED, and
`access()` / `accessPair()` require a `pluginId` option. `isAccessRuleSatisfied`
matches ONLY the fully-qualified `{pluginId}.{ruleId}` form - the previous
unqualified fallback is removed, because it was a cross-plugin
privilege-escalation flaw. Any code constructing an `AccessRule` or calling
`access()`/`accessPair()` must supply the owning `pluginId`.

Verified live against an anonymous caller: read pages resolve (qualified match),
manage actions are denied, manage->read escalation and `*` still work.
