---
"@checkstack/common": minor
"@checkstack/frontend-api": minor
"@checkstack/auth-frontend": minor
"@checkstack/slo-frontend": minor
"@checkstack/healthcheck-frontend": minor
"@checkstack/incident-frontend": minor
"@checkstack/catalog-frontend": minor
"@checkstack/automation-frontend": minor
"@checkstack/status-page-frontend": minor
"@checkstack/maintenance-frontend": minor
"@checkstack/frontend": patch
"@checkstack/ui": patch
"@checkstack/catalog-common": patch
---

Derive frontend authorization gates from the RPC contract instead of hand-picking
a hook per call site. The backend contract already declares, per procedure, both
the access rule (`access`) and how it is instance-scoped (`instanceAccess`); the
frontend gate was a hand re-encoding of that, which is how the "global-only
team-grant" drift shipped (nothing enforced that the hook a page chose matched
the mode the contract declared).

New `resolveProcedureGate` (`@checkstack/common`) reads a contract procedure's
metadata and returns the single gate the backend will enforce - classifying
`global` / `idParam` / `create` / `typeScoped` / post-filtered `open`, deriving
the object type from the rule and resolving the resource id from the input via
the contract's declared path. `parentScope` is normalized into an `idParam`/`open`
gate on a reconstructed parent rule + the parent type (the parent grant string the
backend checks is exactly `${resourceType}.${action}`, so no contract change was
needed). New `accessApi.useProcedureAccess(procedure, input)`
(`@checkstack/frontend-api` / `@checkstack/auth-frontend`) dispatches on the
derived gate; a call site can no longer gate on the wrong thing.

Fix a latent `create.parent` gap: the create gate's global-RBAC path only checked
the procedure's own manage rule, so a user with GLOBAL manage on the PARENT type
(e.g. a global system manager creating an incident/maintenance/SLO "for" a system,
which the backend authorizes via the parent gate) was not offered the create
affordance. The derived create gate now also ORs global manage on the parent type.

Migrate every `useCanCreate` create-button gate (catalog systems, health checks,
incidents, maintenance, SLOs, automations, status pages) to `useProcedureAccess`
on the owning create procedure, which also delivers the `create.parent` fix to
each, then remove `useCanCreate` from the `AccessApi`.

BREAKING CHANGES: `accessApi.useCanCreate(...)` is removed from
`@checkstack/frontend-api`. Replace it with
`accessApi.useProcedureAccess(SomeApi.contract.createX)` - the create procedure's
`instanceAccess.create` supplies the object type and parent gate, so no more
hand-passed `objectType` / `parentType`. The remaining hooks (`useAccess`,
`useCanAccessType`, `useResourceAccess`, `useRouteAccess`, `useIsAuthenticated`)
are unchanged: they gate surfaces/rows/routes that are not tied to a single
procedure. No gate became more restrictive; the create fix makes global
parent-managers correctly see create controls they were wrongly denied.

Patch-level adaptations to the `AccessApi` interface change (no behavior change of
their own): the host app's fallback `AccessApi` stubs (`@checkstack/frontend`) and
Storybook's mock (`@checkstack/ui`) drop `useCanCreate` and add the new
`useProcedureAccess` / `useSurfaceAccess` members so they match the interface, and
a `@checkstack/catalog-common` doc comment now names `useProcedureAccess` instead
of the removed hook.
