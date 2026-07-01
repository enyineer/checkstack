---
"@checkstack/auth-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/slo-frontend": minor
---

Add `useManageableResources` to `@checkstack/auth-frontend` so a RLAC-aware
resource picker no longer re-derives its filter. Given the candidate items and
the write rule, it returns the exact list to offer - the shared "offer all when
entitled, else filter to accessible, keep the current selection" policy
(`selectManageable`), with `allowAllOverride` for a higher rule that authorizes
any instance - so a picker never offers a resource the submit would reject.

The incident, maintenance, and SLO "affected systems" pickers now use it instead
of duplicating that logic. Capability gating of buttons/pages stays on the
existing `accessApi` hooks + `PageLayout` (the pages consume the verdict
compoundly, which a wrapper component cannot express).
