---
"@checkstack/auth-backend": minor
"@checkstack/auth-common": minor
"@checkstack/auth-frontend": minor
"@checkstack/ai-backend": patch
---

Let teams that manage a resource administer its team access (delegation)

Editing a resource's team access on the "Who can change this" editor (add/remove
teams, toggle Manage, toggle Private) was gated on the GLOBAL `auth.teams.manage`
rule on both the frontend and backend, so only a platform admin could do it -
even a member of a team that already manages the resource saw the editor
read-only.

`writeRelation`, `removeRelation` and `setObjectPublic` now authorize per-object:
the caller may edit a resource's team access when they can MANAGE that specific
resource - a global `auth.teams.manage` admin, a holder of the resource's own
`<type>.manage` rule (e.g. `catalog.system.manage`), or a member of a team that
holds an editor/owner grant on it. A team that only reads the resource (viewer
grant), or has no grant and no global rule, is read-only and CANNOT elevate its
own or another team's access. The check reuses the existing ReBAC engine
(`tupleStore.check({ action: "manage" })`), so team-only (private) resources are
respected: a global resource-manager who is not on a granted team cannot reach a
private resource - only a `teams.manage` admin or a granted team can. The first
grant on an otherwise-unscoped resource still requires one of the global rules.

A new `canManageObjectAccess` query runs the SAME authorization, and the
`TeamAccessEditor` gates its write controls on it instead of the global rule, so
the UI shows exactly the controls a write would accept (no frontend/backend
drift). The backend re-checks on every write, so it remains the security
boundary.

BREAKING CHANGE: granting/revoking a team's access to a resource is no longer
admin-only - it is delegated to whoever can manage that resource. If you relied
on only `auth.teams.manage` holders being able to change resource team-access,
note that members of a team that manages the resource can now do so too (a
read-only team still cannot).
