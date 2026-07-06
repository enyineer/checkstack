---
"@checkstack/common": minor
"@checkstack/backend-api": minor
"@checkstack/auth-common": minor
"@checkstack/auth-backend": minor
"@checkstack/backend": minor
"@checkstack/healthcheck-common": minor
"@checkstack/script-packages-common": minor
"@checkstack/script-packages-backend": minor
---

Fix a 403 that blocked team-scoped health-check managers from opening the
health-check editor.

The editor's utility endpoints (`healthcheck.getStrategies`,
`healthcheck.getCollectors`, `healthcheck.testCollectorScript`, and the
script-package SDK/type endpoints) were gated with `instanceAccess: { global:
true }` or a separate global `script-packages.read` rule. A `global: true` gate
is enforced ONLY against a caller's global access rules - team grants never
satisfy it - so a user who could manage a health check through a team grant, but
did not hold the global `healthcheck.configuration.read` rule, got a 403 on the
metadata endpoints the editor needs and could not open it.

New `typeScoped` instanceAccess mode. A no-instance utility/catalog endpoint can
now be gated by ANY team grant of its resource type (or the global rule): a
`viewer`/`editor`/`owner` grant on any instance, or a `creator`
(create-capability) grant so a team member who may CREATE the type can open its
authoring UI before owning an instance. `healthcheck.getStrategies` /
`getCollectors` use it at read level; `testCollectorScript` at manage level.
Backed by an `includeCreator` option threaded through `hasAnyTypeGrant`
(store -> auth S2S contract -> `AuthService`), so the create-capability path is
counted only where intended (the list/record post-filter keeps its old
semantics). The boot validator recognises `typeScoped` as one of the mutually
exclusive modes.

Script-package authoring endpoints relaxed to authenticated. `getInstallState`
and the two raw type routes (`/api/script-packages/sdk-types/:version` and
`/api/script-packages/types/:hash/:spec`) now require only authentication, not
the global `script-packages.read` grant. They serve IntelliSense metadata
(installed package inventory, `.d.ts` closures, the `@checkstack/sdk` bundle) -
no secrets - which any script author, including a team-scoped health-check
manager, needs. The install/registry MANAGE endpoints stay restricted.

Why the team-permission guards did not catch this: `check:manage-capabilities`
only covers management routes/nav, not the procedures a page calls; the boot
conformance validator treats `global: true` as a deliberate, valid "not
team-scoped" marker and cannot tell it is actually a dependency of a
team-scopable editor flow. The RLAC rule now documents `typeScoped` as the
correct mode and warns against `global: true` for endpoints a team manager
needs.
